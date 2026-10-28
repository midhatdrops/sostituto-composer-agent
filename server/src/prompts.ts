import fs from 'node:fs';
import path from 'node:path';
import { listTree, type TreeNode } from './files.js';
import { instructionBlock } from './instructions.js';
import { CLAUDE_MD, INDEX_FILE, PROMPT_ASSISTENTE, findEntry } from './paths.js';
import type { ChatMessage } from './sessions.js';

/**
 * Textos que o app entrega ao assistente, iguais para todos os providers: instruções de
 * sistema (prompt do usuário + CLAUDE.md), contexto de abertura do dia, fechamento pendente.
 */

/** Limite de cada arquivo injetado no contexto de abertura. */
const MAX_INJECT_CHARS = 15000;

/** Botão "Fechar o dia": o que aparece na conversa e o pedido que vai para o assistente. */
export const CLOSE_DISPLAY = '🌙 Fechar o dia';
export const CLOSE_PROMPT = 'Fechando por hoje. Faça o fechamento do dia conforme a instrução abaixo.';
export const CLOSE_TOPIC = 'fechar-o-dia';

export const fmtDate = (d: string) => d.split('-').reverse().join('/');

/** Dia anterior que ficou sem fechar: o assistente fecha a partir da nota daquele dia. */
export const pendingCloseNote = (date: string) =>
  [
    '<fechamento_pendente>',
    `A sessão de ${fmtDate(date)} (Sessões/${date}.md) não foi fechada: o usuário não usou "Fechar o dia".`,
    'Depois de responder à mensagem abaixo, faça o fechamento DAQUELE dia a partir da nota dele (instrução a seguir),',
    'sem perguntar, e avise em uma linha que o índice foi atualizado. Os "Próximos passos" vão na nota daquele dia.',
    instructionBlock(CLOSE_TOPIC),
    '</fechamento_pendente>',
  ].join('\n');

export function readIfExists(file: string, max = Infinity): string {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    return t.length > max ? t.slice(0, max) + '\n\n[… arquivo cortado; leia o resto com Read se precisar]' : t;
  } catch {
    return '';
  }
}

/**
 * Para Codex e Kimi: as ferramentas nativas de gravação e o terminal ficam desligados, e as
 * regras do CLAUDE.md falam em Read/Edit/Write. Este aviso traduz isso para as ferramentas do app.
 */
const EXTERNAL_TOOLS_NOTE = `# Ferramentas neste provider
- Você lê arquivos com as suas ferramentas de leitura, mas **não tem terminal e não grava com as ferramentas nativas** (estão desligadas).
- Toda gravação passa pelas ferramentas do app (servidor MCP "sostituto"): \`anotar\`, \`gerar_midi\`, \`copiar_arquivo\`, \`escrever_arquivo\` (criar ou substituir um arquivo de texto) e \`editar_arquivo\` (trocar um trecho exato).
- Onde as regras abaixo disserem Write, use \`escrever_arquivo\`; onde disserem Edit, use \`editar_arquivo\`. Não é preciso ler o arquivo antes de \`escrever_arquivo\`.`;

export function systemAppend(song: string, date: string, dir: string, opts: { external?: boolean } = {}): string {
  // prompt do usuário primeiro; as regras do app (CLAUDE.md) vêm depois e prevalecem onde divergirem
  const parts = [readIfExists(PROMPT_ASSISTENTE), readIfExists(CLAUDE_MD)];
  if (opts.external) parts.push(EXTERNAL_TOOLS_NOTE);
  parts.push(
    [
      '# Contexto desta conversa',
      `- Música: ${song}`,
      `- Vault: ${path.dirname(path.dirname(dir))}`,
      `- Pasta da música (diretório atual): ${dir}`,
      `- Data desta sessão: ${date} (nota da sessão: Sessões/${date}.md)`,
    ].join('\n'),
  );
  return parts.filter(Boolean).join('\n\n---\n\n');
}

function fileList(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) n.type === 'file' ? out.push(n.path) : fileList(n.children ?? [], out);
  return out;
}

/**
 * Contexto de abertura (1ª mensagem da sessão do dia): o app já entrega o _índice.md,
 * a nota de sessão mais recente e a lista de arquivos, poupando várias idas e voltas.
 */
export function openingContext(dir: string): string {
  const parts = ['<contexto_do_app>', 'O app já leu estes arquivos para você; não precisa relê-los agora.'];
  const index = readIfExists(path.join(dir, findEntry(dir, INDEX_FILE) ?? INDEX_FILE), MAX_INJECT_CHARS);
  parts.push(`\n## ${INDEX_FILE}\n${index || '(não existe)'}`);

  const sessDir = findEntry(dir, 'Sessões');
  const notes = sessDir
    ? fs.readdirSync(path.join(dir, sessDir)).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort().reverse()
    : [];
  if (notes[0]) {
    parts.push(`\n## Sessão mais recente: Sessões/${notes[0]}\n${readIfExists(path.join(dir, sessDir!, notes[0]), MAX_INJECT_CHARS)}`);
  } else {
    parts.push('\n## Sessões\n(nenhuma nota de sessão ainda)');
  }

  const files = fileList(listTree(dir));
  const shown = files.slice(0, 300);
  parts.push(`\n## Arquivos da música (${files.length})\n${shown.join('\n')}${files.length > shown.length ? '\n…' : ''}`);
  parts.push('</contexto_do_app>');
  return parts.join('\n');
}

/** Limites do resumo da conversa entregue a um provider que entra no meio do dia. */
const RECAP_MESSAGES = 12;
const RECAP_CHARS = 6000;

/**
 * Ao trocar de provider no meio do dia: as últimas falas de hoje (usuário e assistente),
 * para o novo continuar de onde parou. O registro completo está na nota da sessão.
 */
export function conversationRecap(messages: ChatMessage[]): string {
  const lines: string[] = [];
  let size = 0;
  for (const m of messages.filter((x) => x.role === 'user' || x.role === 'assistant').slice(-RECAP_MESSAGES).reverse()) {
    const who = m.role === 'user' ? 'Usuário' : `Assistente${m.provider ? ` (${m.provider})` : ''}`;
    const text = m.text.length > 1500 ? `${m.text.slice(0, 1500)} […]` : m.text;
    if (size + text.length > RECAP_CHARS) break;
    lines.unshift(`**${who}:** ${text}`);
    size += text.length;
  }
  if (!lines.length) return '';
  return [
    '<conversa_de_hoje>',
    'Você está assumindo uma conversa que já começou hoje com outro assistente. Estas são as últimas falas; o que foi anotado está na nota da sessão de hoje.',
    ...lines,
    '</conversa_de_hoje>',
  ].join('\n\n');
}
