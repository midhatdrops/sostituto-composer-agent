import type { TreeNode } from './api';

export interface FileType {
  id: string;
  label: string;
  icon: string;
  exts: string[];
}

export const FILE_TYPES: FileType[] = [
  { id: 'md', label: 'Notas', icon: '📝', exts: ['md', 'txt'] },
  { id: 'midi', label: 'MIDI', icon: '🎹', exts: ['mid', 'midi'] },
  { id: 'xml', label: 'MusicXML', icon: '🎼', exts: ['musicxml', 'mxl', 'xml'] },
  { id: 'mscz', label: 'MuseScore', icon: '🔒', exts: ['mscz', 'mscx'] },
  { id: 'audio', label: 'Áudio', icon: '🔊', exts: ['wav', 'mp3', 'aif', 'aiff', 'flac', 'm4a', 'ogg'] },
];
const OTHER: FileType = { id: 'other', label: 'Outros', icon: '📄', exts: [] };

export function typeOf(ext = ''): FileType {
  return FILE_TYPES.find((t) => t.exts.includes(ext)) ?? OTHER;
}

/** Todos os tipos possíveis, incluindo "Outros", para os chips do filtro. */
export const ALL_TYPES = [...FILE_TYPES, OTHER];

export function walkFiles(nodes: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    else walkFiles(n.children ?? [], out);
  }
  return out;
}

/** Mantém só os arquivos dos tipos escolhidos (pastas vazias somem quando há filtro). */
export function filterTree(nodes: TreeNode[], types: Set<string>): TreeNode[] {
  if (types.size === 0) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'file') {
      if (types.has(typeOf(n.ext).id)) out.push(n);
    } else {
      const children = filterTree(n.children ?? [], types);
      if (children.length) out.push({ ...n, children });
    }
  }
  return out;
}

/** Acha o arquivo de um [[wikilink]] pelo nome (sem extensão), preferindo .md. */
export function findByWikilink(tree: TreeNode[], target: string): TreeNode | undefined {
  const key = target.split('|')[0].split('#')[0].trim().normalize('NFC').toLowerCase();
  const files = walkFiles(tree);
  const matches = files.filter((f) => {
    const n = f.name.toLowerCase();
    return n === key || n.replace(/\.[^.]+$/, '') === key || f.path.toLowerCase().replace(/\.md$/, '') === key;
  });
  return matches.find((f) => f.ext === 'md') ?? matches[0];
}
