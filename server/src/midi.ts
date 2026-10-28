/**
 * Leitura de arquivos MIDI (SMF) sem dependências. Serve para a importação a partir de MIDI:
 * o assistente não tem terminal nem Python, então o app extrai os dados objetivos do arquivo
 * (andamento, compasso, armadura, trilhas, instrumentos, marcadores, extensão) e entrega em texto.
 */

const GM = (
  'Acoustic Grand Piano|Bright Acoustic Piano|Electric Grand Piano|Honky-tonk Piano|Electric Piano 1|Electric Piano 2|Harpsichord|Clavinet|' +
  'Celesta|Glockenspiel|Music Box|Vibraphone|Marimba|Xylophone|Tubular Bells|Dulcimer|' +
  'Drawbar Organ|Percussive Organ|Rock Organ|Church Organ|Reed Organ|Accordion|Harmonica|Tango Accordion|' +
  'Acoustic Guitar (nylon)|Acoustic Guitar (steel)|Electric Guitar (jazz)|Electric Guitar (clean)|Electric Guitar (muted)|Overdriven Guitar|Distortion Guitar|Guitar Harmonics|' +
  'Acoustic Bass|Electric Bass (finger)|Electric Bass (pick)|Fretless Bass|Slap Bass 1|Slap Bass 2|Synth Bass 1|Synth Bass 2|' +
  'Violin|Viola|Cello|Contrabass|Tremolo Strings|Pizzicato Strings|Orchestral Harp|Timpani|' +
  'String Ensemble 1|String Ensemble 2|Synth Strings 1|Synth Strings 2|Choir Aahs|Voice Oohs|Synth Voice|Orchestra Hit|' +
  'Trumpet|Trombone|Tuba|Muted Trumpet|French Horn|Brass Section|Synth Brass 1|Synth Brass 2|' +
  'Soprano Sax|Alto Sax|Tenor Sax|Baritone Sax|Oboe|English Horn|Bassoon|Clarinet|' +
  'Piccolo|Flute|Recorder|Pan Flute|Blown Bottle|Shakuhachi|Whistle|Ocarina|' +
  'Lead 1 (square)|Lead 2 (sawtooth)|Lead 3 (calliope)|Lead 4 (chiff)|Lead 5 (charang)|Lead 6 (voice)|Lead 7 (fifths)|Lead 8 (bass + lead)|' +
  'Pad 1 (new age)|Pad 2 (warm)|Pad 3 (polysynth)|Pad 4 (choir)|Pad 5 (bowed)|Pad 6 (metallic)|Pad 7 (halo)|Pad 8 (sweep)|' +
  'FX 1 (rain)|FX 2 (soundtrack)|FX 3 (crystal)|FX 4 (atmosphere)|FX 5 (brightness)|FX 6 (goblins)|FX 7 (echoes)|FX 8 (sci-fi)|' +
  'Sitar|Banjo|Shamisen|Koto|Kalimba|Bagpipe|Fiddle|Shanai|' +
  'Tinkle Bell|Agogo|Steel Drums|Woodblock|Taiko Drum|Melodic Tom|Synth Drum|Reverse Cymbal|' +
  'Guitar Fret Noise|Breath Noise|Seashore|Bird Tweet|Telephone Ring|Helicopter|Applause|Gunshot'
).split('|');

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (n: number) => `${NOTES[n % 12]}${Math.floor(n / 12) - 1}`;

/** Armadura do meta-evento 0x59 (sf = nº de sustenidos/bemóis, mi = menor). */
const MAJOR_BY_SF = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const MINOR_BY_SF = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#'];
const keyName = (sf: number, mi: number) => (mi ? `${MINOR_BY_SF[sf + 7]} menor` : `${MAJOR_BY_SF[sf + 7]} maior`);

export interface MidiTrack {
  index: number;
  name: string;
  instruments: string[];
  channels: number[];
  programs: string[];
  notes: number;
  low: number | null;
  high: number | null;
  firstTick: number | null;
  lastTick: number | null;
}

export interface MidiInfo {
  format: number;
  ppq: number;
  tracks: MidiTrack[];
  tempos: { tick: number; bpm: number }[];
  timeSigs: { tick: number; num: number; den: number }[];
  keySigs: { tick: number; name: string }[];
  markers: { tick: number; kind: 'marcador' | 'cue' | 'texto'; text: string }[];
  lyrics: string[];
  copyright: string[];
  lastTick: number;
  /** distribuição de alturas (classes 0–11) ponderada pela duração, sem a percussão */
  pitchClasses: number[];
}

const latin1 = (b: Uint8Array) => {
  // SMF não define codificação; tenta UTF-8 e cai para Latin-1
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).trim();
  } catch {
    return new TextDecoder('latin1').decode(b).trim();
  }
};

