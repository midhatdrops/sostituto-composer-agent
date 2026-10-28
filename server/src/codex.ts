import fs from 'node:fs';
import { Codex, type ThreadEvent, type ThreadOptions } from '@openai/codex-sdk';
import type { ExternalTurn, ExternalResult } from './external.js';
import { CODEX_HOME } from './providers.js';

/**
 * Um turno no Codex (assinatura do ChatGPT, login feito com `npm run login:codex`).
 * Segurança: sandbox somente leitura e sem pedidos de aprovação: o Codex lê, mas não grava
 * nem executa nada que altere arquivos; toda gravação passa pelas ferramentas do app (MCP).
 */
export async function runCodexTurn(t: ExternalTurn): Promise<ExternalResult> {
  fs.mkdirSync(CODEX_HOME, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // sem chave de API: só a assinatura (auth.json do HOME do app)
  for (const k of ['OPENAI_API_KEY', 'CODEX_API_KEY']) delete env[k];
  env.CODEX_HOME = CODEX_HOME;

  const codex = new Codex({
    env,
    // só o servidor MCP do app (o HOME do app não tem outros configurados)
    config: { mcp_servers: { sostituto: { url: t.mcpUrl } } },
  });
  const options: ThreadOptions = {
    workingDirectory: t.dir,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    modelReasoningEffort: t.deep ? 'high' : 'medium',
    networkAccessEnabled: false,
    webSearchMode: 'live',
  };
  const thread = t.threadId ? codex.resumeThread(t.threadId, options) : codex.startThread(options);
  // 1ª mensagem da conversa: as instruções do app vão junto (o Codex não tem "append" de sistema)
  const input = t.threadId ? t.prompt : `<instrucoes_do_sistema>\n${t.system}\n</instrucoes_do_sistema>\n\n${t.prompt}`;

  const started = Date.now();
  let rounds = 0;
  let error = '';
  let usage: { input: number; output: number } | null = null;
  try {
    const { events } = await thread.runStreamed(input, { signal: t.signal });
    for await (const ev of events as AsyncGenerator<ThreadEvent>) {
      if (ev.type === 'thread.started') t.onThread(ev.thread_id);
      else if (ev.type === 'item.started') {
        const it = ev.item;
        if (it.type === 'mcp_tool_call') t.onTool(it.tool, '');
        else if (it.type === 'command_execution') t.onTool('comando', it.command.slice(0, 120));
        else if (it.type === 'web_search') t.onTool('WebSearch', '');
        rounds++;
      } else if (ev.type === 'item.completed') {
        const it = ev.item;
        if (it.type === 'agent_message' && it.text.trim()) t.onText(it.text);
        else if (it.type === 'mcp_tool_call' && (it.status === 'failed' || it.error)) t.onDenied(it.tool, it.error?.message ?? 'falhou');
        else if (it.type === 'file_change' && it.status === 'failed') t.onDenied('arquivo', 'gravação nativa bloqueada (use as ferramentas do app)');
        else if (it.type === 'error' && !isAuthError(it.message)) t.onDenied('codex', it.message);
      } else if (ev.type === 'turn.completed') {
        usage = { input: ev.usage.input_tokens, output: ev.usage.output_tokens };
      } else if (ev.type === 'turn.failed') error = ev.error.message;
      else if (ev.type === 'error') error = ev.message;
    }
  } catch (e) {
    error = t.signal.aborted ? 'Resposta interrompida.' : (e as Error).message;
  }
  if (error && isAuthError(error)) error = 'O login do Codex expirou ou não foi feito. Rode `npm run login:codex` uma vez no terminal para entrar com a sua conta do ChatGPT.';
  else if (error && !t.signal.aborted) error = `O Codex terminou com erro. ${error.replace(/WARNING:[^\n]*\n?/g, '').trim().slice(0, 400)}`;
  return {
    ok: !error && !t.signal.aborted,
    error: error || undefined,
    stats: { rounds: Math.max(1, rounds), ms: Date.now() - started, inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0 },
  };
}

const isAuthError = (msg: string) => /401|unauthori[sz]ed|not logged in|login/i.test(msg);
