import { runCodexTurn } from './codex.js';
import { runKimiTurn } from './kimi.js';
import type { ProviderId } from './providers.js';

/**
 * Turno num provider que roda fora do processo (Codex, Kimi). O claude.ts monta o prompt e
 * cuida do que é comum (histórico, sessão do dia, fechamento); o executor só conversa com o CLI.
 */
export interface ExternalTurn {
  song: string;
  date: string;
  dir: string;
  musicasDir: string;
  /** o que vai neste turno (na 1ª vez já inclui contexto de abertura/resumo da conversa) */
  prompt: string;
  /** instruções de sistema (prompt do usuário + CLAUDE.md + aviso de ferramentas) */
  system: string;
  /** conversa do dia neste provider (ausente = começar uma nova) */
  threadId?: string;
  deep: boolean;
  mcpUrl: string;
  signal: AbortSignal;
  onThread: (id: string) => void;
  /** um bloco de texto da resposta (esses providers não mandam palavra por palavra) */
  onText: (text: string) => void;
  onTool: (name: string, detail: string) => void;
  onDenied: (name: string, reason: string) => void;
}

export interface ExternalResult {
  ok: boolean;
  error?: string;
  stats?: { rounds: number; ms: number; inputTokens: number; outputTokens: number };
}

export function runExternalTurn(provider: Exclude<ProviderId, 'claude'>, t: ExternalTurn): Promise<ExternalResult> {
  return provider === 'codex' ? runCodexTurn(t) : runKimiTurn(t);
}
