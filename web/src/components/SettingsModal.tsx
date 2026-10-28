import { useEffect, useState } from 'react';
import { api, type AssistantConfig, type Effort } from '../api';
import { applyTheme, getTheme, type Theme } from '../theme';

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'auto', label: 'Automático', hint: 'segue o sistema' },
  { id: 'light', label: 'Claro', hint: '' },
  { id: 'dark', label: 'Escuro', hint: '' },
];

type View = 'menu' | 'prompt' | 'geral' | 'local';

interface Props {
  /** música aberta (null na tela inicial): habilita o settings local */
  song: string | null;
  onClose: () => void;
  /** settings local criado/desativado: a tela da música atualiza o selo */
  onSettingsChanged: () => void;
}

interface EditorProps {
  load: () => Promise<{ text: string; padrao?: string }>;
  save: (text: string) => Promise<unknown>;
  mono?: boolean;
  /** valida antes de salvar; devolve a mensagem de erro ou null */
  validate?: (text: string) => string | null;
  note?: React.ReactNode;
  onDirty: (dirty: boolean) => void;
}

/** Editor de texto com salvar / restaurar padrão, usado pelo prompt e pelos settings. */
function TextEditor({ load, save, validate, note, onDirty }: EditorProps) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [padrao, setPadrao] = useState<string | undefined>();
  const [status, setStatus] = useState('');

  useEffect(() => {
    load()
      .then((r) => {
        setText(r.text);
        setSaved(r.text);
        setPadrao(r.padrao);
      })
      .catch((e) => setStatus(e.message));
  }, []);

  const dirty = text !== null && text !== saved;
  useEffect(() => onDirty(dirty), [dirty]);

  async function onSave() {
    if (text === null) return;
    const err = validate?.(text);
    if (err) return setStatus(err);
    try {
      await save(text);
      setSaved(text);
      setStatus('Salvo. Vale a partir da próxima mensagem.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  if (text === null) return <p className="muted">{status || 'Carregando…'}</p>;
  return (
    <>
      {note && <div className="editor-note small">{note}</div>}
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="modal-actions">
        <span className={`small ${status && !status.startsWith('Salvo') ? 'error' : 'muted'}`}>
          {status || (dirty ? 'Alterações não salvas' : '')}
        </span>
        {padrao !== undefined && (
          <button
            onClick={() => confirm('Substituir o texto pelo padrão? (só é gravado ao salvar)') && setText(padrao)}
            disabled={!padrao || text === padrao}
          >
            Restaurar padrão
          </button>
        )}
        <button className="primary" onClick={onSave} disabled={!dirty}>
          Salvar
        </button>
      </div>
    </>
  );
}

const EFFORT_LABELS: Record<Effort, string> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Muito alto',
  max: 'Máximo',
};

/** Modelo e esforço: o do dia a dia e o do "pensar mais". Salva ao mudar. */
function AssistantSection() {
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof api.assistant>> | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.assistant().then(setCfg).catch((e) => setStatus(e.message));
  }, []);

  async function change(patch: Partial<AssistantConfig>) {
    if (!cfg) return;
    setCfg({ ...cfg, ...patch });
    try {
      await api.saveAssistant(patch);
      setStatus('Salvo. Vale a partir da próxima mensagem.');
    } catch (e) {
      setStatus((e as Error).message);
    }
  }

  if (!cfg) return <section><h3>Modelo do assistente</h3><p className="muted small">{status || 'Carregando…'}</p></section>;

  const row = (label: string, hint: string, modelKey: 'model' | 'deepModel', effortKey: 'effort' | 'deepEffort') => (
    <div className="model-row">
      <div>
        <div className="small"><b>{label}</b></div>
        <div className="muted small">{hint}</div>
      </div>
      <select value={cfg[modelKey]} onChange={(e) => change({ [modelKey]: e.target.value })} aria-label={`Modelo — ${label}`}>
        {cfg.models.map((m) => (
          <option key={m.id} value={m.id} title={m.hint}>{m.label}</option>
        ))}
      </select>
      <select value={cfg[effortKey]} onChange={(e) => change({ [effortKey]: e.target.value as Effort })} aria-label={`Esforço — ${label}`}>
        {cfg.efforts.map((ef) => (
          <option key={ef} value={ef}>Esforço {EFFORT_LABELS[ef].toLowerCase()}</option>
        ))}
      </select>
    </div>
  );

  return (
    <section>
      <h3>Modelo do assistente</h3>
      {row('Dia a dia', 'conversa, sugestões e anotações', 'model', 'effort')}
      {row('Pensar mais', 'botão 🧠 no chat e importação de músicas', 'deepModel', 'deepEffort')}
      <p className="muted small">
        {status || 'Opus e esforço alto pensam mais fundo, mas são mais lentos e gastam mais do limite do plano.'}
      </p>
    </section>
  );
}

const validateJson = (t: string) => {
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? null : 'O settings.json precisa ser um objeto { ... }';
  } catch (e) {
    return `JSON inválido: ${(e as Error).message}`;
  }
};

