import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, nfc, safeName, today } from './paths.js';
import type { ProviderId } from './providers.js';

/**
 * Uma sessão por música e por dia (AAAA-MM-DD).
 * sessionId (Claude) fica null até a primeira mensagem do dia criar a sessão no Claude;
 * `threads` guarda a conversa do dia em cada outro provider (Codex, Kimi).
 */
export interface DaySession {
  date: string;
  sessionId: string | null;
  threads?: Partial<Record<Exclude<ProviderId, 'claude'>, string>>;
  createdAt: string;
  updatedAt: string;
  /** quando o dia foi fechado (índice atualizado); uma mensagem nova depois disso reabre */
  closedAt?: string;
  closedBy?: 'botão' | 'automático';
}

type Store = Record<string, Record<string, DaySession>>;

const STORE_FILE = path.join(DATA_DIR, 'sessions.json');
const TRANSCRIPTS = path.join(DATA_DIR, 'transcripts');

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(store: Store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

/** Sessões da música, mais recente primeiro. */
export function listSessions(song: string): DaySession[] {
  return Object.values(load()[nfc(song)] ?? {}).sort((a, b) => b.date.localeCompare(a.date));
}

export function getSession(song: string, date: string): DaySession | undefined {
  return load()[nfc(song)]?.[date];
}

/** Abre (registra) a sessão de hoje; se já existir, devolve a existente. */
export function openToday(song: string): DaySession {
  const store = load();
  const key = nfc(song);
  const date = today();
  store[key] ??= {};
  if (!store[key][date]) {
    const now = new Date().toISOString();
    store[key][date] = { date, sessionId: null, createdAt: now, updatedAt: now };
    save(store);
  }
  return store[key][date];
}

export function setSessionId(song: string, date: string, sessionId: string) {
  const store = load();
  const s = store[nfc(song)]?.[date];
  if (!s) return;
  s.sessionId = sessionId;
  s.updatedAt = new Date().toISOString();
  save(store);
}

export function setThread(song: string, date: string, provider: Exclude<ProviderId, 'claude'>, id: string) {
  const store = load();
  const s = store[nfc(song)]?.[date];
  if (!s) return;
  s.threads = { ...s.threads, [provider]: id };
  s.updatedAt = new Date().toISOString();
  save(store);
}

/** O dia já tem conversa em algum provider (a 1ª mensagem do dia já foi feita). */
export const dayStarted = (s: DaySession) => !!s.sessionId || Object.values(s.threads ?? {}).some(Boolean);

/** Marca o dia como fechado, ou reabre (`by` = null) quando a conversa continua depois do fechamento. */
export function setClosed(song: string, date: string, by: DaySession['closedBy'] | null) {
  const store = load();
  const s = store[nfc(song)]?.[date];
  if (!s) return;
  if (by) {
    s.closedAt = new Date().toISOString();
    s.closedBy = by;
  } else {
    delete s.closedAt;
    delete s.closedBy;
  }
  save(store);
}

/** Sessão anterior mais recente com conversa, se ela não foi fechada (para fechar automaticamente). */
export function unclosedBefore(song: string, date: string): DaySession | null {
  const prev = listSessions(song).find((s) => s.date < date && dayStarted(s));
  return prev && !prev.closedAt ? prev : null;
}

export function touch(song: string, date: string) {
  const store = load();
  const s = store[nfc(song)]?.[date];
  if (!s) return;
  s.updatedAt = new Date().toISOString();
  save(store);
}

/* ---------- histórico do chat (para reabrir a conversa na tela) ---------- */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  at: string;
  /** quem respondeu (só nas falas do assistente; ausente = Claude, nas conversas antigas) */
  provider?: ProviderId;
}

function transcriptFile(song: string, date: string) {
  return path.join(TRANSCRIPTS, safeName(song), `${date}.jsonl`);
}

export function appendMessage(song: string, date: string, msg: Omit<ChatMessage, 'at'>) {
  const file = transcriptFile(song, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ...msg, at: new Date().toISOString() }) + '\n', 'utf8');
}

export function readMessages(song: string, date: string): ChatMessage[] {
  const file = transcriptFile(song, date);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
