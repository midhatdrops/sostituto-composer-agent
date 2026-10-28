import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from './paths.js';

/**
 * Providers de IA do assistente. Todos usam a assinatura do usuário (sem chave de API):
 * - claude: Claude Agent SDK, login do `claude`;
 * - codex: @openai/codex-sdk (CLI `codex`), login do ChatGPT;
 * - kimi: Kimi Code CLI em modo não interativo, login Kimi Code.
 * Codex e Kimi rodam com um HOME só do app (data/), para não misturar com a config do usuário.
 */
export type ProviderId = 'claude' | 'codex' | 'kimi';
export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'kimi'];
export const DEFAULT_PROVIDER: ProviderId = 'claude';

export const isProvider = (p: unknown): p is ProviderId => typeof p === 'string' && (PROVIDER_IDS as string[]).includes(p);

export const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi' };

/** HOMEs só do app: login, sessões e configuração (hooks, MCP) desses CLIs. */
export const CODEX_HOME = path.join(DATA_DIR, 'codex-home');
export const KIMI_HOME = path.join(DATA_DIR, 'kimi-home');

/** Comando para o usuário fazer o login de cada provider (uma vez, no navegador). */
export const LOGIN_COMMAND: Record<ProviderId, string> = {
  claude: 'claude (e depois /login)',
  codex: 'npm run login:codex',
  kimi: 'npm run login:kimi',
};

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  installed: boolean;
  loggedIn: boolean;
  login: string;
}

/** Binário JS do Kimi Code: rodamos com o próprio node (sem .cmd/shell no Windows). */
export const KIMI_MAIN = path.join(ROOT, 'node_modules', '@moonshot-ai', 'kimi-code', 'dist', 'main.mjs');
const CODEX_PKG = path.join(ROOT, 'node_modules', '@openai', 'codex-sdk', 'package.json');

const nonEmpty = (f: string) => {
  try {
    return fs.statSync(f).size > 2;
  } catch {
    return false;
  }
};

/**
 * Situação de cada provider para a tela. O login é detectado pelos arquivos de credencial
 * que cada CLI grava no HOME do app; o do Claude é o do usuário (não dá para conferir sem rodar).
 */
export function providerStatus(): ProviderStatus[] {
  return PROVIDER_IDS.map((id) => {
    const installed = id === 'claude' ? true : id === 'codex' ? fs.existsSync(CODEX_PKG) : fs.existsSync(KIMI_MAIN);
    const loggedIn =
      id === 'claude'
        ? true
        : id === 'codex'
          ? nonEmpty(path.join(CODEX_HOME, 'auth.json'))
          : nonEmpty(path.join(KIMI_HOME, 'credentials.json')) || fs.existsSync(path.join(KIMI_HOME, 'credentials'));
    return { id, label: PROVIDER_LABEL[id], installed, loggedIn, login: LOGIN_COMMAND[id] };
  });
}
