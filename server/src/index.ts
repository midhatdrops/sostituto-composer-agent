import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { closeAllLiveSessions, invalidateLiveSessions, runChat, resolveSettings, type ChatEvent } from './claude.js';
import { EFFORTS, MODELS, ensureVault, loadConfig, setAssistant, setVault, type AssistantConfig } from './config.js';
import { MIME, listTree, resolveSongFile } from './files.js';
import { fsList, fsRoots, planImport, planMidiImport, runImport, runMidiImport } from './importer.js';
import { registerMcpRoutes } from './mcpHttp.js';
import { GENERAL_SETTINGS, PROMPT_ASSISTENTE, PROMPT_PADRAO, WEB_DIST, ensureUserFiles, today } from './paths.js';
import { createLocal, disableLocal, localSettingsPath, readSettings, writeSettings } from './settingsFiles.js';
import { getSession, listSessions, openToday, readMessages } from './sessions.js';
import { createSong, listSongs, songDir } from './vault.js';
import { DEFAULT_PROVIDER, isProvider, providerStatus } from './providers.js';

const HOST = '127.0.0.1';
ensureUserFiles(); // prompt e settings geral a partir dos modelos, numa instalação nova
const cfg = ensureVault();
const app = Fastify({ logger: { level: 'warn' } });
// ferramentas do app para Codex/Kimi (MCP por HTTP; mesma checagem de host abaixo)
registerMcpRoutes(app, cfg.port);

// Só aceita requisições endereçadas ao próprio localhost (protege contra DNS rebinding).
const allowedHosts = new Set([`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`]);
const allowedOrigins = new Set([...allowedHosts, 'localhost:5173', '127.0.0.1:5173']); // 5173 = vite em modo dev
app.addHook('onRequest', async (req, reply) => {
  if (!allowedHosts.has(req.headers.host ?? '')) return reply.code(403).send({ error: 'Host não permitido' });
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && !allowedOrigins.has(origin.replace(/^https?:\/\//, ''))) {
    return reply.code(403).send({ error: 'Origem não permitida' });
  }
});

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  reply.code(err.statusCode ?? 500).send({ error: err.message });
});

const vaultOk = (v: string | null) => !!v && fs.existsSync(v);
const needVault = () => {
  const v = loadConfig().vaultPath;
  if (!vaultOk(v)) throw Object.assign(new Error(`A pasta das músicas não está acessível: ${v}`), { statusCode: 412 });
};

/* ------------------------------ configuração ------------------------------ */

app.get('/api/config', async () => {
  const c = loadConfig();
  return { vaultPath: c.vaultPath, vaultOk: vaultOk(c.vaultPath), today: today(), platform: process.platform };
});

app.post<{ Body: { vaultPath: string } }>('/api/config', async (req) => {
  const c = setVault(req.body?.vaultPath ?? '');
  invalidateLiveSessions();
  return { vaultPath: c.vaultPath };
});

/* -------------------------- prompt do assistente --------------------------- */

const readText = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');

app.get('/api/prompt', async () => ({ prompt: readText(PROMPT_ASSISTENTE), padrao: readText(PROMPT_PADRAO) }));

/** Grava o prompt (vale a partir da próxima mensagem; a conversa atual continua). */
app.put<{ Body: { prompt: string } }>('/api/prompt', async (req) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== 'string') throw Object.assign(new Error('Prompt inválido'), { statusCode: 400 });
  const tmp = PROMPT_ASSISTENTE + '.tmp';
  fs.writeFileSync(tmp, prompt.replace(/\r\n/g, '\n'), 'utf8');
  fs.renameSync(tmp, PROMPT_ASSISTENTE);
  invalidateLiveSessions();
  return { ok: true };
});

/* --------------------------- modelo e esforço ----------------------------- */

app.get('/api/assistant', async () => ({ ...loadConfig().assistant, models: MODELS, efforts: EFFORTS }));

