// Login por assinatura nos providers externos, num HOME só do Sostituto (data/…-home):
//   npm run login:codex  → abre o navegador para entrar com a conta do ChatGPT
//   npm run login:kimi   → abre o Kimi Code; digite /login, escolha "Kimi Code OAuth" e depois /exit
// Rode num terminal comum (o Kimi precisa de um terminal interativo).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SOSTITUTO_DATA ? path.resolve(process.env.SOSTITUTO_DATA) : path.join(ROOT, 'data');
const provider = process.argv[2];

const targets = {
  codex: {
    home: path.join(DATA, 'codex-home'),
    envVar: 'CODEX_HOME',
    args: [path.join(ROOT, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), 'login'],
    hint: 'Vai abrir o navegador: entre com a sua conta do ChatGPT (assinatura).',
  },
  kimi: {
    home: path.join(DATA, 'kimi-home'),
    envVar: 'KIMI_CODE_HOME',
    args: [path.join(ROOT, 'node_modules', '@moonshot-ai', 'kimi-code', 'dist', 'main.mjs')],
    hint: 'No Kimi Code, digite /login, escolha "Kimi Code OAuth" (assinatura), conclua no navegador e depois digite /exit.',
  },
};

const t = targets[provider];
if (!t) {
  console.error('Uso: npm run login:codex  ou  npm run login:kimi');
  process.exit(1);
}
if (!fs.existsSync(t.args[0])) {
  console.error(`O CLI do ${provider} não está instalado. Rode "npm install" na pasta do Sostituto.`);
  process.exit(1);
}
fs.mkdirSync(t.home, { recursive: true });
console.log(`\n${t.hint}\n(credenciais em ${t.home})\n`);

const env = { ...process.env, [t.envVar]: t.home };
delete env.OPENAI_API_KEY;
delete env.CODEX_API_KEY;
delete env.KIMI_API_KEY;
const child = spawn(process.execPath, t.args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
