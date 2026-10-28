import fs from 'node:fs';
import path from 'node:path';
import { isInside, nfc } from './paths.js';

export interface TreeNode {
  name: string;
  /** caminho relativo à pasta da música, com "/" */
  path: string;
  type: 'dir' | 'file';
  ext?: string;
  size?: number;
  mtime?: string;
  children?: TreeNode[];
}

const MAX_DEPTH = 6;

/** Ordem fixa das subpastas da música; o resto vem depois, em ordem alfabética. */
const ORDER = ['_índice.md', 'Sessões', 'Ideias', 'Análises', 'Referências', 'Export'];
const rank = (n: string) => {
  const i = ORDER.indexOf(n);
  return i < 0 ? ORDER.length : i;
};

export function listTree(dir: string, rel = '', depth = 0): TreeNode[] {
  if (depth > MAX_DEPTH) return [];
  const nodes: TreeNode[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .claude, .DS_Store, etc.
    const name = nfc(e.name);
    const relPath = rel ? `${rel}/${name}` : name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      nodes.push({ name, path: relPath, type: 'dir', children: listTree(full, relPath, depth + 1) });
    } else if (e.isFile()) {
      const st = fs.statSync(full);
      nodes.push({
        name,
        path: relPath,
        type: 'file',
        ext: path.extname(name).slice(1).toLowerCase(),
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
    }
  }
  return nodes.sort((a, b) => {
    if (depth === 0 && rank(a.name) !== rank(b.name)) return rank(a.name) - rank(b.name);
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    // sessões (AAAA-MM-DD) da mais recente para a mais antiga
    if (rel === 'Sessões') return b.name.localeCompare(a.name);
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

/**
 * Resolve um caminho relativo vindo do navegador para dentro da pasta da música.
 * Compara em NFC e devolve o caminho real em disco (que pode estar em NFD no Mac).
 */
export function resolveSongFile(songDir: string, rel: string): string {
  let cur = songDir;
  for (const part of nfc(rel).split(/[\\/]+/).filter(Boolean)) {
    if (part === '..' || part === '.') throw Object.assign(new Error('Caminho inválido'), { statusCode: 400 });
    const real = fs.existsSync(cur) ? fs.readdirSync(cur).find((n) => nfc(n) === part) : undefined;
    if (!real) throw Object.assign(new Error(`Arquivo não encontrado: ${rel}`), { statusCode: 404 });
    cur = path.join(cur, real);
  }
  if (!isInside(songDir, cur) || !fs.statSync(cur).isFile()) {
    throw Object.assign(new Error('Caminho inválido'), { statusCode: 400 });
  }
  return cur;
}

export const MIME: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  musicxml: 'application/vnd.recordare.musicxml+xml; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  mxl: 'application/vnd.recordare.musicxml',
  mid: 'audio/midi',
  midi: 'audio/midi',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  json: 'application/json; charset=utf-8',
};
