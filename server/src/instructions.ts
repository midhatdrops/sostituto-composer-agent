import fs from 'node:fs';
import path from 'node:path';
import { INSTRUCTIONS_DIR, nfc } from './paths.js';

/**
 * Instruções sob demanda (pasta instruções/ do projeto): regras de tarefas ocasionais que
 * não precisam ir no prompt de todo turno. O app as anexa ao pedido quando ele mesmo dispara
 * a tarefa (importação, Fechar o dia); nos outros casos o assistente lê com `ler_instrucao`.
 * Cada arquivo começa com "# Título" e uma linha "> Quando usar: …", que vira o índice.
 */
export interface Instruction {
  tema: string;
  titulo: string;
  quando: string;
}

const files = (): string[] => {
  try {
    return fs.readdirSync(INSTRUCTIONS_DIR).filter((n) => n.toLowerCase().endsWith('.md')).sort();
  } catch {
    return [];
  }
};

export function listInstructions(): Instruction[] {
  return files().map((name) => {
    const head = fs.readFileSync(path.join(INSTRUCTIONS_DIR, name), 'utf8').slice(0, 2000);
    return {
      tema: nfc(name.replace(/\.md$/i, '')),
      titulo: head.match(/^#\s+(.+)$/m)?.[1].trim() ?? name,
      quando: head.match(/^>\s*Quando usar:\s*(.+)$/im)?.[1].trim() ?? '',
    };
  });
}

/** Conteúdo de um tema (só os que existem na pasta: o nome nunca vira caminho livre). */
export function readInstruction(tema: string): string | null {
  const name = files().find((n) => nfc(n.replace(/\.md$/i, '')).toLowerCase() === nfc(tema.trim()).toLowerCase());
  return name ? fs.readFileSync(path.join(INSTRUCTIONS_DIR, name), 'utf8').trim() : null;
}

/** Bloco para anexar a um pedido do app. */
export function instructionBlock(tema: string): string {
  const text = readInstruction(tema);
  return text ? `<instrucao tema="${tema}">\n${text}\n</instrucao>` : '';
}

/** Nomes e datas dos arquivos: se mudarem, a sessão viva é recriada (o índice vai na descrição da ferramenta). */
export function instructionsSignature(): string {
  return files()
    .map((n) => `${n}:${fs.statSync(path.join(INSTRUCTIONS_DIR, n)).mtimeMs}`)
    .join(',');
}