export function parseMidi(buf: Uint8Array): MidiInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  let pos = 0;
  // arquivos RIFF (.rmi) embrulham o SMF num bloco "data"
  if (tag(0) === 'RIFF') {
    const i = buf.indexOf(0x4d, 12); // 'M' de MThd
    for (let j = i; j >= 0 && j < buf.length - 4; j = buf.indexOf(0x4d, j + 1)) if (tag(j) === 'MThd') { pos = j; break; }
  }
  if (tag(pos) !== 'MThd') throw new Error('Não é um arquivo MIDI válido (cabeçalho MThd ausente).');
  const hlen = dv.getUint32(pos + 4);
  const format = dv.getUint16(pos + 8);
  const ntrks = dv.getUint16(pos + 10);
  const division = dv.getUint16(pos + 12);
  // divisão SMPTE é rara; aproxima como 480 por semínima só para ter números
  const ppq = division & 0x8000 ? 480 : division || 480;
  pos += 8 + hlen;

  const info: MidiInfo = {
    format, ppq, tracks: [], tempos: [], timeSigs: [], keySigs: [], markers: [], lyrics: [], copyright: [], lastTick: 0,
    pitchClasses: new Array(12).fill(0),
  };

  for (let t = 0; t < ntrks && pos + 8 <= buf.length; t++) {
    const len = dv.getUint32(pos + 4);
    const isTrack = tag(pos) === 'MTrk';
    const start = pos + 8;
    const end = Math.min(start + len, buf.length);
    pos = start + len;
    if (!isTrack) {
      t--;
      continue;
    }

    const tr: MidiTrack = { index: info.tracks.length + 1, name: '', instruments: [], channels: [], programs: [], notes: 0, low: null, high: null, firstTick: null, lastTick: null };
    const open = new Map<number, number>(); // (canal<<7 | nota) → tick de início
    let p = start;
    let tick = 0;
    let status = 0;
    const vlq = () => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const b = buf[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    };
    const closeNote = (key: number) => {
      const on = open.get(key);
      if (on === undefined) return;
      open.delete(key);
      if ((key >> 7) !== 9) info.pitchClasses[(key & 0x7f) % 12] += Math.max(1, tick - on);
    };

    while (p < end) {
      tick += vlq();
      let b = buf[p];
      if (b & 0x80) {
        p++;
        if (b < 0xf0) status = b;
      } else if (status) {
        b = status; // running status
      } else break;

      if (b === 0xff) {
        const type = buf[p++];
        const l = vlq();
        const data = buf.subarray(p, p + l);
        p += l;
        if (type === 0x2f) break;
        if (type === 0x51 && l === 3) info.tempos.push({ tick, bpm: Math.round((60e6 / ((data[0] << 16) | (data[1] << 8) | data[2])) * 100) / 100 });
        else if (type === 0x58 && l >= 2) info.timeSigs.push({ tick, num: data[0], den: 2 ** data[1] });
        else if (type === 0x59 && l === 2) info.keySigs.push({ tick, name: keyName((data[0] << 24) >> 24, data[1]) });
        else if (type === 0x03 && !tr.name) tr.name = latin1(data);
        else if (type === 0x04) tr.instruments.push(latin1(data));
        else if (type === 0x02) info.copyright.push(latin1(data));
        else if (type === 0x05) info.lyrics.push(latin1(data));
        else if (type === 0x06 || type === 0x07 || type === 0x01) {
          const text = latin1(data);
          if (text) info.markers.push({ tick, kind: type === 0x06 ? 'marcador' : type === 0x07 ? 'cue' : 'texto', text });
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        p += vlq();
        continue;
      }

      const ch = b & 0x0f;
      const kind = b & 0xf0;
      const d1 = buf[p++];
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : buf[p++];
      if (!tr.channels.includes(ch + 1)) tr.channels.push(ch + 1);
      if (kind === 0x90 && d2 > 0) {
        closeNote((ch << 7) | d1);
        open.set((ch << 7) | d1, tick);
        tr.notes++;
        tr.firstTick ??= tick;
        if (ch !== 9) {
          tr.low = tr.low === null ? d1 : Math.min(tr.low, d1);
          tr.high = tr.high === null ? d1 : Math.max(tr.high, d1);
        }
      } else if (kind === 0x80 || kind === 0x90) {
        closeNote((ch << 7) | d1);
        tr.lastTick = tick;
      } else if (kind === 0xc0) {
        const prog = ch === 9 ? 'Bateria (canal 10)' : GM[d1];
        if (!tr.programs.includes(prog)) tr.programs.push(prog);
      }
    }
    for (const key of [...open.keys()]) closeNote(key);
    if (tr.notes && tr.lastTick === null) tr.lastTick = tick;
    if (tr.notes && tr.channels.includes(10) && !tr.programs.some((x) => x.startsWith('Bateria'))) tr.programs.push('Bateria (canal 10)');
    info.lastTick = Math.max(info.lastTick, tr.lastTick ?? 0, tick);
    info.tracks.push(tr);
  }

  const byTick = <T extends { tick: number }>(a: T[]) => a.sort((x, y) => x.tick - y.tick);
  byTick(info.tempos);
  byTick(info.timeSigs);
  byTick(info.keySigs);
  byTick(info.markers);
  return info;
}

