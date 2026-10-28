import fs from 'node:fs';
import path from 'node:path';
import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { resolveSongFile } from './files.js';
import { checkWritePath, type GuardContext } from './guard.js';
import { listInstructions, readInstruction } from './instructions.js';
import { buildMidi, nextMidiName } from './midiWrite.js';
import { IDEA_STATUS, REPLACEABLE, SESSION_SECTIONS, writeNotes } from './notes.js';
import { INDEX_FILE, findEntry, isInside, nfc, safeName } from './paths.js';

/** Nome do servidor MCP do app; as ferramentas aparecem como mcp__sostituto__<nome>. */
export const APP_SERVER = 'sostituto';
export const APP_TOOLS = ['copiar_arquivo', 'anotar', 'ler_instrucao', 'gerar_midi'].map((t) => `mcp__${APP_SERVER}__${t}`);

/** Mensagens recentes do usuário nesta sessão (atualizadas a cada turno pelo claude.ts). */
export interface UserSaid {
  recent: string[];
}

/**
 * O modelo às vezes inventa um nome descritivo quando o usuário não pediu nenhum. Só vale
 * o nome que aparece no que o usuário escreveu (sem acento e sem maiúsculas); senão, padrão.
 */
function nameWasAsked(nome: string, said: UserSaid): boolean {
  const key = plain(nome);
  return !!key && said.recent.some((m) => ` ${plain(m)} `.includes(` ${key} `));
}

/** Compara só letras e números, sem acento: aspas, hífens, espaços e maiúsculas não contam. */
const plain = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/\.midi?$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Pasta da parte da música em Ideias/ (ex.: Ideias/Refrão/). A parte precisa ser conhecida:
 * dita pelo usuário, escrita no _índice.md (estrutura) ou já ter pasta em Ideias/. Uma parte
 * que não está em lugar nenhum foi suposta pelo modelo: aí ele tem de perguntar.
 */
function partFolder(ctx: GuardContext, parte: string, said: UserSaid): { dir: string } | { error: string } {
  const key = plain(parte);
  const name = safeName(parte);
  if (!key || !name) return { error: 'informe a parte da música (ex.: Verso, Refrão). Se não souber, pergunte ao usuário.' };
  const ideas = path.join(ctx.cwd, findEntry(ctx.cwd, 'Ideias') ?? 'Ideias');
  const existing = fs.existsSync(ideas)
    ? fs.readdirSync(ideas, { withFileTypes: true }).find((e) => e.isDirectory() && plain(e.name) === key)?.name
    : undefined;
  if (existing) return { dir: path.join(ideas, existing) };
  const index = (() => {
    try {
      return fs.readFileSync(path.join(ctx.cwd, findEntry(ctx.cwd, INDEX_FILE) ?? INDEX_FILE), 'utf8');
    } catch {
      return '';
    }
  })();
  const known = [index, ...said.recent].some((t) => ` ${plain(t)} `.includes(` ${key} `));
  if (!known) {
    return {
      error:
        `a parte "${parte}" não foi dita pelo usuário nem está na estrutura do _índice.md. ` +
        'Pergunte ao usuário em que parte da música vocês estão (ex.: verso, refrão, ponte) antes de gerar.',
    };
  }
  return { dir: path.join(ideas, name) };
}

const noteSchema = z.object({
  nota: z
    .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
    .describe('"C4" (dó central = C4 = 60), "Eb3", "F#2", número MIDI (bateria: 36 bumbo, 38 caixa, 42 chimbal…) ou lista para acorde'),
  compasso: z.number().int().describe('Compasso, começando em 1'),
  tempo: z.number().optional().describe('Tempo dentro do compasso, começando em 1; aceita fração (2.5 = contratempo do 2). Padrão 1'),
  duracao: z.number().describe('Duração em semínimas: 1 semínima, 0.5 colcheia, 2 mínima, 4 semibreve'),
  vel: z.number().optional().describe('Intensidade 1–127 (padrão 90; bateria 100)'),
});

const result = (text: string, isError = false) => ({ content: [{ type: 'text' as const, text }], isError });

/** Servidor MCP do app dentro do processo do Claude (Agent SDK). */
export function appToolsServer(ctx: GuardContext, date: string, said: UserSaid = { recent: [] }) {
  return createSdkMcpServer({ name: APP_SERVER, version: '1.0.0', tools: appToolDefs(ctx, date, said) });
}

