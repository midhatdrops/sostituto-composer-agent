import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ExternalResult, ExternalTurn } from './external.js';
import { ROOT } from './paths.js';
import { KIMI_HOME, KIMI_MAIN } from './providers.js';

/**
 * Um turno no Kimi Code (assinatura Kimi Code, login com `npm run login:kimi`), em modo não
 * interativo: `kimi --prompt … --output-format stream-json`, um processo por turno.
 * Segurança em duas camadas: o agente do app só oferece leitura, web e as ferramentas do app
 * (MCP), e um hook PreToolUse (scripts/kimi-guard.mjs) nega o resto, inclusive se der erro.
 */

const GUARD = path.join(ROOT, 'scripts', 'kimi-guard.mjs');
const BEGIN = '# >>> sostituto (gerado pelo app; não edite este bloco)';
const END = '# <<< sostituto';

/**
 * Bloco de hooks no config.toml do HOME do app. Vai sempre no FIM do arquivo: um [[hooks]]
 * engole as chaves soltas escritas depois dele, então o bloco é retirado e recolocado antes de cada turno.
 */
function ensureHooks() {
  const file = path.join(KIMI_HOME, 'config.toml');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {}
  const start = text.indexOf(BEGIN);
  const stop = text.indexOf(END);
  if (start >= 0 && stop > start) text = text.slice(0, start) + text.slice(stop + END.length);
  // string literal TOML ('…'): caminhos do Windows sem escapar barras
  const command = `"${process.execPath}" "${GUARD}"`;
  const block = [BEGIN, '[[hooks]]', 'event = "PreToolUse"', `command = '${command}'`, 'timeout = 15', END].join('\n');
  fs.writeFileSync(file, `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${block}\n`, 'utf8');
}

/** Só o servidor MCP do app; a URL muda por música+dia, por isso o arquivo é reescrito a cada turno. */
function writeMcpConfig(url: string) {
  fs.writeFileSync(path.join(KIMI_HOME, 'mcp.json'), JSON.stringify({ mcpServers: { sostituto: { url } } }, null, 2), 'utf8');
}

/** Agente do app: o corpo é o prompt de sistema; fica salvo porque a sessão retomada aponta para ele. */
function writeAgent(song: string, date: string, system: string): string {
  const dir = path.join(KIMI_HOME, 'sostituto-agents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${crypto.createHash('sha1').update(`${song}\u0000${date}`).digest('hex').slice(0, 16)}.md`);
  const front = [
    '---',
    'name: sostituto',
    'description: Assistente de composição musical do Sostituto',
    'tools:',
    ...['Read', 'Grep', 'Glob', 'FetchURL', 'WebSearch', 'mcp__sostituto__*'].map((t) => `  - "${t}"`),
    'disallowedTools:',
    ...['Bash', 'Edit', 'Write', 'Agent'].map((t) => `  - ${t}`),
    'subagents: []',
    '---',
  ].join('\n');
  fs.writeFileSync(file, `${front}\n\n\${base_prompt}\n\n${system}\n`, 'utf8');
  return file;
}

/** Turnos do Kimi em fila: mcp.json e config.toml são do HOME inteiro, não de uma conversa. */
let queue: Promise<unknown> = Promise.resolve();

/** No Windows a linha de comando tem ~32 mil caracteres; o prompt vai como argumento. */
const MAX_PROMPT = 28000;

export function runKimiTurn(t: ExternalTurn): Promise<ExternalResult> {
  const run = queue.then(() => kimiTurn(t));
  queue = run.catch(() => {});
  return run;
}

async function kimiTurn(t: ExternalTurn): Promise<ExternalResult> {
  fs.mkdirSync(KIMI_HOME, { recursive: true });
  ensureHooks();
  writeMcpConfig(t.mcpUrl);
  if (t.prompt.length > MAX_PROMPT) {
    return { ok: false, error: `Mensagem grande demais para o Kimi (${t.prompt.length} caracteres; limite ${MAX_PROMPT}).` };
  }
  const args = [KIMI_MAIN];
  // o agente só vale ao criar a sessão; ao retomar, o Kimi restaura o agente da sessão
  if (t.threadId) args.push('--session', t.threadId);
  else args.push('--agent-file', writeAgent(t.song, t.date, t.system));
  args.push('--prompt', t.prompt, '--output-format', 'stream-json');

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.KIMI_API_KEY; // só a assinatura
  env.KIMI_CODE_HOME = KIMI_HOME;
  env.SOSTITUTO_MUSICAS = t.musicasDir; // lido pelo hook de trava
  env.NO_COLOR = '1';

  const started = Date.now();
  let rounds = 0;
  let stderr = '';
  let gotText = false;
  const child = spawn(process.execPath, args, { cwd: t.dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const onAbort = () => child.kill();
  t.signal.addEventListener('abort', onAbort, { once: true });

  let buf = '';
  const handle = (line: string) => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.role === 'meta') {
      if (typeof m.session_id === 'string' && m.session_id) t.onThread(m.session_id);
      return;
    }
    if (m.role === 'assistant') {
      const text = contentText(m.content);
      if (text.trim()) {
        t.onText(text);
        gotText = true;
      }
      for (const call of (Array.isArray(m.tool_calls) ? m.tool_calls : []) as { function?: { name?: string }; name?: string }[]) {
        t.onTool(call.function?.name ?? call.name ?? 'ferramenta', '');
        rounds++;
      }
    } else if (m.role === 'tool') {
      const text = contentText(m.content);
      if (/bloquead|desligad|denied|blocked/i.test(text) && /Sostituto|hook/i.test(text)) t.onDenied(String(m.name ?? 'ferramenta'), text.slice(0, 300));
    }
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, i).trim());
      buf = buf.slice(i + 1);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-4000)));

  const code: number = await new Promise((resolve) => {
    child.on('close', (c) => resolve(c ?? 1));
    child.on('error', (e) => {
      stderr += e.message;
      resolve(1);
    });
  });
  t.signal.removeEventListener('abort', onAbort);
  if (buf.trim()) handle(buf.trim());

  const aborted = t.signal.aborted;
  const error = aborted ? 'Resposta interrompida.' : code !== 0 ? kimiError(stderr, code) : !gotText ? 'O Kimi não respondeu (sem texto).' : '';
  return { ok: !error, error: error || undefined, stats: { rounds: Math.max(1, rounds), ms: Date.now() - started, inputTokens: 0, outputTokens: 0 } };
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' ? String((p as { text?: unknown }).text ?? '') : ''))
    .join('');
}

function kimiError(stderr: string, code: number): string {
  const s = stderr.replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (/login|unauthori[sz]ed|401|not logged|credential/i.test(s)) return 'Kimi sem login. Rode `npm run login:kimi` uma vez para entrar com a sua assinatura.';
  return `O Kimi terminou com erro (código ${code}). ${s.split('\n').slice(-3).join(' ').slice(0, 400)}`;
}
