import fs from 'node:fs';
import path from 'node:path';
import { checkWritePath, type GuardContext } from './guard.js';
import { findEntry, isInside, nfc } from './paths.js';

/**
 * Gravação das anotações da conversa (ferramenta `anotar`). Existe para que anotar custe
 * uma chamada só: o app acrescenta o texto na seção certa de cada nota, sem o Read + Edit
 * que o assistente teria de fazer arquivo por arquivo. Só acrescenta: nunca apaga texto.
 */

/** Campos da ferramenta → seções da nota de sessão (formato do prompt-assistente.md). */
export const SESSION_SECTIONS = {
  onde_estavamos: 'Onde estávamos',
  decisoes: 'Decisões minhas',
  ideias_novas: 'Ideias novas',
  sugestoes: 'Sugestões do assistente (não aprovadas)',
  descartado: 'Descartado (e por quê)',
  duvidas: 'Dúvidas abertas',
  proximos_passos: 'Próximos passos',
} as const;
export type SessionKey = keyof typeof SESSION_SECTIONS;

export const IDEA_STATUS = ['testar', 'aprovada', 'descartada', 'em-dúvida'] as const;
export type IdeaStatus = (typeof IDEA_STATUS)[number];

export interface IdeaNote {
  arquivo: string;
  criar?: string;
  secao?: string;
  acrescentar?: string;
  status?: IdeaStatus;
}

/**
 * Seções que descrevem um estado (e não um histórico): podem ser reescritas por inteiro, para
 * uma sugestão aprovada sair da lista ou um próximo passo resolvido sumir. Decisões, ideias
 * novas e descartes são histórico: só recebem acréscimos.
 */
export const REPLACEABLE = ['onde_estavamos', 'sugestoes', 'duvidas', 'proximos_passos'] as const;

/** `data`: só no fechamento de um dia anterior (grava na nota daquele dia, se ela já existir). */
export type NotesInput = Partial<Record<SessionKey, string>> & {
  ideias?: IdeaNote[];
  data?: string;
  substituir?: (typeof REPLACEABLE)[number][];
};

const sessionTemplate = (date: string) =>
  ['---', `data: ${date}`, 'música: "[[_índice]]"', '---', ...Object.values(SESSION_SECTIONS).map((h) => `## ${h}\n`)].join('\n');

const ideaFrontmatter = (date: string, status: IdeaStatus) =>
  ['---', `tags: [${status}]`, 'música: "[[_índice]]"', `sessão: "[[${date}]]"`, '---', ''].join('\n');