/**
 * Ferramentas próprias do Sostituto, criadas por conversa (conhecem a pasta da música).
 * As mesmas definições servem ao Claude (no processo) e ao Codex/Kimi (pelo MCP HTTP, mcpHttp.ts).
 * copiar_arquivo existe porque o assistente não tem terminal e só grava texto: é o único
 * jeito de levar .mid, .musicxml, .mscz e áudio para a estrutura certa. Nunca sobrescreve.
 * anotar grava a sessão do dia e as ideias numa chamada só (ver notes.ts).
 * `fileTools`: escrever_arquivo/editar_arquivo, para providers cujas ferramentas nativas de
 * gravação ficam desligadas (Codex, Kimi): toda gravação deles passa pela trava do app.
 */
export function appToolDefs(ctx: GuardContext, date: string, said: UserSaid, opts: { fileTools?: boolean } = {}) {
  const copiar = tool(
    'copiar_arquivo',
    'Copia um arquivo dentro da pasta da música (ex.: de Importado/ para Ideias/ ou Análises/). ' +
      'Use para .mid, .musicxml, .mscz, áudio e qualquer arquivo binário. Caminhos relativos à pasta da música. ' +
      'Nunca sobrescreve: se o destino já existir, escolha outro nome. Não grava em Export/, Importado/ nem .claude/.',
    {
      origem: z.string().describe('Arquivo de origem, relativo à pasta da música'),
      destino: z.string().describe('Caminho do novo arquivo, relativo à pasta da música'),
    },
    async ({ origem, destino }) => {
      let from: string;
      try {
        from = resolveSongFile(ctx.cwd, path.isAbsolute(origem) ? path.relative(ctx.cwd, origem) : origem);
      } catch (e) {
        return result(`Origem inválida: ${(e as Error).message}`, true);
      }
      const to = path.resolve(ctx.cwd, nfc(destino));
      const verdict = checkWritePath(to, ctx, { newCopy: true });
      if (!verdict.allow) return result(verdict.reason, true);
      if (!isInside(ctx.cwd, to)) return result('O destino precisa ficar dentro da pasta desta música.', true);
      if (fs.existsSync(to)) return result(`Já existe um arquivo em "${destino}". Use outro nome (ex.: com -2, -3).`, true);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      return result(`Copiado: ${origem} → ${destino}`);
    },
  );

  const section = (h: string) => z.string().optional().describe(`Texto em markdown acrescentado à seção "${h}" da sessão do dia`);
  const anotar = tool(
    'anotar',
    `Registra a conversa numa chamada só, sem precisar ler os arquivos antes: acrescenta texto às seções da nota de sessão do dia (Sessões/${date}.md, criada se faltar) e cria ou atualiza notas de ideia. ` +
      'Use uma vez por turno, depois de responder, com tudo o que houver para anotar. Acrescenta ao fim de cada seção; ' +
      'só as seções listadas em "substituir" (onde estávamos, sugestões, dúvidas, próximos passos) são reescritas. Nunca sobrescreve notas de ideia. ' +
      'Decisões do usuário vão em "decisoes"; o que você propôs e ele não aprovou vai em "sugestoes". Não atualiza o _índice.md (isso é feito ao fechar o dia).',
    {
      ...(Object.fromEntries(Object.entries(SESSION_SECTIONS).map(([k, h]) => [k, section(h)])) as Record<keyof typeof SESSION_SECTIONS, z.ZodOptional<z.ZodString>>),
      ideias: z
        .array(
          z.object({
            arquivo: z.string().describe('Nota de ideia, ex.: "Ideias/refrão-v2.md" (sem pasta vai para Ideias/)'),
            criar: z.string().optional().describe('Conteúdo completo de uma nota NOVA, no formato de ideia (falha se já existir)'),
            secao: z.string().optional().describe('Seção onde acrescentar, ex.: "Observações" (padrão)'),
            acrescentar: z.string().optional().describe('Texto acrescentado ao fim da seção, numa nota existente'),
            status: z.enum(IDEA_STATUS).optional().describe('Novo status da ideia (troca a tag no frontmatter). #aprovada só se o usuário aprovou'),
          }),
        )
        .optional(),
      substituir: z
        .array(z.enum(REPLACEABLE))
        .optional()
        .describe('Seções que devem ser REESCRITAS com o texto enviado, em vez de receber acréscimo (ex.: tirar de "sugestoes" o que foi aprovado; atualizar "proximos_passos")'),
      data: z.string().optional().describe('Só ao fechar um dia anterior: AAAA-MM-DD da nota de sessão daquele dia'),
    },
    async (input) => {
      const { done, errors } = writeNotes(ctx, date, input);
      if (!done.length && !errors.length) return result('Nada para anotar.', true);
      const list = (title: string, items: string[]) => (items.length ? `${title}:\n- ${items.join('\n- ')}` : '');
      const text = [list('Gravado', done), list('Não gravado', errors)].filter(Boolean).join('\n');
      return result(text, !done.length);
    },
  );

  // o índice das instruções vai na própria descrição: o assistente sempre sabe o que existe
  const temas = listInstructions();
  const lerInstrucao = tool(
    'ler_instrucao',
    'Lê as instruções do app para uma tarefa específica. Leia ANTES de começar a tarefa, quando ela aparecer na conversa ' +
      '(se o app já anexou a instrução no pedido, em <instrucao>, não precisa ler de novo). Temas:\n' +
      (temas.map((t) => `- ${t.tema}: ${t.quando || t.titulo}`).join('\n') || '(nenhum)'),
    { tema: z.string().describe('Nome do tema, exatamente como na lista') },
    async ({ tema }) => {
      const text = readInstruction(tema);
      return text ? result(text) : result(`Tema "${tema}" não existe. Temas: ${temas.map((t) => t.tema).join(', ')}`, true);
    },
  );

  const song = nfc(path.basename(ctx.cwd));
  const gerarMidi = tool(
    'gerar_midi',
    'Gera um arquivo .mid quando o usuário pedir um MIDI (progressão, linha de baixo, melodia, bateria…). ' +
      'Grava em Ideias/<parte>/, onde <parte> é a parte da música em que vocês estão trabalhando (Verso, Refrão, Ponte…, como na estrutura do _índice.md); nunca sobrescreve. ' +
      'Se não estiver claro qual é a parte, NÃO chame: pergunte ao usuário antes. ' +
      'Nome: o que o usuário pedir em "nome"; sem nome, o app usa "<música> <data>-midi-vN" com a próxima versão livre na pasta. ' +
      'O app tira os acentos do nome. Use o BPM, o compasso e o tom decididos na música. ' +
      'Posições em compasso/tempo (1-based) e durações em semínimas. Uma trilha por instrumento; bateria com "bateria": true (canal 10, mapa GM).',
    {
      parte: z.string().describe('Parte da música deste MIDI, com o nome usado na estrutura (ex.: "Verso", "Refrão", "Ponte"). Vira a pasta Ideias/<parte>/'),
      nome: z
        .string()
        .optional()
        .describe('Só o nome que o usuário pediu, como ele escreveu (sem extensão). Se ele não pediu nome, NÃO preencha: o app usa o padrão'),
      bpm: z.number().describe('Andamento em BPM'),
      compasso: z.string().optional().describe('Fórmula de compasso, ex.: "4/4" (padrão), "3/4", "6/8"'),
      tom: z.string().optional().describe('Armadura, ex.: "Am", "F#m", "Bb", "Lá menor"'),
      trilhas: z
        .array(
          z.object({
            nome: z.string().describe('Nome da trilha, ex.: "Piano – acordes", "Baixo"'),
            instrumento: z.number().int().optional().describe('Programa General MIDI 0–127 (0 piano, 24 violão nylon, 25 violão aço, 32 baixo acústico, 33 baixo elétrico, 48 cordas, 73 flauta); ignorado na bateria'),
            canal: z.number().int().optional().describe('Canal 1–16 (opcional; o app escolhe)'),
            bateria: z.boolean().optional().describe('true para bateria (canal 10, mapa GM)'),
            notas: z.array(noteSchema),
          }),
        )
        .describe('Trilhas do arquivo'),
      marcadores: z
        .array(z.object({ compasso: z.number().int(), tempo: z.number().optional(), texto: z.string() }))
        .optional()
        .describe('Marcadores de texto (ex.: nomes das partes ou cifras); o Ableton os ignora'),
    },
    async (input) => {
      let built;
      try {
        built = buildMidi({ ...input, titulo: song });
      } catch (e) {
        return result(`MIDI não gerado: ${(e as Error).message}`, true);
      }
      const part = partFolder(ctx, input.parte, said);
      if ('error' in part) return result(`MIDI não gerado: ${part.error}`, true);
      const dir = part.dir;
      const ignored = input.nome?.trim() && !nameWasAsked(input.nome, said) ? input.nome.trim() : '';
      const name = nextMidiName(fs.existsSync(dir) ? fs.readdirSync(dir) : [], song, date, ignored ? undefined : input.nome);
      const file = path.join(dir, name);
      // mesmas regras de escrita do resto do app (Ideias/ é permitido; nada fora da música)
      const verdict = checkWritePath(file, ctx);
      if (!verdict.allow) return result(verdict.reason, true);
      if (!isInside(ctx.cwd, file) || path.dirname(file) !== dir) return result('Nome de arquivo inválido.', true);
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.writeFileSync(file, built.bytes, { flag: 'wx' });
      } catch (e) {
        return result(`MIDI não gravado: ${(e as Error).message}`, true);
      }
      const rel = path.relative(ctx.cwd, file).split(path.sep).join('/');
      const dur = `${Math.floor(built.seconds / 60)}:${String(Math.round(built.seconds % 60)).padStart(2, '0')}`;
      return result(
        `Gerado: ${rel}\n${built.tracks} trilha(s), ${built.notes} notas, ${built.bars} compasso(s), ${dur} a ${input.bpm} BPM.\n` +
          (ignored ? `O nome "${ignored}" foi ignorado porque o usuário não pediu esse nome; usado o padrão.\n` : '') +
          `Link para as notas: [[${rel}]]`,
      );
    },
  );

  const tools: SdkMcpToolDefinition<any>[] = [copiar, anotar, lerInstrucao, gerarMidi];
  if (opts.fileTools) tools.push(...fileToolDefs(ctx));
  return tools;
}

