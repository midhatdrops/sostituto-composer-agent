import fs from 'node:fs';
import path from 'node:path';
import { musicasDir } from './config.js';
import { INDEX_FILE, SONG_SUBDIRS, findEntry, nfc, safeName, today } from './paths.js';

export interface SongInfo {
  name: string;
  updatedAt: string;
}

export function listSongs(): SongInfo[] {
  const dir = musicasDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({
      name: nfc(e.name),
      updatedAt: fs.statSync(path.join(dir, e.name)).mtime.toISOString(),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Pasta real da música (resolve diferença NFC/NFD e maiúsculas). */
export function songDir(name: string): string {
  const dir = musicasDir();
  const real = findEntry(dir, nfc(name));
  if (!real) throw Object.assign(new Error(`Música não encontrada: ${name}`), { statusCode: 404 });
  return path.join(dir, real);
}

/** _índice.md no formato do prompt-assistente.md; tom/BPM/gênero ficam em branco até o usuário definir. */
function indexTemplate(name: string): string {
  return `---
música: ${name}
tom:
bpm:
gênero:
referências: []
status: em andamento
---
## Intenção da faixa

## Estrutura atual

## Regras desta música
- Partitura original (.mscz) somente leitura.
- Pasta Export/ é só minha: o assistente não insere, altera, move, renomeia nem sobrescreve nada nela; só lê quando eu pedir.

## Onde paramos
Música criada em ${today()}.

## Referências pesquisadas

## Sessões

## Ideias

## Análises
`;
}

export function createSong(rawName: string): SongInfo {
  const name = safeName(rawName);
  if (!name) throw Object.assign(new Error('Nome inválido'), { statusCode: 400 });
  const dir = musicasDir();
  if (findEntry(dir, name)) throw Object.assign(new Error(`Já existe: ${name}`), { statusCode: 409 });

  const base = path.join(dir, name);
  fs.mkdirSync(base, { recursive: true });
  for (const sub of SONG_SUBDIRS) fs.mkdirSync(path.join(base, sub), { recursive: true });
  fs.writeFileSync(path.join(base, INDEX_FILE), indexTemplate(name), 'utf8');
  return { name, updatedAt: new Date().toISOString() };
}
