import fs from 'node:fs';
import path from 'node:path';
import { query, type HookCallback, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { APP_SERVER, APP_TOOLS, appToolsServer, type UserSaid } from './appTools.js';
import { loadConfig, musicasDir, type Effort } from './config.js';
import { checkTool, type GuardContext } from './guard.js';
import { CLAUDE_MD, GENERAL_SETTINGS, PROMPT_ASSISTENTE, findEntry } from './paths.js';
import { CLOSE_DISPLAY, CLOSE_PROMPT, CLOSE_TOPIC, conversationRecap, fmtDate, openingContext, pendingCloseNote, systemAppend } from './prompts.js';
import { instructionBlock, instructionsSignature } from './instructions.js';
import { appendMessage, dayStarted, getSession, readMessages, setClosed, setSessionId, setThread, touch, unclosedBefore, type ChatMessage } from './sessions.js';
import { runExternalTurn } from './external.js';
import { mcpUrlFor } from './mcpHttp.js';
import { DEFAULT_PROVIDER, PROVIDER_LABEL, providerStatus, type ProviderId } from './providers.js';
import { songDir } from './vault.js';

export type ChatEvent =
  | { type: 'session'; sessionId: string; resumed: boolean }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'denied'; name: string; reason: string }
  | { type: 'done'; costUsd?: number; isError: boolean; stats?: TurnStats }
  | { type: 'error'; message: string };

/** Números de um turno (para medir desempenho e consumo). */
export interface TurnStats {
  model: string;
  effort: Effort;
  rounds: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
}

/** Únicas ferramentas nativas oferecidas ao assistente (sem terminal, subagentes, agendamentos etc.). */
const BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
/** Sessão viva sem uso por este tempo é encerrada (a próxima mensagem retoma com --resume). */
const IDLE_MS = 15 * 60 * 1000;
/** Quantas mensagens recentes do usuário valem para conferir o nome pedido de um MIDI. */
export const RECENT_SAID = 5;

/**
 * settings.json efetivo: se a música tiver <música>/.claude/settings.json,
 * ele é usado NO LUGAR do geral (não é mesclado).
 */
export function resolveSettings(dir: string): { path: string; scope: 'local' | 'geral' } {
  const claudeDir = findEntry(dir, '.claude');
  const local = claudeDir && path.join(dir, claudeDir, 'settings.json');
  if (local && fs.existsSync(local)) return { path: local, scope: 'local' };
  return { path: GENERAL_SETTINGS, scope: 'geral' };
}

/**
 * Conteúdo do settings efetivo (geral ou local) com as travas do app por cima:
 * os conectores da conta claude.ai (Docs, Upwork etc.) nunca chegam ao assistente.
 */
function effectiveSettings(dir: string): Record<string, unknown> {
  let base: Record<string, unknown> = {};
  try {
    base = JSON.parse(fs.readFileSync(resolveSettings(dir).path, 'utf8'));
  } catch {}
  return { ...base, disableClaudeAiConnectors: true };
}

/** Sem chave de API: força o uso do login da assinatura do `claude`. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) delete env[k];
  return env;
}

function describeTool(name: string, input: Record<string, unknown>, dir: string): string {
  const p = input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.url ?? input.destino;
  if (typeof p !== 'string') return '';
  return path.isAbsolute(p) ? path.relative(dir, p) || '.' : p;
}

function guardHook(ctx: GuardContext): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const verdict = checkTool(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, ctx);
    if (verdict.allow) return {};
    // a recusa volta como tool_result com erro e é reportada no turno
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    };
  };
}

/* ------------------------------ sessão viva ------------------------------ */

/** Fila de mensagens que alimenta o processo do Claude Code em modo de entrada contínua. */
class Inbox implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake: (() => void) | null = null;
  private closed = false;

  push(text: string) {
    this.items.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.items.length) yield this.items.shift()!;
      else if (this.closed) return;
      else await new Promise<void>((r) => (this.wake = r));
      this.wake = null;
    }
  }
}

/**
 * Um processo do Claude Code por música+dia, mantido vivo entre as mensagens
 * (evita reiniciar o processo e recarregar o histórico a cada mensagem).
 */
interface LiveSession {
  key: string;
  q: Query;
  inbox: Inbox;
  /** versão das configurações quando a sessão começou (prompt/settings mudaram → recria) */
  version: number;
  /** datas de modificação de prompt, CLAUDE.md e settings: pega também edições feitas à mão */
  signature: string;
  /** o SDK informa o custo acumulado do processo; guardamos o anterior para mostrar o do turno */
  costSoFar: number;
  model: string;
  effort: Effort;
  /** recebe as mensagens do turno em andamento */
  onMessage: ((m: SDKMessage) => void) | null;
  /** chamado se o processo terminar no meio de um turno */
  onDead: ((err: Error) => void) | null;
  dead: boolean;
  idle: NodeJS.Timeout | null;
  said: UserSaid;
}

