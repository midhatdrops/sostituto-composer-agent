/**
 * Geração de arquivos MIDI (SMF formato 1) sem dependências, para a ferramenta `gerar_midi`.
 * O assistente descreve a música em termos de músico (compasso, tempo, nota, duração em
 * semínimas) e o app monta o arquivo. A posição é sempre 1-based: compasso 1, tempo 1.
 */

const PPQ = 480;

export interface MidiNoteIn {
  /** "C4" (dó central = 60), "Eb3", "F#2", número MIDI, ou lista para acorde */
  nota: string | number | (string | number)[];
  compasso: number;
  /** tempo dentro do compasso, 1-based; aceita fração (1.5 = colcheia depois do tempo 1) */
  tempo?: number;
  /** em semínimas (1 = semínima, 0.5 = colcheia, 4 = semibreve em 4/4) */
  duracao: number;
  vel?: number;
}

export interface MidiTrackIn {
  nome: string;
  /** programa General MIDI 0–127 (0 = piano); ignorado na bateria */
  instrumento?: number;
  /** 1–16; 10 = bateria (mapa GM). Sem canal, o app escolhe um livre. */
  canal?: number;
  bateria?: boolean;
  notas: MidiNoteIn[];
}

export interface MidiSongIn {
  bpm: number;
  /** "4/4", "3/4", "6/8"… */
  compasso?: string;
  /** armadura: "Am", "C", "F#m", "Bb", "Lá menor", "Ré maior"… */
  tom?: string;
  titulo?: string;
  trilhas: MidiTrackIn[];
  marcadores?: { compasso: number; tempo?: number; texto: string }[];
}

export interface MidiBuildResult {
  bytes: Uint8Array;
  tracks: number;
  notes: number;
  bars: number;
  seconds: number;
}

/* ------------------------------ conversões ------------------------------ */

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SOLFEGE: Record<string, string> = { do: 'C', dó: 'C', re: 'D', ré: 'D', mi: 'E', fa: 'F', fá: 'F', sol: 'G', la: 'A', lá: 'A', si: 'B' };