const headingKey = (line: string) =>
  nfc(line.replace(/^#+\s*/, '').trim().toLowerCase()).split(' (')[0];

/**
 * Acrescenta `add` ao fim da seção `## heading` (criando a seção no fim da nota se faltar);
 * com `replace`, o conteúdo da seção é trocado por `add`.
 */
export function appendToSection(doc: string, heading: string, add: string, replace = false): string {
  const block = add.replace(/\s+$/, '').split(/\r?\n/);
  const lines = doc.replace(/\s+$/, '').split(/\r?\n/);
  const key = headingKey(heading);
  const start = lines.findIndex((l) => /^##\s/.test(l) && headingKey(l) === key);
  if (start < 0) return `${lines.join('\n')}\n\n## ${heading}\n${block.join('\n')}\n`;

  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end < 0) end = lines.length;
  let last = end;
  while (last > start + 1 && !lines[last - 1].trim()) last--;
  if (replace) last = start + 1;
  const after = lines.slice(end);
  return [...lines.slice(0, last), ...block, ...(after.length ? ['', ...after] : [])].join('\n') + '\n';
}

/** Troca a tag de status no frontmatter (`tags: [...]`), mantendo as outras tags. */
export function setStatus(doc: string, status: IdeaStatus, date: string): string {
  const fm = doc.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return ideaFrontmatter(date, status) + doc;
  const body = fm[1];
  const tagLine = body.match(/^tags:\s*\[(.*)\]\s*$/m);
  let newBody: string;
  if (tagLine) {
    const others = tagLine[1]
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter((t) => t && !(IDEA_STATUS as readonly string[]).includes(nfc(t)));
    newBody = body.replace(tagLine[0], `tags: [${[status, ...others].join(', ')}]`);
  } else {
    newBody = `tags: [${status}]\n${body}`;
  }
  const out = doc.replace(fm[0], `---\n${newBody}\n---`);
  // a nota de uma sugestão começa com "ainda não aprovada": deixa de valer quando o usuário aprova
  return status === 'aprovada'
    ? out.replace(/^(>\s*\*\*Sugestão do assistente\*\*),?\s*ainda não aprovada\.?/m, `$1, aprovada pelo usuário em ${date.split('-').reverse().join('/')}.`)
    : out;
}

/** Pasta Ideias/ por padrão e extensão .md; recusa o que as regras do app não permitem. */
function resolveIdea(ctx: GuardContext, arquivo: string): { abs: string; rel: string } {
  let rel = nfc(arquivo.trim()).replace(/\\/g, '/');
  if (path.isAbsolute(rel)) rel = path.relative(ctx.cwd, rel).split(path.sep).join('/');
  if (!rel.includes('/')) rel = `Ideias/${rel}`;
  if (!/\.md$/i.test(rel)) rel += '.md';
  const abs = path.resolve(ctx.cwd, rel);
  if (!isInside(ctx.cwd, abs)) throw new Error('fora da pasta desta música');
  if (/^_índice\.md$/i.test(path.basename(abs))) throw new Error('o _índice.md é atualizado no fechamento do dia, não pelo anotar');
  const verdict = checkWritePath(abs, ctx);
  if (!verdict.allow) throw new Error(verdict.reason);
  return { abs, rel };
}

/** Grava as anotações; devolve o que foi feito e os problemas (sem desfazer o que deu certo). */
export function writeNotes(ctx: GuardContext, date: string, input: NotesInput): { done: string[]; errors: string[] } {
  const done: string[] = [];
  const errors: string[] = [];

  const sections = (Object.keys(SESSION_SECTIONS) as SessionKey[]).filter((k) => input[k]?.trim());
  const sessDir = path.join(ctx.cwd, findEntry(ctx.cwd, 'Sessões') ?? 'Sessões');
  const other = input.data?.trim();
  if (other && other !== date) {
    // outro dia: só uma nota que já exista e seja anterior a esta sessão
    if (!/^\d{4}-\d{2}-\d{2}$/.test(other) || other > date) {
      errors.push(`data "${other}": use AAAA-MM-DD de um dia anterior`);
      sections.length = 0;
    } else if (!findEntry(sessDir, `${other}.md`)) {
      errors.push(`Sessões/${other}.md não existe`);
      sections.length = 0;
    } else date = other;
  }
  if (sections.length) {
    const file = path.join(sessDir, findEntry(sessDir, `${date}.md`) ?? `${date}.md`);
    const created = !fs.existsSync(file);
    let doc = created ? sessionTemplate(date) : fs.readFileSync(file, 'utf8');
    const replace = new Set<string>(input.substituir ?? []);
    for (const k of sections) doc = appendToSection(doc, SESSION_SECTIONS[k], input[k]!, replace.has(k));
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(file, doc, 'utf8');
    const label = (k: SessionKey) => `${SESSION_SECTIONS[k]}${replace.has(k) ? ' (reescrita)' : ''}`;
    done.push(`Sessões/${date}.md${created ? ' (criada)' : ''}: ${sections.map(label).join(', ')}`);
  }

  for (const idea of input.ideias ?? []) {
    try {
      const { abs, rel } = resolveIdea(ctx, idea.arquivo);
      const exists = fs.existsSync(abs);
      const what: string[] = [];
      let doc: string;
      if (!exists) {
        if (!idea.criar?.trim()) throw new Error('a nota não existe; mande o conteúdo em "criar"');
        doc = idea.criar.trim() + '\n';
        if (!doc.startsWith('---')) doc = ideaFrontmatter(date, idea.status ?? 'testar') + doc;
        what.push('criada');
      } else {
        if (idea.criar?.trim()) throw new Error('a nota já existe e não é sobrescrita; use "acrescentar" ou outro nome (-2, -3…)');
        doc = fs.readFileSync(abs, 'utf8');
      }
      if (idea.acrescentar?.trim()) {
        doc = appendToSection(doc, idea.secao?.trim() || 'Observações', idea.acrescentar);
        what.push(`+ ${idea.secao?.trim() || 'Observações'}`);
      }
      if (idea.status) {
        doc = setStatus(doc, idea.status, date);
        what.push(`#${idea.status}`);
      }
      if (!what.length) throw new Error('nada a gravar (use criar, acrescentar ou status)');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, doc, { encoding: 'utf8', flag: exists ? 'w' : 'wx' });
      done.push(`${rel}: ${what.join(', ')}`);
    } catch (e) {
      errors.push(`${idea.arquivo}: ${(e as Error).message}`);
    }
  }
  return { done, errors };
}
