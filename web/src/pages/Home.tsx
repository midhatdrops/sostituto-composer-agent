import { useState } from 'react';
import { api, pendingFirstMessage, type ImportPlan, type MidiPlan } from '../api';
import { FilePicker } from '../components/FilePicker';

type Mode = 'nova' | 'importar';

const fmtSize = (n: number) =>
  n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;

const openSong = (name: string) => (location.hash = `#/m/${encodeURIComponent(name)}`);

/** Tela inicial: começar uma música nova ou importar uma existente. As do vault ficam na barra lateral. */
export function Home({ onCreated, vaultPath }: { onCreated: () => void; vaultPath: string | null }) {
  const [mode, setMode] = useState<Mode>('nova');

  return (
    <div className="welcome">
      <div className="welcome-box">
        <img className="welcome-logo" src="/icon-256.png" alt="Sostituto" width={88} height={88} />
        <h2>Vamos trabalhar em uma música nova?</h2>
        <p className="muted">Ou escolha uma música ao lado para continuar de onde parou.</p>
        <div className="segmented mode-pick" role="tablist">
          <button role="tab" aria-selected={mode === 'nova'} className={mode === 'nova' ? 'on' : ''} onClick={() => setMode('nova')}>
            ✨ Nova música
          </button>
          <button role="tab" aria-selected={mode === 'importar'} className={mode === 'importar' ? 'on' : ''} onClick={() => setMode('importar')}>
            📥 Importar
          </button>
        </div>
        {mode === 'nova' ? <NewSong onCreated={onCreated} /> : <ImportSong onCreated={onCreated} vaultPath={vaultPath} />}
      </div>
    </div>
  );
}

function NewSong({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setError('');
    setBusy(true);
    try {
      const s = await api.createSong(name);
      if (idea.trim()) pendingFirstMessage.set(s.name, { text: idea.trim() });
      onCreated();
      openSong(s.name);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="mode-panel" onSubmit={create}>
      <input autoFocus className="welcome-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da música" />
      <div className="composer welcome-composer">
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              create();
            }
          }}
          rows={3}
          placeholder="Conte a ideia: gênero, sensação, referências… (opcional)"
        />
        <button className="primary" disabled={!name.trim() || busy}>
          Começar
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

type Source = 'resumo' | 'midi';

function ImportSong({ onCreated, vaultPath }: { onCreated: () => void; vaultPath: string | null }) {
  const [source, setSource] = useState<Source>('resumo');
  return (
    <div className="mode-panel">
      <div className="segmented source-pick" role="tablist">
        <button role="tab" aria-selected={source === 'resumo'} className={source === 'resumo' ? 'on' : ''} onClick={() => setSource('resumo')}>
          📝 De um resumo
        </button>
        <button role="tab" aria-selected={source === 'midi'} className={source === 'midi' ? 'on' : ''} onClick={() => setSource('midi')}>
          🎹 De um MIDI
        </button>
      </div>
      {source === 'resumo' ? (
        <ImportSummary onCreated={onCreated} vaultPath={vaultPath} />
      ) : (
        <ImportMidi onCreated={onCreated} vaultPath={vaultPath} />
      )}
    </div>
  );
}

