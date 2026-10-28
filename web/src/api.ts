export interface Song {
  name: string;
  updatedAt: string;
}
export interface DaySession {
  date: string;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  closedBy?: 'botão' | 'automático';
}
export interface SongDetail {
  name: string;
  settings: 'local' | 'geral';
  sessions: DaySession[];
}
export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  ext?: string;
  size?: number;
  mtime?: string;
  children?: TreeNode[];
}
export interface AppConfig {
  vaultPath: string | null;
  vaultOk: boolean;
  today: string;
  platform: string;
}
export interface FsListing {
  path: string;
  parent: string | null;
  entries: { name: string; type: 'dir' | 'file'; ext: string }[];
}
export interface ImportPlan {
  summary: string;
  folder: string;
  files: number;
  bytes: number;
  types: Record<string, number>;
  inPlace: boolean;
  suggestedName: string;
}
export interface MidiPlan {
  file: string;
  bytes: number;
  suggestedName: string;
  tracks: number;
  bpm: number | null;
  timeSig: string | null;
  durationSec: number;
}
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface AssistantConfig {
  model: string;
  effort: Effort;
  deepModel: string;
  deepEffort: Effort;
}
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  at?: string;
  /** quem respondeu (falas do assistente); ausente = Claude */
  provider?: ProviderId;
}
export type ProviderId = 'claude' | 'codex' | 'kimi';
export const DEFAULT_PROVIDER: ProviderId = 'claude';
export interface ProviderStatus {
  id: ProviderId;
  label: string;
  installed: boolean;
  loggedIn: boolean;
  /** comando para fazer o login (uma vez, no terminal) */
  login: string;
}
export type ChatEvent =
  | { type: 'session'; sessionId: string; resumed: boolean }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; detail: string }
  | { type: 'denied'; name: string; reason: string }
  | { type: 'done'; costUsd?: number; isError: boolean }
  | { type: 'error'; message: string };

const enc = encodeURIComponent;

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const api = {
  config: () => req<AppConfig>('/api/config'),
  setVault: (vaultPath: string) => req('/api/config', { method: 'POST', body: JSON.stringify({ vaultPath }) }),
  songs: () => req<Song[]>('/api/songs'),
  createSong: (name: string) => req<Song>('/api/songs', { method: 'POST', body: JSON.stringify({ name }) }),
  song: (name: string) => req<SongDetail>(`/api/songs/${enc(name)}`),
  openToday: (song: string) => req<DaySession>(`/api/songs/${enc(song)}/sessions/today`, { method: 'POST' }),
  assistant: () =>
    req<AssistantConfig & { models: { id: string; label: string; hint: string }[]; efforts: Effort[] }>('/api/assistant'),
  saveAssistant: (a: Partial<AssistantConfig>) => req<AssistantConfig>('/api/assistant', { method: 'PUT', body: JSON.stringify(a) }),
  prompt: () => req<{ prompt: string; padrao: string }>('/api/prompt'),
  savePrompt: (prompt: string) => req('/api/prompt', { method: 'PUT', body: JSON.stringify({ prompt }) }),
  generalSettings: () => req<{ content: string }>('/api/settings'),
  saveGeneralSettings: (content: string) => req('/api/settings', { method: 'PUT', body: JSON.stringify({ content }) }),
  localSettings: (song: string) => req<{ content: string | null }>(`/api/songs/${enc(song)}/settings`),
  saveLocalSettings: (song: string, content: string) =>
    req(`/api/songs/${enc(song)}/settings`, { method: 'PUT', body: JSON.stringify({ content }) }),
  createLocalSettings: (song: string) => req<{ content: string }>(`/api/songs/${enc(song)}/settings`, { method: 'POST' }),
  disableLocalSettings: (song: string) =>
    req<{ renamedTo: string }>(`/api/songs/${enc(song)}/settings/disable`, { method: 'POST' }),
  fsRoots: () => req<{ label: string; path: string }[]>('/api/fs/roots'),
  fsList: (path?: string) => req<FsListing>(`/api/fs/list${path ? `?path=${enc(path)}` : ''}`),
  importPlan: (summary: string) => req<ImportPlan>(`/api/import/plan?summary=${enc(summary)}`),
  importSong: (summary: string, name: string) =>
    req<{ song: string; message: string; copied: number; exportCopied: number; inPlace: boolean; instrucao: string }>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ summary, name }),
    }),
  midiPlan: (file: string) => req<MidiPlan>(`/api/import/midi/plan?file=${enc(file)}`),
  importMidi: (file: string, name: string) =>
    req<{ song: string; message: string; instrucao: string }>('/api/import/midi', { method: 'POST', body: JSON.stringify({ file, name }) }),
  providers: () => req<ProviderStatus[]>('/api/providers'),
  tree: (song: string) => req<TreeNode[]>(`/api/songs/${enc(song)}/tree`),
  fileText: async (song: string, path: string) => {
    const res = await fetch(fileUrl(song, path));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.text();
  },
  messages: (song: string, date: string) =>
    req<ChatMessage[]>(`/api/songs/${enc(song)}/sessions/${date}/messages`),
};

export const fileUrl = (song: string, path: string, download = false) =>
  `/api/songs/${enc(song)}/file?path=${enc(path)}${download ? '&download=1' : ''}`;

/** Envia mensagem e lê o stream SSE da resposta. */
export async function sendChat(
  song: string,
  date: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
  opts: { deep?: boolean; close?: boolean; instrucao?: string; provider?: ProviderId } = {},
) {
  const res = await fetch(`/api/songs/${enc(song)}/sessions/${date}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ...opts }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? res.statusText);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith('data: ')) onEvent(JSON.parse(chunk.slice(6)));
    }
  }
}

/** Primeira mensagem digitada na tela inicial, enviada assim que a tela da música abre. */
/** `deep` = usar o modo "pensar mais" (ex.: importação). */
export const pendingFirstMessage = new Map<string, { text: string; deep?: boolean; instrucao?: string }>();
