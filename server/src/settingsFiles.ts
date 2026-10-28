import fs from 'node:fs';
import path from 'node:path';
import { GENERAL_SETTINGS, findEntry, today } from './paths.js';

/** <música>/.claude/settings.json (pode ainda não existir). */
export function localSettingsPath(songDir: string): string {
  const claudeDir = findEntry(songDir, '.claude') ?? '.claude';
  return path.join(songDir, claudeDir, 'settings.json');
}

export function readSettings(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/** Valida o JSON e grava de forma atômica. */
export function writeSettings(file: string, content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw Object.assign(new Error(`JSON inválido: ${(e as Error).message}`), { statusCode: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('O settings.json precisa ser um objeto { ... }'), { statusCode: 400 });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content.replace(/\r\n/g, '\n'), 'utf8');
  fs.renameSync(tmp, file);
}

/** Cria o settings local da música a partir de uma cópia do geral. */
export function createLocal(songDir: string): string {
  const file = localSettingsPath(songDir);
  if (fs.existsSync(file)) throw Object.assign(new Error('Esta música já tem settings local'), { statusCode: 409 });
  writeSettings(file, fs.readFileSync(GENERAL_SETTINGS, 'utf8'));
  return file;
}

/**
 * Volta a música para o settings geral sem apagar nada: o local é renomeado
 * para settings.desativado-AAAA-MM-DD.json (e -2, -3… se já existir).
 */
export function disableLocal(songDir: string): string {
  const file = localSettingsPath(songDir);
  if (!fs.existsSync(file)) throw Object.assign(new Error('Esta música não tem settings local'), { statusCode: 404 });
  const base = path.join(path.dirname(file), `settings.desativado-${today()}`);
  let target = `${base}.json`;
  for (let i = 2; fs.existsSync(target); i++) target = `${base}-${i}.json`;
  fs.renameSync(file, target);
  return target;
}
