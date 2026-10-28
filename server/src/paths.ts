import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Raiz do projeto Sostituto (onde ficam package.json, CLAUDE.md, config.json). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// SOSTITUTO_CONFIG / SOSTITUTO_DATA permitem rodar uma instância de teste isolada
export const DATA_DIR = process.env.SOSTITUTO_DATA ? path.resolve(process.env.SOSTITUTO_DATA) : path.join(ROOT, 'data');
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
export const CONFIG_FILE = process.env.SOSTITUTO_CONFIG ? path.resolve(process.env.SOSTITUTO_CONFIG) : path.join(ROOT, 'config.json');
export const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');
export const PROMPT_ASSISTENTE = path.join(ROOT, 'prompt-assistente.md');
/** Cópia do prompt original, para "Restaurar padrão". */
export const PROMPT_PADRAO = path.join(ROOT, 'prompt-assistente.padrao.md');
/** Instruções sob demanda (importação, fechamento…), lidas só quando a tarefa aparece. */
export const INSTRUCTIONS_DIR = path.join(ROOT, 'instruções');
/** settings.json geral, usado por todas as músicas que não têm um local. */
export const GENERAL_SETTINGS = path.join(ROOT, 'claude-settings', 'settings.json');
/** Modelo versionado do settings geral (o settings.json de cada máquina fica fora do git). */
export const GENERAL_SETTINGS_EXAMPLE = path.join(ROOT, 'claude-settings', 'settings.example.json');

/**
 * Arquivos de cada usuário que não vão para o git (prompt editado, settings geral): na
 * primeira execução são criados a partir dos modelos versionados. Nunca sobrescreve.
 */
export function ensureUserFiles() {
  for (const [file, template] of [
    [PROMPT_ASSISTENTE, PROMPT_PADRAO],
    [GENERAL_SETTINGS, GENERAL_SETTINGS_EXAMPLE],
  ]) {
    if (fs.existsSync(file) || !fs.existsSync(template)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(template, file, fs.constants.COPYFILE_EXCL);
  }
}

export const MUSICAS = 'Músicas';
export const SONG_SUBDIRS = ['Sessões', 'Ideias', 'Análises', 'Referências', 'Export'];
export const INDEX_FILE = '_índice.md';

export const nfc = (s: string) => s.normalize('NFC');

/** Windows e macOS (padrão) não diferenciam maiúsculas; comparamos caminhos assim. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
export const cmpKey = (p: string) => (CASE_INSENSITIVE ? nfc(p).toLowerCase() : nfc(p));

/** true se `child` está dentro de `parent` (ou é o próprio). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(cmpKey(path.resolve(parent)), cmpKey(path.resolve(child)));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Procura uma entrada no diretório comparando em NFC (no macOS o disco pode
 * devolver nomes em NFD). Devolve o nome real em disco ou null.
 */
export function findEntry(dir: string, name: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const target = cmpKey(name);
  for (const entry of fs.readdirSync(dir)) {
    if (cmpKey(entry) === target) return entry;
  }
  return null;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Nome de arquivo/pasta seguro no Windows e no Mac, preservando acentos e espaços. */
export function safeName(raw: string): string {
  let s = nfc(raw)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

/** Data local no formato AAAA-MM-DD. */
export function today(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