/* ------------------------------ derivados ------------------------------ */

function secondsAt(info: MidiInfo, tick: number): number {
  const tempos = info.tempos.length ? info.tempos : [{ tick: 0, bpm: 120 }];
  let s = 0;
  let last = 0;
  let bpm = tempos[0].tick === 0 ? tempos[0].bpm : 120;
  for (const t of tempos) {
    if (t.tick >= tick) break;
    s += ((t.tick - last) / info.ppq) * (60 / bpm);
    last = t.tick;
    bpm = t.bpm;
  }
  return s + ((tick - last) / info.ppq) * (60 / bpm);
}

/** Compasso (1, 2, 3…) e tempo dentro dele, respeitando mudanças de fórmula. */
function barAt(info: MidiInfo, tick: number): { bar: number; beat: number } {
  const sigs = info.timeSigs.length ? info.timeSigs : [{ tick: 0, num: 4, den: 4 }];
  let bar = 1;
  let from = 0;
  let sig = sigs[0].tick === 0 ? sigs[0] : { tick: 0, num: 4, den: 4 };
  const barLen = (s: { num: number; den: number }) => (info.ppq * 4 * s.num) / s.den;
  for (const s of sigs) {
    if (s.tick > tick) break;
    if (s.tick > from) {
      bar += Math.round((s.tick - from) / barLen(sig));
      from = s.tick;
    }
    sig = s;
  }
  const into = tick - from;
  const len = barLen(sig);
  return { bar: bar + Math.floor(into / len), beat: Math.floor((into % len) / ((info.ppq * 4) / sig.den)) + 1 };
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Krumhansl-Schmuckler sobre a distribuição de alturas: só uma estimativa. */
function estimateKey(pc: number[]): { name: string; score: number } | null {
  const total = pc.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const maj = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const min = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const corr = (prof: number[], r: number) => {
    const x = pc.map((_, i) => pc[(i + r) % 12]);
    const mx = x.reduce((a, b) => a + b) / 12;
    const my = prof.reduce((a, b) => a + b) / 12;
    let n = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) {
      n += (x[i] - mx) * (prof[i] - my);
      dx += (x[i] - mx) ** 2;
      dy += (prof[i] - my) ** 2;
    }
    return n / Math.sqrt(dx * dy);
  };
  let best = { name: '', score: -2 };
  for (let r = 0; r < 12; r++) {
    const a = corr(maj, r);
    const b = corr(min, r);
    if (a > best.score) best = { name: `${NOTES[r]} maior`, score: a };
    if (b > best.score) best = { name: `${NOTES[r]} menor`, score: b };
  }
  return best;
}

