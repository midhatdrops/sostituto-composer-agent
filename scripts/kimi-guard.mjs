// Hook PreToolUse do Kimi Code dentro do Sostituto (configurado no HOME do Kimi só do app).
// É a segunda camada: o agente do app já não oferece Bash/Edit/Write/Agent ao modelo.
// O Kimi libera a ferramenta se o hook falhar ("fail-open"), então aqui qualquer erro BLOQUEIA:
// saída 2 = negar (motivo no stderr e também no JSON de stdout).
import path from 'node:path';

const deny = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.stderr.write(reason);
  process.exit(2);
};
const allow = () => process.exit(0);

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const key = (p) => (CASE_INSENSITIVE ? path.resolve(p).normalize('NFC').toLowerCase() : path.resolve(p).normalize('NFC'));
const inside = (parent, child) => {
  const rel = path.relative(key(parent), key(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const WEB_TOOLS = new Set(['FetchURL', 'WebSearch']);

try {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw || '{}');
  const name = String(input.tool_name ?? '');
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const musicas = process.env.SOSTITUTO_MUSICAS;
  if (!musicas) deny('Sostituto: trava sem configuração (SOSTITUTO_MUSICAS); ferramenta bloqueada.');

  if (name.startsWith('mcp__sostituto__')) allow(); // ferramentas do app: validam as regras por conta própria
  if (WEB_TOOLS.has(name)) allow();
  if (READ_TOOLS.has(name)) {
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    const paths = [ti.file_path, ti.path, ti.directory, ti.dir].filter((p) => typeof p === 'string' && p);
    // Glob/Grep com padrão absoluto também apontam para um lugar no disco
    if (typeof ti.pattern === 'string' && path.isAbsolute(ti.pattern)) paths.push(ti.pattern.replace(/[*?[{].*$/, '') || ti.pattern);
    for (const p of paths.length ? paths : [cwd]) {
      if (!inside(musicas, path.resolve(cwd, p))) deny(`Leitura fora de Músicas/ bloqueada: ${p}`);
    }
    allow();
  }
  deny(
    `${name || 'Ferramenta'} está desligada no Sostituto. Para gravar use as ferramentas do app ` +
      '(escrever_arquivo, editar_arquivo, anotar, gerar_midi, copiar_arquivo); terminal não está disponível.',
  );
} catch (e) {
  deny(`Sostituto: erro na trava (${e?.message ?? e}); ferramenta bloqueada.`);
}