/** Arquivos de texto que o assistente pode gravar (o resto é binário: use copiar_arquivo ou gerar_midi). */
const TEXT_EXT = /\.(md|txt|musicxml|xml|json|csv)$/i;

function resolveWritable(ctx: GuardContext, rel: string): string {
  const abs = path.resolve(ctx.cwd, nfc(rel.trim()));
  if (!isInside(ctx.cwd, abs) || abs === path.resolve(ctx.cwd)) throw new Error('o arquivo precisa ficar dentro da pasta desta música');
  if (!TEXT_EXT.test(abs)) throw new Error('só arquivos de texto (.md, .txt, .musicxml, .xml, .json, .csv)');
  const verdict = checkWritePath(abs, ctx);
  if (!verdict.allow) throw new Error(verdict.reason);
  return abs;
}

/**
 * Gravação de texto com a mesma trava do hook do Claude (Export/, Importado/, .claude/, .mscz).
 * Sem apagar arquivos: escrever cria ou substitui o conteúdo; editar troca um trecho exato.
 */
function fileToolDefs(ctx: GuardContext) {
  const escrever = tool(
    'escrever_arquivo',
    'Cria um arquivo de texto (markdown, MusicXML…) ou substitui todo o conteúdo de um existente, dentro da pasta da música. ' +
      'Use no lugar das suas ferramentas nativas de gravação, que estão desligadas neste app. ' +
      'Para trocar só um trecho, prefira editar_arquivo. Nunca sobrescreva uma versão do usuário: para versões suas, crie outro nome (-2, -3…).',
    {
      arquivo: z.string().describe('Caminho relativo à pasta da música, ex.: "_índice.md", "Análises/harmonia.md"'),
      conteudo: z.string().describe('Conteúdo completo do arquivo'),
    },
    async ({ arquivo, conteudo }) => {
      try {
        const abs = resolveWritable(ctx, arquivo);
        const existed = fs.existsSync(abs);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, conteudo, 'utf8');
        return result(`${existed ? 'Substituído' : 'Criado'}: ${arquivo}`);
      } catch (e) {
        return result(`Não gravado: ${(e as Error).message}`, true);
      }
    },
  );
  const editar = tool(
    'editar_arquivo',
    'Troca um trecho exato de um arquivo de texto da música por outro (como um "localizar e substituir" de uma ocorrência). ' +
      'O trecho "de" precisa aparecer exatamente uma vez no arquivo (copie incluindo espaços e quebras de linha).',
    {
      arquivo: z.string().describe('Caminho relativo à pasta da música'),
      de: z.string().describe('Trecho atual, exatamente como está no arquivo'),
      para: z.string().describe('Texto novo no lugar do trecho'),
    },
    async ({ arquivo, de, para }) => {
      try {
        const abs = resolveWritable(ctx, arquivo);
        if (!fs.existsSync(abs)) throw new Error('o arquivo não existe (para criar, use escrever_arquivo)');
        const text = fs.readFileSync(abs, 'utf8');
        // aceita o trecho com quebras de linha \n mesmo num arquivo com \r\n
        const needle = text.includes('\r\n') && !de.includes('\r\n') ? de.replace(/\n/g, '\r\n') : de;
        const count = needle ? text.split(needle).length - 1 : 0;
        if (count !== 1) throw new Error(count ? `o trecho aparece ${count} vezes; inclua mais contexto` : 'trecho não encontrado (leia o arquivo de novo)');
        const repl = needle !== de ? para.replace(/\r?\n/g, '\r\n') : para;
        fs.writeFileSync(abs, text.replace(needle, () => repl), 'utf8');
        return result(`Editado: ${arquivo}`);
      } catch (e) {
        return result(`Não editado: ${(e as Error).message}`, true);
      }
    },
  );
  return [escrever, editar];
}