/** Vale a partir da próxima mensagem (a sessão viva troca de modelo/esforço sem reiniciar). */
app.put<{ Body: Partial<AssistantConfig> }>('/api/assistant', async (req) => setAssistant(req.body ?? {}));

/* ------------------------------ settings.json ------------------------------ */

type SettingsBody = { Body: { content: string } };
const contentOf = (b?: { content?: unknown }) => {
  if (typeof b?.content !== 'string') throw Object.assign(new Error('Conteúdo inválido'), { statusCode: 400 });
  return b.content;
};

app.get('/api/settings', async () => ({ content: readSettings(GENERAL_SETTINGS) ?? '{}' }));
app.put<SettingsBody>('/api/settings', async (req) => {
  writeSettings(GENERAL_SETTINGS, contentOf(req.body));
  invalidateLiveSessions();
  return { ok: true };
});

/** Settings local da música: content é null quando ela usa o geral. */
app.get<{ Params: { song: string } }>('/api/songs/:song/settings', async (req) => {
  needVault();
  return { content: readSettings(localSettingsPath(songDir(req.params.song))) };
});
app.put<{ Params: { song: string } } & SettingsBody>('/api/songs/:song/settings', async (req) => {
  needVault();
  const file = localSettingsPath(songDir(req.params.song));
  if (!fs.existsSync(file)) throw Object.assign(new Error('Crie o settings local primeiro'), { statusCode: 404 });
  writeSettings(file, contentOf(req.body));
  invalidateLiveSessions();
  return { ok: true };
});
app.post<{ Params: { song: string } }>('/api/songs/:song/settings', async (req) => {
  needVault();
  createLocal(songDir(req.params.song));
  invalidateLiveSessions();
  return { content: readSettings(localSettingsPath(songDir(req.params.song))) };
});
app.post<{ Params: { song: string } }>('/api/songs/:song/settings/disable', async (req) => {
  needVault();
  const renamedTo = path.basename(disableLocal(songDir(req.params.song)));
  invalidateLiveSessions();
  return { renamedTo };
});

/* -------------------------------- músicas --------------------------------- */

app.get('/api/songs', async () => {
  needVault();
  return listSongs();
});

app.post<{ Body: { name: string } }>('/api/songs', async (req) => {
  needVault();
  return createSong(req.body?.name ?? '');
});

app.get<{ Params: { song: string } }>('/api/songs/:song', async (req) => {
  needVault();
  const dir = songDir(req.params.song);
  return { name: req.params.song.normalize('NFC'), settings: resolveSettings(dir).scope, sessions: listSessions(req.params.song) };
});

/* ------------------------------- importação -------------------------------- */

app.get('/api/fs/roots', async () => fsRoots(loadConfig().vaultPath));

/* -------------------------------- providers -------------------------------- */

/** Claude, Codex e Kimi: instalados? com login? (o login de cada um é feito uma vez no terminal) */
app.get('/api/providers', async () => providerStatus());

app.get<{ Querystring: { path?: string } }>('/api/fs/list', async (req) => fsList(req.query.path || os.homedir()));

app.get<{ Querystring: { summary: string } }>('/api/import/plan', async (req) => {
  needVault();
  return planImport(req.query.summary ?? '');
});

/** Copia a música para o vault, abre a sessão de hoje e devolve a 1ª mensagem para o assistente. */
app.post<{ Body: { summary: string; name?: string } }>('/api/import', async (req) => {
  needVault();
  const r = runImport(req.body?.summary ?? '', req.body?.name ?? '');
  openToday(r.song);
  const message = r.inPlace
    ? `Quero readequar esta música para a estrutura do Sostituto. Fiz um backup dos arquivos originais em \`${r.importedDir}/\`. O resumo da música é \`${r.summaryRel}\`.`
    : `Importei esta música de "${r.sourceFolder}". Os arquivos originais estão em \`${r.importedDir}/\` e o resumo da música é \`${r.summaryRel}\`. Readeque tudo para a estrutura do Sostituto.`;
  return { ...r, message, instrucao: 'importar-resumo' };
});

