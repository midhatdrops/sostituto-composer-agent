import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { musicasDir } from './config.js';
import { SONG_SUBDIRS, isInside, nfc, safeName, today } from './paths.js';
import { midiDuration, midiReport, parseMidi } from './midi.js';
import { createSong, songDir } from './vault.js';

/** Pasta onde ficam as cópias intactas dos originais importados (somente leitura para o assistente). */
export const IMPORT_DIR = 'Importado';

const SKIP = (name: string) => name.startsWith('.') || name === 'node_modules';

const httpError = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

/* ----------------------- navegador de pastas (somente leitura) ----------------------- */

export interface FsEntry {
  name: string;
  type: 'dir' | 'file';
  ext: string;
}

/** Pontos de partida do navegador: pasta do usuário, vault, discos/volumes. */
export function fsRoots(vault: string | null): { label: string; path: string }[] {
  const roots = [{ label: 'Pasta do usuário', path: os.homedir() }];
  if (vault) roots.push({ label: 'Vault do Sostituto', path: vault });
  if (process.platform === 'win32') {
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (fs.existsSync(`${l}:\\`)) roots.push({ label: `Disco ${l}:`, path: `${l}:\\` });
  } else if (process.platform === 'darwin' && fs.existsSync('/Volumes')) {
    for (const v of fs.readdirSync('/Volumes')) roots.push({ label: v, path: path.join('/Volumes', v) });
  } else {
    roots.push({ label: '/', path: '/' });
  }
  return roots;
}

export function fsList(dir: string): { path: string; parent: string | null; entries: FsEntry[] } {
  const full = path.resolve(dir);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw httpError(`Pasta não encontrada: ${full}`, 404);
  const entries: FsEntry[] = [];
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    if (e.isDirectory()) entries.push({ name: nfc(e.name), type: 'dir', ext: '' });
    else if (e.isFile()) entries.push({ name: nfc(e.name), type: 'file', ext: path.extname(e.name).slice(1).toLowerCase() });
  }
  entries.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'pt-BR')));
  const parent = path.dirname(full);
  return { path: full, parent: parent === full ? null : parent, entries };
}

/* ------------------------------------ importação ------------------------------------ */

function walk(dir: string, cb: (file: string, size: number) => void) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, cb);
    else if (e.isFile()) cb(full, fs.statSync(full).size);
  }
}

/** Nome sugerido: "música:" do frontmatter do resumo, senão o nome da pasta. */
function suggestName(summary: string, folder: string): string {
  try {
    const head = fs.readFileSync(summary, 'utf8').slice(0, 4000);
    const fm = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const m = fm?.[1].match(/^(?:música|musica|title|título|titulo|nome):\s*"?([^"\n]+?)"?\s*$/im);
    if (m && !m[1].includes('[[')) return safeName(m[1]);
  } catch {}
  return safeName(path.basename(folder));
}

export interface ImportPlan {
  summary: string;
  folder: string;
  files: number;
  bytes: number;
  types: Record<string, number>;
  /** a pasta já é uma música dentro de Músicas/: reorganiza no lugar */
  inPlace: boolean;
  suggestedName: string;
}

export function planImport(summaryPath: string): ImportPlan {
  const summary = path.resolve(nfc(summaryPath));
  if (!fs.existsSync(summary) || !fs.statSync(summary).isFile()) throw httpError('Arquivo de resumo não encontrado', 404);
  if (!/\.(md|txt)$/i.test(summary)) throw httpError('O resumo precisa ser um arquivo .md (ou .txt)', 400);

  const folder = path.dirname(summary);
  const musicas = musicasDir();
  let inPlace = false;
  if (isInside(musicas, folder)) {
    // dentro do vault: só vale se for a própria pasta de uma música (Músicas/<Música>/resumo.md)
    const rel = path.relative(musicas, folder).split(path.sep);
    if (rel.length !== 1 || !rel[0]) throw httpError('Dentro do vault, escolha um resumo que esteja direto na pasta da música.', 400);
    inPlace = true;
  } else if (isInside(folder, musicas)) {
    throw httpError('Essa pasta contém o vault do Sostituto. Escolha o resumo dentro da pasta da música.', 400);
  }

  let files = 0;
  let bytes = 0;
  const types: Record<string, number> = {};
  walk(folder, (f, size) => {
    if (inPlace && isInside(path.join(folder, IMPORT_DIR), f)) return;
    files++;
    bytes += size;
    const ext = path.extname(f).slice(1).toLowerCase() || 'sem extensão';
    types[ext] = (types[ext] ?? 0) + 1;
  });
  return { summary, folder, files, bytes, types, inPlace, suggestedName: inPlace ? nfc(path.basename(folder)) : suggestName(summary, folder) };
}

/** Copia sem sobrescrever nada, pulando ocultos; devolve quantos arquivos copiou. */
function copyTree(src: string, dest: string, exclude?: (p: string) => boolean): number {
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const from = path.join(src, e.name);
    if (exclude?.(from)) continue;
    const to = path.join(dest, nfc(e.name));
    if (e.isDirectory()) n += copyTree(from, to, exclude);
    else if (e.isFile() && !fs.existsSync(to)) {
      fs.mkdirSync(dest, { recursive: true }); // só cria pastas que recebem arquivos
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      n++;
    }
  }
  return n;
}

