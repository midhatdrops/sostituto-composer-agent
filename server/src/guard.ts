import path from 'node:path';
import { cmpKey, isInside, nfc } from './paths.js';

/**
 * Regras fixas de acesso a arquivos. Valem para TODAS as músicas e não podem
 * ser afrouxadas pelo settings.json (geral ou local): rodam como hook
 * PreToolUse dentro do processo do app, antes de qualquer ferramenta.
 */
export interface GuardContext {
  musicasDir: string; // <vault>/Músicas
  cwd: string; // pasta da música
}

export type Verdict = { allow: true } | { allow: false; reason: string };

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
/** Ferramentas que executam comandos: poderiam apagar/mover arquivos, então ficam bloqueadas. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor']);

const FORBIDDEN_CHARS = /[<>:"|?*\u0000-\u001f]/;

function toolPath(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path ?? input.path;
  return typeof p === 'string' && p ? p : null;
}

function segmentsUnder(base: string, target: string): string[] {
  return path.relative(cmpKey(path.resolve(base)), cmpKey(path.resolve(target))).split(path.sep);
}

export function checkTool(tool: string, input: Record<string, unknown>, ctx: GuardContext): Verdict {
  if (SHELL_TOOLS.has(tool)) {
    return { allow: false, reason: 'Comandos de terminal estão desativados neste app.' };
  }
  const isWrite = WRITE_TOOLS.has(tool);
  if (!isWrite && !READ_TOOLS.has(tool)) return { allow: true };

  const raw = toolPath(input);
  if (!raw) return isWrite ? { allow: false, reason: 'Caminho do arquivo ausente.' } : { allow: true };
  const target = path.resolve(ctx.cwd, nfc(raw));

  if (!isInside(ctx.musicasDir, target)) {
    return { allow: false, reason: `Fora de Músicas/: ${target}` };
  }
  if (!isWrite) return { allow: true };
  return checkWritePath(target, ctx);
}

/**
 * Regras de escrita para um caminho absoluto. `newCopy` = criação de um arquivo novo por
 * cópia (ferramenta copiar_arquivo): aí é permitido criar uma cópia de .mscz.
 */
export function checkWritePath(target: string, ctx: GuardContext, opts: { newCopy?: boolean } = {}): Verdict {
  if (!isInside(ctx.musicasDir, target)) {
    return { allow: false, reason: `Fora de Músicas/: ${target}` };
  }
  // segs[0] = pasta da música, segs[1] = subpasta (Export, Ideias, ...)
  const segs = segmentsUnder(ctx.musicasDir, target);
  if (segs.length < 2) return { allow: false, reason: 'Não é permitido escrever direto em Músicas/.' };
  if (segs.some((s) => s.toLowerCase() === 'export')) {
    return { allow: false, reason: 'A pasta Export/ é somente do usuário: o assistente não cria, altera, move nem apaga nada ali.' };
  }
  if (segs[1]?.toLowerCase() === 'importado') {
    return { allow: false, reason: 'Importado/ guarda os originais da importação e é somente leitura. Crie arquivos novos na estrutura do Sostituto (use copiar_arquivo para .mid, .musicxml, .mscz e áudio).' };
  }
  if (segs.some((s) => s.toLowerCase() === '.claude')) {
    return { allow: false, reason: 'As configurações (.claude/) só podem ser alteradas pelo usuário no app.' };
  }
  if (target.toLowerCase().endsWith('.mscz') && !opts.newCopy) {
    return { allow: false, reason: 'Arquivos .mscz são somente leitura.' };
  }
  const base = path.basename(target);
  if (FORBIDDEN_CHARS.test(base) || /[. ]$/.test(base)) {
    return { allow: false, reason: `Nome de arquivo inválido no Windows: "${base}". Use outro nome (sem < > : " | ? * e sem ponto/espaço no final).` };
  }
  return { allow: true };
}
