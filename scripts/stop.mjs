// Para o servidor do Sostituto que estiver rodando (npm stop / npm run restart).
// Encerra o processo que escuta na porta do config.json, mas só se essa porta
// responder como o Sostituto: assim nunca derruba outro programa por engano.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = process.env.SOSTITUTO_CONFIG ? path.resolve(process.env.SOSTITUTO_CONFIG) : path.join(ROOT, 'config.json');
let port = 4517;
try {
  port = JSON.parse(fs.readFileSync(configFile, 'utf8')).port || port;
} catch {}

async function isSostituto() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(2000) });
    return res.ok && 'vaultPath' in (await res.json());
  } catch {
    return false;
  }
}

function listeningPids() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      const pids = out
        .split(/\r?\n/)
        .filter((l) => /LISTENING/i.test(l) && new RegExp(`:${port}\\s`).test(l))
        .map((l) => l.trim().split(/\s+/).pop());
      return [...new Set(pids)].filter((p) => p && p !== '0');
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

if (!(await isSostituto())) {
  console.log(`Nenhum Sostituto rodando na porta ${port}.`);
  process.exit(0);
}

for (const pid of listeningPids()) {
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    else process.kill(Number(pid), 'SIGTERM');
  } catch {}
}

// espera a porta liberar antes de o restart subir o novo servidor
for (let i = 0; i < 20 && listeningPids().length; i++) await new Promise((r) => setTimeout(r, 250));
console.log(listeningPids().length ? `A porta ${port} continua ocupada.` : `Sostituto parado (porta ${port}).`);
