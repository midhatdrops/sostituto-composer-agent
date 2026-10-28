import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_FILE, MUSICAS, findEntry, nfc } from './paths.js';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Modelo/esforço do dia a dia e do modo "pensar mais" (análises, importação). */
export interface AssistantConfig {
  model: string;
  effort: Effort;
  deepModel: string;
  deepEffort: Effort;
}

export interface Config {
  vaultPath: string | null;
  port: number;
  assistant: AssistantConfig;
}

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'rápido e equilibrado' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'mais profundo, gasta mais do limite' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'o mais rápido e econômico' },
];
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_ASSISTANT: AssistantConfig = {
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  deepModel: 'claude-opus-5-5',
  deepEffort: 'high',
};

const DEFAULTS: Config = { vaultPath: null, port: 4517, assistant: DEFAULT_ASSISTANT };

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULTS, ...raw, assistant: { ...DEFAULT_ASSISTANT, ...raw.assistant } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAssistant(raw: Partial<AssistantConfig>): AssistantConfig {
  const ids = MODELS.map((m) => m.id);
  const cur = loadConfig();
  const next = { ...cur.assistant };
  for (const k of ['model', 'deepModel'] as const) {
    const v = raw[k];
    if (v === undefined) continue;
    if (!ids.includes(v)) throw Object.assign(new Error(`Modelo inválido: ${v}`), { statusCode: 400 });
    next[k] = v;
  }
  for (const k of ['effort', 'deepEffort'] as const) {
    const v = raw[k];
    if (v === undefined) continue;
    if (!EFFORTS.includes(v)) throw Object.assign(new Error(`Esforço inválido: ${v}`), { statusCode: 400 });
    next[k] = v;
  }
  saveConfig({ ...cur, assistant: next });
  return next;
}

export function saveConfig(cfg: Config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** Pasta usada quando ainda não há vault no config.json: <home>/Sostituto. */
export const DEFAULT_VAULT = path.join(os.homedir(), 'Sostituto');

/** Garante um vault configurado (sem tela de escolha): usa o padrão se faltar. */
export function ensureVault(): Config {
  const cfg = loadConfig();
  if (cfg.vaultPath && fs.existsSync(cfg.vaultPath)) {
    if (!findEntry(cfg.vaultPath, MUSICAS)) fs.mkdirSync(path.join(cfg.vaultPath, MUSICAS));
    return cfg;
  }
  if (cfg.vaultPath) return cfg; // configurado mas inacessível (ex.: HD externo desconectado): não troca sozinho
  fs.mkdirSync(DEFAULT_VAULT, { recursive: true });
  return setVault(DEFAULT_VAULT);
}

/** Valida e grava a pasta do vault; cria Músicas/ se ainda não existir. */
export function setVault(raw: string): Config {
  const vault = path.resolve(nfc(raw.trim()));
  if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
    throw new Error(`Pasta não encontrada: ${vault}`);
  }
  if (!findEntry(vault, MUSICAS)) fs.mkdirSync(path.join(vault, MUSICAS));
  const cfg = { ...loadConfig(), vaultPath: vault };
  saveConfig(cfg);
  return cfg;
}

/** Caminho real (em disco) de <vault>/Músicas. */
export function musicasDir(cfg = loadConfig()): string {
  if (!cfg.vaultPath) throw new Error('Vault ainda não configurado');
  const real = findEntry(cfg.vaultPath, MUSICAS) ?? MUSICAS;
  return path.join(cfg.vaultPath, real);
}