function ImportSummary({ onCreated, vaultPath }: { onCreated: () => void; vaultPath: string | null }) {
  const [picking, setPicking] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(path: string) {
    setPicking(false);
    setError('');
    setPlan(null);
    try {
      const p = await api.importPlan(path);
      setPlan(p);
      setName(p.suggestedName);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    if (!plan || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.importSong(plan.summary, name);
      // readequar uma música inteira é trabalho pesado: vai no modo "pensar mais"
      pendingFirstMessage.set(r.song, { text: r.message, deep: true, instrucao: r.instrucao });
      onCreated();
      openSong(r.song);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const topTypes = plan
    ? Object.entries(plan.types)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
    : [];

  return (
    <div className="mode-panel">
      <p className="muted small">
        Selecione o <b>resumo da música</b> (a nota principal dela). O Sostituto copia a pasta onde ele está, sem
        alterar os originais, e o assistente reorganiza tudo na estrutura do Sostituto.
      </p>
      <button onClick={() => setPicking(true)}>{plan ? 'Escolher outro resumo…' : '📂 Selecionar o resumo da música…'}</button>

      {plan && (
        <div className="card import-plan">
          <div className="small muted">Resumo</div>
          <div className="path">{plan.summary}</div>
          <div className="small muted">
            Pasta da música: {plan.files} arquivos · {fmtSize(plan.bytes)}
          </div>
          <div className="type-chips">
            {topTypes.map(([ext, n]) => (
              <span key={ext} className="chip">.{ext} <span className="count">{n}</span></span>
            ))}
          </div>
          {plan.inPlace ? (
            <p className="small">
              Esta música já está no vault (<b>{plan.suggestedName}</b>). Os originais ganham um backup em{' '}
              <code>Importado/</code> e ela é readequada no mesmo lugar.
            </p>
          ) : (
            <label className="small">
              Nome no Sostituto
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {plan.bytes > 1073741824 && (
            <p className="small error">A pasta tem mais de 1 GB. Confira se o resumo está na pasta certa da música.</p>
          )}
          <button className="primary" onClick={run} disabled={busy || (!plan.inPlace && !name.trim())}>
            {busy ? 'Copiando…' : plan.inPlace ? 'Readequar' : 'Importar e readequar'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {picking && (
        <FilePicker
          title="Selecione o resumo da música"
          accept={['md', 'txt']}
          start={vaultPath ?? undefined}
          onPick={pick}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Importa a partir de um .mid: o app lê o arquivo e o assistente pergunta o resto (gênero, estrutura, estado). */
function ImportMidi({ onCreated, vaultPath }: { onCreated: () => void; vaultPath: string | null }) {
  const [picking, setPicking] = useState(false);
  const [plan, setPlan] = useState<MidiPlan | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(path: string) {
    setPicking(false);
    setError('');
    setPlan(null);
    try {
      const p = await api.midiPlan(path);
      setPlan(p);
      setName(p.suggestedName);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run() {
    if (!plan || busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.importMidi(plan.file, name);
      // a 1ª resposta são perguntas: não precisa do modo "pensar mais"
      pendingFirstMessage.set(r.song, { text: r.message, instrucao: r.instrucao });
      onCreated();
      openSong(r.song);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mode-panel">
      <p className="muted small">
        Selecione o <b>arquivo MIDI</b> da música. O Sostituto guarda uma cópia intacta, lê andamento, compasso,
        trilhas e marcadores, e o assistente faz algumas perguntas (gênero, estilo, referências, estrutura, se já
        está finalizada) para montar a música.
      </p>
      <button onClick={() => setPicking(true)}>{plan ? 'Escolher outro MIDI…' : '🎹 Selecionar o arquivo MIDI…'}</button>

      {plan && (
        <div className="card import-plan">
          <div className="small muted">Arquivo</div>
          <div className="path">{plan.file}</div>
          <div className="type-chips">
            <span className="chip">{plan.tracks} trilha{plan.tracks === 1 ? '' : 's'} com notas</span>
            {plan.durationSec > 0 && <span className="chip">{fmtDuration(plan.durationSec)}</span>}
            <span className="chip">{plan.bpm ? `${plan.bpm} BPM` : 'BPM não informado'}</span>
            {plan.timeSig && <span className="chip">{plan.timeSig}</span>}
            <span className="chip">{fmtSize(plan.bytes)}</span>
          </div>
          <label className="small">
            Nome da música
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
          </label>
          <button className="primary" onClick={run} disabled={busy || !name.trim()}>
            {busy ? 'Importando…' : 'Importar e conversar'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {picking && (
        <FilePicker
          title="Selecione o arquivo MIDI"
          accept={['mid', 'midi', 'kar', 'rmi']}
          start={vaultPath ?? undefined}
          onPick={pick}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
