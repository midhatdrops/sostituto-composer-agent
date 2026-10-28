import { useCallback, useEffect, useState } from 'react';
import { api, pendingFirstMessage, type SongDetail, type TreeNode } from '../api';
import { Chat } from '../components/Chat';
import { FilePreview } from '../components/FilePreview';
import { findByWikilink } from '../fileTypes';

const fmtDate = (d: string) => d.split('-').reverse().join('/');

interface Props {
  song: string;
  tree: TreeNode[];
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  onOpenSettings: () => void;
  /** muda quando o settings local é criado/desativado */
  settingsVersion: number;
  /** algo mudou no disco (fim de uma resposta): recarregar árvore e lista */
  onChanged: () => void;
}

export function SongPage({ song, tree, selectedFile, onSelectFile, onOpenSettings, settingsVersion, onChanged }: Props) {
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [today, setToday] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** cada clique em "Fechar o dia" incrementa; o Chat envia o fechamento */
  const [closeTick, setCloseTick] = useState(0);
  const [chatBusy, setChatBusy] = useState(false);
  const [autoSend] = useState(() => {
    const m = pendingFirstMessage.get(song);
    pendingFirstMessage.delete(song);
    return m;
  });

  const reload = useCallback(async () => {
    const [d, c] = await Promise.all([api.song(song), api.config()]);
    setDetail(d);
    setToday(c.today);
    return d;
  }, [song]);

  useEffect(() => {
    reload()
      .then((d) => setDate((cur) => cur ?? d.sessions[0]?.date ?? null))
      .catch((e) => setError(e.message));
  }, [reload]);

  useEffect(() => {
    if (settingsVersion) reload().catch(() => {});
  }, [settingsVersion, reload]);

  async function openToday() {
    const s = await api.openToday(song);
    await reload();
    setDate(s.date);
    return s.date;
  }

  const openWikilink = (target: string) => {
    const f = findByWikilink(tree, target);
    if (f) onSelectFile(f.path);
  };

  if (error) return <div className="center error">{error}</div>;
  if (!detail) return <div className="center muted">Carregando…</div>;

  const hasToday = detail.sessions.some((s) => s.date === today);
  const current = detail.sessions.find((s) => s.date === date);

  return (
    <div className={`song-page ${selectedFile ? 'with-preview' : ''}`}>
      <section className="chat-col">
        <header className="song-head">
          <h1>{detail.name}</h1>
          <label className="session-pick small">
            Sessão{' '}
            <select value={date ?? ''} onChange={(e) => setDate(e.target.value || null)} disabled={!detail.sessions.length}>
              {!detail.sessions.length && <option value="">nenhuma ainda</option>}
              {detail.sessions.map((s) => (
                <option key={s.date} value={s.date}>
                  {fmtDate(s.date)}
                  {s.date === today ? ' (hoje)' : ''}
                </option>
              ))}
            </select>
          </label>
          {!hasToday && detail.sessions.length > 0 && <button onClick={openToday}>+ Sessão de hoje</button>}
          {current?.sessionId &&
            (current.closedAt ? (
              <span
                className="day-closed small"
                title={`Fechado ${current.closedBy === 'automático' ? 'automaticamente na sessão seguinte' : 'pelo botão'}. Uma mensagem nova reabre o dia.`}
              >
                ✓ Dia fechado
              </span>
            ) : (
              <button
                onClick={() => setCloseTick((n) => n + 1)}
                disabled={chatBusy}
                title="Atualiza o índice (onde paramos, estrutura, ideias), escreve os próximos passos e resume o dia"
              >
                🌙 Fechar o dia
              </button>
            ))}
          <button className={`badge ${detail.settings}`} onClick={onOpenSettings} title="Configurações (tema e prompt do assistente)">
            ⚙ settings {detail.settings}
          </button>
        </header>

        {date && date !== today && (
          <div className="banner">
            Você está na sessão de <b>{fmtDate(date)}</b>.{' '}
            <button onClick={openToday}>{hasToday ? 'Ir para a sessão de hoje' : 'Abrir sessão de hoje'}</button>
          </div>
        )}

        <Chat
          song={detail.name}
          date={date}
          autoSend={autoSend}
          onWikilink={openWikilink}
          ensureSession={async () => date ?? openToday()}
          closeTick={closeTick}
          onBusyChange={setChatBusy}
          onTurnEnd={() => {
            reload();
            onChanged();
          }}
        />
      </section>

      {selectedFile && (
        <FilePreview
          song={detail.name}
          path={selectedFile}
          tree={tree}
          onOpen={onSelectFile}
          onClose={() => onSelectFile(null)}
        />
      )}
    </div>
  );
}