const live = new Map<string, LiveSession>();
const busy = new Set<string>();
let settingsVersion = 0;

/** Prompt, CLAUDE.md, settings ou vault mudaram: as próximas mensagens abrem sessões novas (com --resume). */
export function invalidateLiveSessions() {
  settingsVersion++;
  for (const s of live.values()) if (!busy.has(s.key)) closeLive(s);
}

function configSignature(dir: string): string {
  const mtime = (f: string) => {
    try {
      return fs.statSync(f).mtimeMs;
    } catch {
      return 0;
    }
  };
  const settings = resolveSettings(dir).path;
  return [...[PROMPT_ASSISTENTE, CLAUDE_MD, settings].map((f) => `${f}:${mtime(f)}`), instructionsSignature()].join('|');
}

function closeLive(s: LiveSession) {
  if (s.idle) clearTimeout(s.idle);
  s.dead = true;
  live.delete(s.key);
  s.inbox.close();
  try {
    s.q.close();
  } catch {}
}

export function closeAllLiveSessions() {
  for (const s of [...live.values()]) closeLive(s);
}

function startLive(key: string, song: string, date: string, dir: string, resume: string | null, model: string, effort: Effort): LiveSession {
  const ctx = { musicasDir: musicasDir(), cwd: dir };
  const inbox = new Inbox();
  // o que o usuário escreveu por último (inclusive antes de retomar): a gerar_midi só aceita um nome que ele tenha dito
  const said: UserSaid = { recent: readMessages(song, date).filter((m) => m.role === 'user').slice(-RECENT_SAID).map((m) => m.text) };
  const q = query({
    prompt: inbox,
    options: {
      cwd: dir,
      resume: resume ?? undefined,
      title: resume ? undefined : `${song} – ${fmtDate(date)}`,
      model,
      effort,
      includePartialMessages: true,
      // Isola dos settings do usuário/projeto: só vale o settings escolhido abaixo.
      settingSources: [],
      settings: effectiveSettings(dir),
      // só o servidor MCP do app; nada de .mcp.json, plugins ou conectores da conta
      strictMcpConfig: true,
      tools: BUILTIN_TOOLS,
      skills: [],
      // snapshot: false — sem isso o SDK grava o prompt na 1ª mensagem e o reaproveita ao retomar,
      // e uma edição do prompt ou do CLAUDE.md só valeria na sessão do dia seguinte
      systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(song, date, dir), snapshot: false },
      hooks: { PreToolUse: [{ hooks: [guardHook(ctx)] }] },
      // ferramentas do app (copiar_arquivo, anotar, ler_instrucao, gerar_midi): validam as regras por conta própria
      mcpServers: { [APP_SERVER]: appToolsServer(ctx, date, said) },
      allowedTools: APP_TOOLS,
      env: cleanEnv(),
    },
  });
  const s: LiveSession = {
    key,
    q,
    inbox,
    version: settingsVersion,
    signature: configSignature(dir),
    costSoFar: 0,
    model,
    effort,
    onMessage: null,
    onDead: null,
    dead: false,
    idle: null,
    said,
  };

  (async () => {
    try {
      for await (const m of q) s.onMessage?.(m);
      s.onDead?.(new Error('A sessão do assistente terminou inesperadamente.'));
    } catch (err) {
      s.onDead?.(err as Error);
    } finally {
      if (!s.dead) closeLive(s);
    }
  })();
  return s;
}

/* -------------------------------- turno ---------------------------------- */