/** Texto em markdown com tudo o que o arquivo traz, separando o que é lido do que é estimado. */
export function midiReport(info: MidiInfo, fileName: string, importedRel: string, date: string): string {
  const pos = (tick: number) => {
    const { bar, beat } = barAt(info, tick);
    return `compasso ${bar}${beat > 1 ? `, tempo ${beat}` : ''} (${fmtTime(secondsAt(info, tick))})`;
  };
  // o note-off final cai no início do compasso seguinte: conta pelo tick anterior
  const lastBar = (tick: number) => barAt(info, Math.max(0, tick - 1)).bar;
  const lines: string[] = [
    '---',
    'tipo: análise',
    `fonte: "[[${importedRel}]]"`,
    `data: ${date}`,
    '---',
    `# Leitura do MIDI: ${fileName}`,
    '',
    `> Gerada automaticamente pelo Sostituto na importação, a partir de \`${importedRel}\`.`,
    '> "Lido do arquivo" é o que o MIDI declara (pode estar errado se o programa que exportou não preencheu);',
    '> "estimado" é cálculo do app e precisa ser confirmado.',
    '',
    '## Dados gerais (lido do arquivo)',
    `- Formato SMF ${info.format}, ${info.tracks.length} trilha(s), resolução ${info.ppq} ticks por semínima.`,
    `- Duração: ${fmtTime(secondsAt(info, info.lastTick))} · ${lastBar(info.lastTick)} compasso(s).`,
  ];

  const tempos = info.tempos.filter((t, i, a) => i === 0 || t.bpm !== a[i - 1].bpm);
  if (!tempos.length) lines.push('- Andamento: não informado no arquivo (o padrão MIDI é 120 BPM).');
  else if (tempos.length === 1) lines.push(`- Andamento: ${tempos[0].bpm} BPM.`);
  else if (tempos.length <= 12) lines.push(`- Andamento: ${tempos.map((t) => `${t.bpm} BPM no ${pos(t.tick)}`).join('; ')}.`);
  else {
    const bpms = tempos.map((t) => t.bpm);
    lines.push(`- Andamento: ${tempos.length} mudanças, de ${Math.min(...bpms)} a ${Math.max(...bpms)} BPM; começa em ${tempos[0].bpm} BPM (provavelmente gravado sem metrônomo ou com rubato).`);
  }

  const sigs = info.timeSigs.filter((s, i, a) => i === 0 || s.num !== a[i - 1].num || s.den !== a[i - 1].den);
  lines.push(
    sigs.length
      ? `- Fórmula de compasso: ${sigs.slice(0, 12).map((s) => `${s.num}/${s.den}${s.tick ? ` no ${pos(s.tick)}` : ''}`).join('; ')}${sigs.length > 12 ? '…' : ''}.`
      : '- Fórmula de compasso: não informada (o padrão MIDI é 4/4).',
  );

  const keys = info.keySigs.filter((k, i, a) => i === 0 || k.name !== a[i - 1].name);
  lines.push(
    keys.length
      ? `- Armadura: ${keys.map((k) => `${k.name}${k.tick ? ` no ${pos(k.tick)}` : ''}`).join('; ')} (muitos programas gravam Dó maior por padrão).`
      : '- Armadura: não informada.',
  );
  if (info.copyright.length) lines.push(`- Copyright: ${info.copyright.join(' / ')}`);

  const est = estimateKey(info.pitchClasses);
  const total = info.pitchClasses.reduce((a, b) => a + b, 0);
  if (est && total) {
    const ranked = info.pitchClasses
      .map((v, i) => ({ n: NOTES[i], pct: Math.round((v / total) * 100) }))
      .filter((x) => x.pct > 0)
      .sort((a, b) => b.pct - a.pct);
    lines.push(
      '',
      '## Tonalidade (estimado)',
      `- Mais provável pela distribuição das notas: **${est.name}** (correlação ${est.score.toFixed(2).replace('.', ',')}; abaixo de ~0,6 é pouco confiável, e tons relativos se confundem).`,
      `- Notas mais usadas (por duração): ${ranked.map((x) => `${x.n} ${x.pct}%`).join(', ')}.`,
    );
  }

  lines.push('', '## Trilhas (lido do arquivo)', '', '| # | Nome | Instrumento (programa GM) | Canal | Notas | Extensão | Entra / sai |', '|---|---|---|---|---|---|---|');
  for (const t of info.tracks) {
    if (!t.notes && !t.name && !t.programs.length) continue;
    const inst = [...t.instruments, ...t.programs].filter((x, i, a) => a.indexOf(x) === i).join(', ') || '—';
    const range = t.low !== null && t.high !== null ? `${noteName(t.low)}–${noteName(t.high)}` : t.notes ? 'percussão' : '—';
    const span = t.firstTick !== null && t.lastTick !== null ? `c. ${barAt(info, t.firstTick).bar} → c. ${lastBar(Math.max(t.firstTick + 1, t.lastTick))}` : '—';
    const name = (t.name || '(sem nome)').replace(/\|/g, '/');
    lines.push(`| ${t.index} | ${name} | ${inst.replace(/\|/g, '/')} | ${t.channels.join(', ') || '—'} | ${t.notes} | ${range} | ${span} |`);
  }

  if (info.markers.length) {
    lines.push('', '## Marcadores e textos (lido do arquivo)', '');
    for (const m of info.markers.slice(0, 60)) lines.push(`- ${pos(m.tick)} · ${m.kind}: ${m.text}`);
    if (info.markers.length > 60) lines.push(`- … mais ${info.markers.length - 60}`);
  }
  if (info.lyrics.length) {
    const text = info.lyrics.join('').replace(/[\r\n/\\]+/g, ' / ').replace(/\s+/g, ' ').trim();
    lines.push('', '## Letra embutida (lido do arquivo)', '', text.length > 1500 ? `${text.slice(0, 1500)}…` : text);
  }

  lines.push('', '## O que não dá para saber pelo MIDI', '- Gênero, estilo, referências, intenção, nomes das partes (se não houver marcadores) e se a música está finalizada.');
  return lines.join('\n') + '\n';
}

/** Duração total em segundos, pelo mapa de andamentos. */
export const midiDuration = (info: MidiInfo) => secondsAt(info, info.lastTick);