const FIXED_RULES = (
  <>
    Independentemente deste arquivo, o app sempre bloqueia: escrita em <code>Export/</code>, alteração de{' '}
    <code>.mscz</code>, escrita fora de <code>Músicas/</code> ou em <code>.claude/</code> e comandos de terminal.
  </>
);

const TITLES: Record<View, string> = {
  menu: 'Configurações',
  prompt: 'Prompt do assistente',
  geral: 'settings.json geral',
  local: 'settings.json desta música',
};

export function SettingsModal({ song, onClose, onSettingsChanged }: Props) {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [view, setView] = useState<View>('menu');
  const [dirty, setDirty] = useState(false);
  /** undefined = carregando; null = a música usa o geral */
  const [local, setLocal] = useState<string | null | undefined>(song ? undefined : null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (song) api.localSettings(song).then((r) => setLocal(r.content)).catch(() => setLocal(null));
  }, [song, view]);

  const leave = (fn: () => void) => () => (!dirty || confirm('Descartar as alterações?')) && (setDirty(false), fn());
  const close = leave(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  function pickTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
  }

  async function createLocal() {
    if (!song) return;
    try {
      await api.createLocalSettings(song);
      onSettingsChanged();
      setView('local');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function disableLocal() {
    if (!song || !confirm(`Voltar "${song}" para o settings geral?\nO arquivo local não é apagado: ele é renomeado e deixa de valer.`)) return;
    try {
      const r = await api.disableLocalSettings(song);
      setLocal(null);
      setMsg(`Settings local desativado (renomeado para .claude/${r.renamedTo}).`);
      onSettingsChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${view !== 'menu' ? 'wide' : ''}`} role="dialog" aria-label={TITLES[view]}>
        <header className="modal-head">
          <h2>{TITLES[view]}</h2>
          {view !== 'menu' && <button onClick={leave(() => setView('menu'))}>← Voltar</button>}
          <button onClick={close} title="Fechar">✕</button>
        </header>

        {view === 'menu' && (
          <div className="modal-body settings-list">
            <section>
              <h3>Aparência</h3>
              <div className="segmented" role="radiogroup">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={theme === t.id}
                    className={theme === t.id ? 'on' : ''}
                    onClick={() => pickTheme(t.id)}
                  >
                    {t.label}
                    {t.hint && <span className="small"> · {t.hint}</span>}
                  </button>
                ))}
              </div>
            </section>

            <AssistantSection />

            <section>
              <h3>Assistente</h3>
              <p className="muted small">O prompt que orienta o assistente em todas as músicas.</p>
              <button onClick={() => setView('prompt')}>✎ Alterar prompt do assistente</button>
            </section>

            <section>
              <h3>Permissões (settings.json)</h3>
              <p className="muted small">
                O geral vale para todas as músicas. Uma música com settings local usa só o dela, no lugar do geral.
              </p>
              <div className="btn-row">
                <button onClick={() => setView('geral')}>✎ Editar settings geral</button>
              </div>
              {song && (
                <div className="local-box">
                  <p className="small">
                    <b>{song}</b>:{' '}
                    {local === undefined ? '…' : local === null ? 'usa o settings geral' : 'usa settings local'}
                  </p>
                  {local === null && <button onClick={createLocal}>+ Criar settings local (cópia do geral)</button>}
                  {typeof local === 'string' && (
                    <div className="btn-row">
                      <button onClick={() => setView('local')}>✎ Editar settings local</button>
                      <button onClick={disableLocal}>Voltar a usar o geral</button>
                    </div>
                  )}
                </div>
              )}
              {!song && <p className="muted small">Abra uma música para criar um settings só dela.</p>}
              {msg && <p className="small muted">{msg}</p>}
            </section>
          </div>
        )}

        {view === 'prompt' && (
          <div className="modal-body text-editor">
            <TextEditor
              load={async () => {
                const r = await api.prompt();
                return { text: r.prompt, padrao: r.padrao };
              }}
              save={api.savePrompt}
              onDirty={setDirty}
            />
          </div>
        )}

        {view === 'geral' && (
          <div className="modal-body text-editor">
            <TextEditor
              load={async () => ({ text: (await api.generalSettings()).content })}
              save={api.saveGeneralSettings}
              validate={validateJson}
              note={<>Arquivo <code>claude-settings/settings.json</code>. {FIXED_RULES}</>}
              onDirty={setDirty}
            />
          </div>
        )}

        {view === 'local' && song && (
          <div className="modal-body text-editor">
            <TextEditor
              load={async () => ({ text: (await api.localSettings(song)).content ?? '{}' })}
              save={(t) => api.saveLocalSettings(song, t)}
              validate={validateJson}
              note={<>Arquivo <code>Músicas/{song}/.claude/settings.json</code>, usado no lugar do geral. {FIXED_RULES}</>}
              onDirty={setDirty}
            />
          </div>
        )}
      </div>
    </div>
  );
}