/** "C4" → 60 (dó central = C4), "Bb2" → 46, "F#5" → 78; número passa direto. */
export function noteNumber(n: string | number): number {
  if (typeof n === 'number') {
    if (!Number.isInteger(n) || n < 0 || n > 127) throw new Error(`nota fora de 0–127: ${n}`);
    return n;
  }
  const m = n.trim().match(/^([A-Ga-g])(#{1,2}|b{1,2}|♯|♭)?(-?\d)$/);
  if (!m) throw new Error(`nota inválida: "${n}" (use ex.: C4, Eb3, F#2 ou número MIDI)`);
  const acc = m[2] ?? '';
  const shift = acc.startsWith('#') || acc === '♯' ? acc.length || 1 : acc.startsWith('b') || acc === '♭' ? -(acc.length || 1) : 0;
  const v = (Number(m[3]) + 1) * 12 + LETTER[m[1].toUpperCase()] + shift;
  if (v < 0 || v > 127) throw new Error(`nota fora da extensão MIDI: "${n}"`);
  return v;
}

const MAJOR_SF: Record<string, number> = { Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
const MINOR_SF: Record<string, number> = { Ab: -7, Eb: -6, Bb: -5, F: -4, C: -3, G: -2, D: -1, A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7 };

/** "Am", "F#m", "Bb", "Lá menor", "ré maior" → armadura do meta-evento 0x59 (ou null se não reconhecer). */
export function keySignature(tom: string): { sf: number; minor: boolean } | null {
  let t = tom.trim().normalize('NFC');
  const sol = t.toLowerCase().match(/^(dó|do|ré|re|mi|fá|fa|sol|lá|la|si)(\s*(sustenido|#|bemol|b))?/);
  if (sol) t = SOLFEGE[sol[1]] + (sol[3] ? (/sust|#/.test(sol[3]) ? '#' : 'b') : '') + t.slice(sol[0].length);
  const m = t.match(/^([A-Ga-g])([#b♯♭]?)\s*(m(?!aj)|min|menor|minor)?\s*(maior|major|maj)?$/i);
  if (!m) return null;
  const root = m[1].toUpperCase() + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]);
  const minor = !!m[3];
  const sf = (minor ? MINOR_SF : MAJOR_SF)[root];
  return sf === undefined ? null : { sf, minor };
}

function timeSignature(s?: string): { num: number; den: number } {
  const m = (s ?? '4/4').trim().match(/^(\d{1,2})\s*\/\s*(1|2|4|8|16|32)$/);
  if (!m || Number(m[1]) < 1) throw new Error(`fórmula de compasso inválida: "${s}" (use ex.: 4/4, 3/4, 6/8)`);
  return { num: Number(m[1]), den: Number(m[2]) };
}

/* ------------------------------ escrita SMF ------------------------------ */

const vlq = (n: number): number[] => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const text = (s: string) => [...new TextEncoder().encode(s)];
const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];
const chunk = (id: string, data: number[]) => [...text(id), (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff, ...data];

interface Ev {
  tick: number;
  /** ordem no mesmo tick: metas, programa, note-off, note-on */
  order: number;
  data: number[];
}

function encodeTrack(events: Ev[], endTick: number): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  out.push(...vlq(Math.max(0, endTick - last)), ...meta(0x2f, []));
  return chunk('MTrk', out);
}

const LIMITS = { tracks: 32, notes: 20000, bars: 2000 };

/** Monta o arquivo. Lança erro com mensagem clara (em português) se algo não fizer sentido. */
export function buildMidi(song: MidiSongIn): MidiBuildResult {
  if (!(song.bpm >= 20 && song.bpm <= 400)) throw new Error(`bpm fora de 20–400: ${song.bpm}`);
  if (!song.trilhas?.length) throw new Error('nenhuma trilha');
  if (song.trilhas.length > LIMITS.tracks) throw new Error(`no máximo ${LIMITS.tracks} trilhas`);
  const sig = timeSignature(song.compasso);
  const beatTicks = (PPQ * 4) / sig.den; // um "tempo" da fórmula (semínima em x/4, colcheia em x/8)
  const barTicks = beatTicks * sig.num;
  const at = (compasso: number, tempo = 1, where = '') => {
    if (!Number.isInteger(compasso) || compasso < 1 || compasso > LIMITS.bars) throw new Error(`${where}compasso inválido: ${compasso}`);
    if (!(tempo >= 1 && tempo < sig.num + 1)) throw new Error(`${where}tempo ${tempo} fora do compasso ${sig.num}/${sig.den}`);
    return Math.round((compasso - 1) * barTicks + (tempo - 1) * beatTicks);
  };

  // trilha 0: andamento, fórmula, armadura, título e marcadores
  const conductor: Ev[] = [
    { tick: 0, order: 0, data: meta(0x51, (() => { const us = Math.round(60e6 / song.bpm); return [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]; })()) },
    { tick: 0, order: 0, data: meta(0x58, [sig.num, Math.log2(sig.den), 24, 8]) },
  ];
  if (song.titulo) conductor.unshift({ tick: 0, order: 0, data: meta(0x03, text(song.titulo)) });
  if (song.tom) {
    const k = keySignature(song.tom);
    if (!k) throw new Error(`tom não reconhecido: "${song.tom}" (use ex.: Am, F#m, Bb, "Lá menor")`);
    conductor.push({ tick: 0, order: 0, data: meta(0x59, [k.sf & 0xff, k.minor ? 1 : 0]) });
  }
  for (const m of song.marcadores ?? []) conductor.push({ tick: at(m.compasso, m.tempo, 'marcador: '), order: 0, data: meta(0x06, text(m.texto)) });

  // canais: bateria no 10; as outras trilhas pegam o próximo livre
  const used = new Set(song.trilhas.map((t) => t.canal).filter((c): c is number => !!c));
  let next = 1;
  const freeChannel = () => {
    while (next === 10 || used.has(next)) next++;
    if (next > 16) throw new Error('mais de 15 trilhas melódicas: defina "canal" manualmente (canais podem se repetir)');
    used.add(next);
    return next;
  };

  const tracks: Ev[][] = []; // codificadas no fim, quando o último compasso for conhecido
  let totalNotes = 0;
  let endTick = barTicks; // pelo menos um compasso
  for (const [i, t] of song.trilhas.entries()) {
    const where = `trilha "${t.nome || i + 1}": `;
    const drums = t.bateria || t.canal === 10;
    const ch = (drums ? 10 : t.canal ?? freeChannel()) - 1;
    if (ch < 0 || ch > 15) throw new Error(`${where}canal fora de 1–16`);
    const evs: Ev[] = [{ tick: 0, order: 0, data: meta(0x03, text(t.nome || `Trilha ${i + 1}`)) }];
    if (!drums) {
      const prog = t.instrumento ?? 0;
      if (!Number.isInteger(prog) || prog < 0 || prog > 127) throw new Error(`${where}instrumento GM fora de 0–127`);
      evs.push({ tick: 0, order: 1, data: [0xc0 | ch, prog] });
    }
    for (const n of t.notas ?? []) {
      const start = at(n.compasso, n.tempo ?? 1, where);
      if (!(n.duracao > 0 && n.duracao <= 64)) throw new Error(`${where}duração inválida no compasso ${n.compasso}: ${n.duracao}`);
      const end = start + Math.max(1, Math.round(n.duracao * PPQ));
      const vel = Math.min(127, Math.max(1, Math.round(n.vel ?? (drums ? 100 : 90))));
      for (const p of Array.isArray(n.nota) ? n.nota : [n.nota]) {
        const key = noteNumber(p);
        evs.push({ tick: start, order: 3, data: [0x90 | ch, key, vel] });
        evs.push({ tick: end, order: 2, data: [0x80 | ch, key, 0] });
        totalNotes++;
      }
      endTick = Math.max(endTick, end);
    }
    if (totalNotes > LIMITS.notes) throw new Error(`mais de ${LIMITS.notes} notas`);
    tracks.push(evs);
  }
  if (!totalNotes) throw new Error('nenhuma nota nas trilhas');

  // fecha no fim do último compasso usado
  const bars = Math.ceil(endTick / barTicks);
  const finalTick = bars * barTicks;
  const header = chunk('MThd', [0, 1, ((tracks.length + 1) >> 8) & 0xff, (tracks.length + 1) & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  const body = [encodeTrack(conductor, finalTick), ...tracks.map((evs) => encodeTrack(evs, finalTick))];
  const bytes = new Uint8Array([...header, ...body.flat()]);
  return { bytes, tracks: tracks.length, notes: totalNotes, bars, seconds: (finalTick / PPQ) * (60 / song.bpm) };
}

/* ------------------------------ nome e gravação ------------------------------ */

/**
 * Nome de arquivo só com letras sem acento, números, espaço, ponto, hífen e sublinhado
 * (pedido do usuário: os MIDI vão para o Ableton e outros programas, sem acentos).
 */
export function asciiName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\.midi?$/i, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 100);
}

/**
 * Próximo nome livre na pasta (nunca sobrescreve):
 * - sem nome pedido: "<música> <data>-midi-v1.mid", v2, v3… (a versão recomeça a cada dia);
 * - com nome pedido: "<nome>.mid"; se já existir, "<nome>-v2.mid", "-v3"…
 */
export function nextMidiName(existing: string[], song: string, date: string, requested?: string): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const wanted = requested ? asciiName(requested) : '';
  if (wanted) {
    if (!taken.has(`${wanted}.mid`.toLowerCase())) return `${wanted}.mid`;
    for (let v = 2; ; v++) if (!taken.has(`${wanted}-v${v}.mid`.toLowerCase())) return `${wanted}-v${v}.mid`;
  }
  const base = `${asciiName(song) || 'musica'} ${date}-midi-v`;
  const prefix = base.toLowerCase();
  const version = (n: string) => {
    const l = n.toLowerCase();
    const v = l.startsWith(prefix) && l.endsWith('.mid') ? l.slice(prefix.length, -4) : '';
    return /^\d+$/.test(v) ? Number(v) : 0;
  };
  const max = existing.reduce((m, n) => Math.max(m, version(n)), 0);
  return `${base}${max + 1}.mid`;
}