export interface ImportResult {
  song: string;
  /** caminho, relativo à pasta da música, da cópia dos originais */
  importedDir: string;
  /** caminho, relativo à pasta da música, do resumo dentro da cópia */
  summaryRel: string;
  copied: number;
  exportCopied: number;
  inPlace: boolean;
  sourceFolder: string;
}

/**
 * Importa uma música:
 * - de fora do vault: cria Músicas/<nome>/ e copia a pasta original para Importado/<pasta>/;
 *   o conteúdo de um Export/ original também vai para o Export/ da música (é do usuário);
 * - de dentro de Músicas/: faz um backup dos originais em Importado/backup-AAAA-MM-DD/ e
 *   cria as subpastas do Sostituto que faltarem. Nada é movido nem apagado.
 */
export function runImport(summaryPath: string, name: string): ImportResult {
  const plan = planImport(summaryPath);
  const toPosix = (p: string) => p.split(path.sep).join('/');

  if (plan.inPlace) {
    const dir = songDir(plan.suggestedName);
    const base = path.join(dir, IMPORT_DIR, `backup-${today()}`);
    let backup = base;
    for (let i = 2; fs.existsSync(backup); i++) backup = `${base}-${i}`;
    const importRoot = path.join(dir, IMPORT_DIR);
    const copied = copyTree(dir, backup, (p) => isInside(importRoot, p));
    for (const sub of SONG_SUBDIRS) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    return {
      song: plan.suggestedName,
      importedDir: toPosix(path.relative(dir, backup)),
      summaryRel: nfc(toPosix(path.relative(dir, path.join(backup, path.relative(plan.folder, plan.summary))))),
      copied,
      exportCopied: 0,
      inPlace: true,
      sourceFolder: plan.folder,
    };
  }

  const song = createSong(name || plan.suggestedName);
  const dir = songDir(song.name);
  const dest = path.join(dir, IMPORT_DIR, safeName(path.basename(plan.folder)) || 'original');
  const copied = copyTree(plan.folder, dest);
  const exportSrc = fs.readdirSync(plan.folder).find((n) => n.toLowerCase() === 'export');
  const exportCopied =
    exportSrc && fs.statSync(path.join(plan.folder, exportSrc)).isDirectory()
      ? copyTree(path.join(plan.folder, exportSrc), path.join(dir, 'Export'))
      : 0;
  return {
    song: song.name,
    importedDir: toPosix(path.relative(dir, dest)),
    summaryRel: nfc(toPosix(path.relative(dir, path.join(dest, path.relative(plan.folder, plan.summary))))),
    copied,
    exportCopied,
    inPlace: false,
    sourceFolder: plan.folder,
  };
}

/* ------------------------------ importação de MIDI ------------------------------ */

const MIDI_EXT = /\.(mid|midi|rmi|kar)$/i;

export interface MidiPlan {
  file: string;
  bytes: number;
  suggestedName: string;
  /** resumo curto para a tela: o resto vai para a leitura completa em Análises/ */
  tracks: number;
  bpm: number | null;
  timeSig: string | null;
  durationSec: number;
}

function readMidi(filePath: string) {
  const file = path.resolve(nfc(filePath));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw httpError('Arquivo MIDI não encontrado', 404);
  if (!MIDI_EXT.test(file)) throw httpError('Escolha um arquivo .mid (ou .midi)', 400);
  const size = fs.statSync(file).size;
  if (size > 20 * 1048576) throw httpError('O arquivo tem mais de 20 MB; não parece um MIDI.', 400);
  try {
    return { file, size, info: parseMidi(fs.readFileSync(file)) };
  } catch (e) {
    throw httpError((e as Error).message, 400);
  }
}

export function planMidiImport(filePath: string): MidiPlan {
  const { file, size, info } = readMidi(filePath);
  return {
    file,
    bytes: size,
    suggestedName: safeName(path.basename(file).replace(MIDI_EXT, '').replace(/[_]+/g, ' ')),
    tracks: info.tracks.filter((t) => t.notes).length,
    bpm: info.tempos[0]?.bpm ?? null,
    timeSig: info.timeSigs[0] ? `${info.timeSigs[0].num}/${info.timeSigs[0].den}` : null,
    durationSec: Math.round(midiDuration(info)),
  };
}

export interface MidiImportResult {
  song: string;
  /** caminhos relativos à pasta da música */
  midiRel: string;
  reportRel: string;
  sourceFile: string;
}

/**
 * Cria a música a partir de um MIDI: o original vai intacto para Importado/<nome>/ e a
 * leitura objetiva do arquivo (feita aqui, porque o assistente não lê binário) vai para
 * Análises/. O resto (gênero, estrutura, estado) o assistente pergunta na conversa.
 */
export function runMidiImport(filePath: string, name: string): MidiImportResult {
  const { file, info } = readMidi(filePath);
  const song = createSong(name || path.basename(file).replace(MIDI_EXT, ''));
  const dir = songDir(song.name);
  const toPosix = (p: string) => p.split(path.sep).join('/');
  const base = safeName(path.basename(file).replace(MIDI_EXT, '')) || 'original';

  const destDir = path.join(dir, IMPORT_DIR, base);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, nfc(path.basename(file)));
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  const midiRel = toPosix(path.relative(dir, dest));

  const report = path.join(dir, 'Análises', `${base} - leitura do MIDI.md`);
  fs.writeFileSync(report, midiReport(info, path.basename(file), midiRel, today()), { encoding: 'utf8', flag: 'wx' });
  return { song: song.name, midiRel, reportRel: toPosix(path.relative(dir, report)), sourceFile: file };
}