app.get<{ Querystring: { file: string } }>('/api/import/midi/plan', async (req) => {
  needVault();
  return planMidiImport(req.query.file ?? '');
});

/** Cria a música a partir de um MIDI; o assistente começa perguntando sobre ela. */
app.post<{ Body: { file: string; name?: string } }>('/api/import/midi', async (req) => {
  needVault();
  const r = runMidiImport(req.body?.file ?? '', req.body?.name ?? '');
  openToday(r.song);
  const message =
    `Importei esta música a partir de um MIDI ("${r.sourceFile}"). O original está em \`${r.midiRel}\` ` +
    `e o app gravou a leitura do arquivo em \`${r.reportRel}\`. Me faça as perguntas para montarmos a música no Sostituto.`;
  return { ...r, message, instrucao: 'importar-midi' };
});

/* -------------------------------- arquivos -------------------------------- */

app.get<{ Params: { song: string } }>('/api/songs/:song/tree', async (req) => {
  needVault();
  return listTree(songDir(req.params.song));
});

/** Lê um arquivo da música (somente leitura). ?download=1 força o download. */
app.get<{ Params: { song: string }; Querystring: { path?: string; download?: string } }>(
  '/api/songs/:song/file',
  async (req, reply) => {
    needVault();
    const file = resolveSongFile(songDir(req.params.song), req.query.path ?? '');
    const name = path.basename(file).normalize('NFC');
    const ext = name.split('.').pop()!.toLowerCase();
    reply.header('Content-Type', MIME[ext] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'no-store');
    if (req.query.download) {
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    return reply.send(fs.createReadStream(file));
  },
);

/* -------------------------------- sessões --------------------------------- */

app.post<{ Params: { song: string } }>('/api/songs/:song/sessions/today', async (req) => {
  needVault();
  songDir(req.params.song); // valida que existe
  return openToday(req.params.song);
});

app.get<{ Params: { song: string; date: string } }>('/api/songs/:song/sessions/:date/messages', async (req) => {
  return readMessages(req.params.song, req.params.date);
});

/**
 * Envia uma mensagem e devolve a resposta em streaming (Server-Sent Events).
 * `close` = botão "Fechar o dia": o app manda o pedido de fechamento no lugar da mensagem.
 */
app.post<{ Params: { song: string; date: string }; Body: { message: string; deep?: boolean; close?: boolean; instrucao?: string; provider?: string } }>(
  '/api/songs/:song/sessions/:date/chat',
  async (req, reply) => {
    needVault();
    const { song, date } = req.params;
    const close = !!req.body?.close;
    const message = (req.body?.message ?? '').trim();
    if (!message && !close) return reply.code(400).send({ error: 'Mensagem vazia' });
    if (!getSession(song, date)) return reply.code(404).send({ error: `Sessão ${date} não existe` });

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const abort = new AbortController();
    reply.raw.on('close', () => abort.abort());
    const emit = (e: ChatEvent) => {
      if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    try {
      await runChat(song, date, message, emit, abort, {
        deep: !!req.body?.deep,
        close,
        instrucao: req.body?.instrucao,
        provider: isProvider(req.body?.provider) ? req.body.provider : DEFAULT_PROVIDER,
      });
    } catch (err) {
      emit({ type: 'error', message: (err as Error).message });
    }
    reply.raw.end();
  },
);

/* ------------------------------ front-end ---------------------------------- */

if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Não encontrado' });
    return reply.sendFile('index.html');
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    closeAllLiveSessions();
    process.exit(0);
  });
}

await app.listen({ host: HOST, port: cfg.port });
console.log(`\n  🎼 Sostituto rodando em http://localhost:${cfg.port}\n`);