export async function runChat(
  song: string,
  date: string,
  message: string,
  emit: (e: ChatEvent) => void,
  abort: AbortController,
  /**
   * `instrucao`: tema de instruções/ anexado a este pedido (não aparece na conversa).
   * `provider`: quem responde (padrão Claude); cada um tem a sua conversa do dia.
   */
  opts: { deep?: boolean; close?: boolean; instrucao?: string; provider?: ProviderId } = {},
): Promise<void> {
  const session = getSession(song, date);
  if (!session) throw Object.assign(new Error(`Sessão ${date} não existe`), { statusCode: 404 });
  if (busy.has(song)) throw Object.assign(new Error('Já há uma resposta em andamento nesta música'), { statusCode: 409 });

  const provider = opts.provider ?? DEFAULT_PROVIDER;
  const dir = songDir(song);
  const key = `${song}\u0000${date}`;
  const a = loadConfig().assistant;
  const model = opts.deep ? a.deepModel : a.model;
  const effort = opts.deep ? a.deepEffort : a.effort;

  busy.add(song);
  const earlier = readMessages(song, date); // antes desta mensagem (resumo ao trocar de provider)
  const userText = opts.close ? CLOSE_DISPLAY : message;
  appendMessage(song, date, { role: 'user', text: userText });
  const topic = opts.close ? CLOSE_TOPIC : opts.instrucao;
  if (opts.close) message = CLOSE_PROMPT;
  if (topic) message = [message, instructionBlock(topic)].filter(Boolean).join('\n\n');
  // 1ª mensagem de um dia novo: se o dia anterior ficou aberto, o assistente fecha junto
  const started = dayStarted(session);
  const pending = !started && !opts.close ? unclosedBefore(song, date) : null;
  // 1ª mensagem deste provider hoje: contexto de abertura; se o dia já começou com outro, o resumo da conversa
  const thread = provider === 'claude' ? session.sessionId : session.threads?.[provider];
  const prompt = thread
    ? message
    : [openingContext(dir), started && conversationRecap(earlier), pending && pendingCloseNote(pending.date), message]
        .filter(Boolean)
        .join('\n\n');
  let ok = false;
  let assistantText = '';
  const toolNames = new Map<string, string>();
  const flushAssistant = () => {
    if (assistantText.trim()) appendMessage(song, date, { role: 'assistant', text: assistantText, provider });
    assistantText = '';
  };

  let s = provider === 'claude' ? live.get(key) : undefined;
  try {
    if (provider !== 'claude') {
      ok = await externalTurn(provider, { song, date, dir, prompt, thread: thread ?? undefined, deep: !!opts.deep, earlier, userText, emit, abort });
    } else {
      if (s && (s.dead || s.version !== settingsVersion || s.signature !== configSignature(dir))) {
        closeLive(s);
        s = undefined;
      }
      if (!s) {
        s = startLive(key, song, date, dir, session.sessionId, model, effort);
        live.set(key, s);
      } else {
        if (s.idle) clearTimeout(s.idle);
        if (s.model !== model) {
          await s.q.setModel(model);
          s.model = model;
        }
        if (s.effort !== effort) {
          await s.q.applyFlagSettings({ effortLevel: effort }).catch(() => {});
          s.effort = effort;
        }
      }
      const cur = s;
      cur.said.recent = [...cur.said.recent, userText].slice(-RECENT_SAID);

      await new Promise<void>((resolve) => {
        const onAbort = () => cur.q.interrupt().catch(() => {});
        abort.signal.addEventListener('abort', onAbort, { once: true });
        const finish = () => {
          abort.signal.removeEventListener('abort', onAbort);
          cur.onMessage = null;
          cur.onDead = null;
          resolve();
        };
        cur.onDead = (err) => {
          flushAssistant();
          const msg = abort.signal.aborted ? 'Resposta interrompida.' : err.message;
          appendMessage(song, date, { role: 'error', text: msg });
          emit({ type: 'error', message: msg });
          finish();
        };
        cur.onMessage = (m) => {
          if (m.type === 'system' && m.subtype === 'init') {
            if (process.env.SOSTITUTO_DEBUG) {
              console.log(`[init] ${m.model} | ferramentas: ${m.tools.join(', ')} | skills: ${m.skills.length} | agentes: ${m.agents?.length ?? 0}`);
            }
            if (m.session_id !== getSession(song, date)?.sessionId) setSessionId(song, date, m.session_id);
            emit({ type: 'session', sessionId: m.session_id, resumed: !!session.sessionId });
          } else if (m.type === 'stream_event') {
            const ev = m.event;
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              assistantText += ev.delta.text;
              emit({ type: 'delta', text: ev.delta.text });
            }
          } else if (m.type === 'assistant') {
            for (const block of m.message.content) {
              if (block.type === 'tool_use') {
                flushAssistant();
                const detail = describeTool(block.name, block.input as Record<string, unknown>, dir);
                toolNames.set(block.id, block.name);
                emit({ type: 'tool', name: block.name, detail });
                appendMessage(song, date, { role: 'tool', text: `${block.name} ${detail}`.trim() });
              }
            }
          } else if (m.type === 'user' && Array.isArray(m.message.content)) {
            // ferramenta recusada (settings deny ou hook) ou com erro
            for (const block of m.message.content) {
              if (block.type !== 'tool_result' || !block.is_error) continue;
              const name = toolNames.get(block.tool_use_id) ?? 'ferramenta';
              const raw =
                typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => ('text' in c ? c.text : '')).join(' ');
              const reason = raw.replace(/<\/?tool_use_error>/g, '').trim().slice(0, 300);
              emit({ type: 'denied', name, reason });
              appendMessage(song, date, { role: 'tool', text: `⛔ ${name}: ${reason}` });
            }
          } else if (m.type === 'result') {
            flushAssistant();
            if (abort.signal.aborted) appendMessage(song, date, { role: 'error', text: 'Resposta interrompida.' });
            ok = !m.is_error && !abort.signal.aborted;
            const u = m.usage;
            const turnCost = m.total_cost_usd - cur.costSoFar;
            cur.costSoFar = m.total_cost_usd;
            emit({
              type: 'done',
              costUsd: turnCost,
              isError: m.is_error,
              stats: {
                model: cur.model,
                effort: cur.effort,
                rounds: m.num_turns,
                ms: m.duration_ms,
                inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
                outputTokens: u.output_tokens ?? 0,
              },
            });
            finish();
          }
        };
        cur.inbox.push(prompt);
      });
    }
    if (ok) {
      // fechado pelo botão; uma conversa nova depois do fechamento reabre o dia
      if (opts.close) setClosed(song, date, 'botão');
      else if (getSession(song, date)?.closedAt) setClosed(song, date, null);
      if (pending) setClosed(song, pending.date, 'automático');
    }
  } catch (err) {
    flushAssistant();
    appendMessage(song, date, { role: 'error', text: (err as Error).message });
    emit({ type: 'error', message: (err as Error).message });
  } finally {
    busy.delete(song);
    touch(song, date);
    const cur = live.get(key);
    if (cur && !cur.dead) {
      // configurações mudaram durante o turno: encerra agora; senão, encerra após um tempo ocioso
      if (cur.version !== settingsVersion) closeLive(cur);
      else cur.idle = setTimeout(() => closeLive(cur), IDLE_MS);
    }
  }
}

/* --------------------------- Codex e Kimi --------------------------- */

interface ExternalTurnArgs {
  song: string;
  date: string;
  dir: string;
  prompt: string;
  thread?: string;
  deep: boolean;
  earlier: ChatMessage[];
  userText: string;
  emit: (e: ChatEvent) => void;
  abort: AbortController;
}

/**
 * Turno num provider de fora do processo: a conversa na tela e o histórico são os mesmos do
 * Claude; as ferramentas do app chegam a ele pelo MCP HTTP (com a mesma trava).
 */
async function externalTurn(provider: Exclude<ProviderId, 'claude'>, t: ExternalTurnArgs): Promise<boolean> {
  const { song, date, dir, emit, abort } = t;
  // sem login não adianta abrir o CLI (o Codex leva ~15 s para falhar): avisa já com o comando
  const status = providerStatus().find((p) => p.id === provider);
  if (!status?.installed || !status.loggedIn) {
    const msg = !status?.installed
      ? `O ${PROVIDER_LABEL[provider]} não está instalado. Rode \`npm install\` na pasta do Sostituto.`
      : `O ${PROVIDER_LABEL[provider]} ainda não tem login. Rode \`${status.login}\` uma vez no terminal para entrar com a sua assinatura.`;
    appendMessage(song, date, { role: 'error', text: msg });
    emit({ type: 'error', message: msg });
    emit({ type: 'done', isError: true });
    return false;
  }
  const ctx = { musicasDir: musicasDir(), cwd: dir };
  const recent = [...t.earlier.filter((m) => m.role === 'user').map((m) => m.text), t.userText].slice(-RECENT_SAID);
  const mcpUrl = mcpUrlFor(`${song}\u0000${date}`, { ctx, date, said: { recent } });
  let lastWasText = false;
  const res = await runExternalTurn(provider, {
    song,
    date,
    dir,
    musicasDir: ctx.musicasDir,
    prompt: t.prompt,
    system: systemAppend(song, date, dir, { external: true }),
    threadId: t.thread,
    deep: t.deep,
    mcpUrl,
    signal: abort.signal,
    onThread: (id) => {
      if (id !== t.thread) setThread(song, date, provider, id);
      emit({ type: 'session', sessionId: id, resumed: !!t.thread });
    },
    onText: (text) => {
      // blocos seguidos sem ferramenta no meio caem na mesma bolha: separa por parágrafo
      const chunk = lastWasText ? `\n\n${text}` : text;
      lastWasText = true;
      emit({ type: 'delta', text: chunk });
      appendMessage(song, date, { role: 'assistant', text, provider });
    },
    onTool: (name, detail) => {
      lastWasText = false;
      emit({ type: 'tool', name, detail });
      appendMessage(song, date, { role: 'tool', text: `${name} ${detail}`.trim() });
    },
    onDenied: (name, reason) => {
      emit({ type: 'denied', name, reason });
      appendMessage(song, date, { role: 'tool', text: `⛔ ${name}: ${reason}` });
    },
  });
  if (!res.ok) {
    const msg = res.error ?? 'Erro desconhecido.';
    appendMessage(song, date, { role: 'error', text: msg });
    emit({ type: 'error', message: msg });
  }
  const st = res.stats ?? { rounds: 0, ms: 0, inputTokens: 0, outputTokens: 0 };
  emit({ type: 'done', isError: !res.ok, stats: { model: PROVIDER_LABEL[provider], effort: t.deep ? 'high' : 'medium', ...st } });
  return res.ok;
}
