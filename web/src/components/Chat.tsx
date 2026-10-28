import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PROVIDER, api, sendChat, type ChatMessage, type ProviderId, type ProviderStatus } from '../api';
import { renderMarkdown } from '../markdown';
import { ProviderIcon } from '../providerIcons';
import { ProviderPicker } from './ProviderPicker';

const LABEL: Record<ProviderId, string> = { claude: 'Claude', codex: 'Codex', kimi: 'Kimi' };

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'assistant') {
    // quem respondeu só aparece quando não é o Claude (o padrão)
    const who = m.provider && m.provider !== 'claude' ? m.provider : null;
    return (
      <div className="msg assistant">
        {who && (
          <div className="msg-provider small muted">
            <ProviderIcon id={who} size={13} /> {LABEL[who]}
          </div>
        )}
        <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
      </div>
    );
  }
  // ações do assistente (ler/gravar arquivos) não aparecem: a conversa fica só entre as pessoas.
  // Elas continuam no estado para separar as falas em balões distintos.
  if (m.role === 'tool') return null;
  return <div className={`msg ${m.role}`}>{m.text}</div>;
}

interface Props {
  song: string;
  date: string | null;
  /** mensagem a enviar sozinha ao abrir (vinda da tela inicial) */
  autoSend?: { text: string; deep?: boolean; instrucao?: string };
  onWikilink: (target: string) => void;
  /** Garante que existe uma sessão (abre a de hoje se não houver) e devolve a data. */
  ensureSession: () => Promise<string>;
  onTurnEnd: () => void;
  /** muda a cada clique em "Fechar o dia" */
  closeTick?: number;
  onBusyChange?: (busy: boolean) => void;
}

/** Texto mostrado na conversa para o fechamento (o servidor manda o pedido completo). */
const CLOSE_TEXT = '🌙 Fechar o dia';

/** Provider escolhido, por música (só conveniência do navegador; pode faltar). */
const providerKey = (song: string) => `sostituto.provider.${song}`;
function savedProvider(song: string): ProviderId {
  try {
    const v = localStorage.getItem(providerKey(song));
    if (v === 'claude' || v === 'codex' || v === 'kimi') return v;
  } catch {}
  return DEFAULT_PROVIDER;
}

export function Chat({ song, date, autoSend, onWikilink, ensureSession, onTurnEnd, closeTick, onBusyChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** "pensar mais": a próxima mensagem vai com o modelo/esforço do modo profundo */
  const [deep, setDeep] = useState(false);
  const [provider, setProvider] = useState<ProviderId>(() => savedProvider(song));
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** Data da sessão aberta pela própria mensagem em andamento: não recarregar por cima do streaming. */
  const openedHere = useRef<string | null>(null);

  useEffect(() => {
    if (!date) return setMessages([]);
    if (date === openedHere.current) return;
    api.messages(song, date).then(setMessages).catch(() => setMessages([]));
  }, [song, date]);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages]);

  useEffect(() => {
    api
      .providers()
      .then((list) => {
        setProviders(list);
        // o escolhido antes perdeu o login (ou não existe mais): volta para o padrão
        setProvider((p) => (list.some((x) => x.id === p && x.installed && x.loggedIn) ? p : DEFAULT_PROVIDER));
      })
      .catch(() => {});
  }, []);

  const chooseProvider = (p: ProviderId) => {
    setProvider(p);
    try {
      localStorage.setItem(providerKey(song), p);
    } catch {}
  };

  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSend && !autoSent.current) {
      autoSent.current = true;
      send(autoSend.text, { deep: autoSend.deep, instrucao: autoSend.instrucao });
    }
  }, [autoSend]);

  useEffect(() => onBusyChange?.(busy), [busy]);

  useEffect(() => {
    if (closeTick) send(CLOSE_TEXT, { deep: false, close: true });
  }, [closeTick]);

  /** Acrescenta texto à última bolha do assistente (ou cria uma nova). */
  const appendDelta = (text: string, from: ProviderId) =>
    setMessages((ms) => {
      const last = ms[ms.length - 1];
      if (last?.role === 'assistant') return [...ms.slice(0, -1), { ...last, text: last.text + text }];
      return [...ms, { role: 'assistant', text, provider: from }];
    });
  const push = (m: ChatMessage) => setMessages((ms) => [...ms, m]);

  async function send(override?: string, extra: { deep?: boolean; close?: boolean; instrucao?: string } = {}) {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    const useDeep = extra.deep ?? deep;
    const from = provider;
    if (override === undefined) {
      setInput('');
      setDeep(false); // vale só para esta mensagem
    }
    setBusy(true);
    push({ role: 'user', text });
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      if (!date) openedHere.current = await ensureSession();
      const d = date ?? openedHere.current!;
      await sendChat(
        song,
        d,
        text,
        (ev) => {
          if (ev.type === 'delta') appendDelta(ev.text, from);
          else if (ev.type === 'tool') push({ role: 'tool', text: `${ev.name} ${ev.detail}`.trim() });
          else if (ev.type === 'denied') push({ role: 'tool', text: `⛔ ${ev.name}: ${ev.reason}` });
          else if (ev.type === 'error') push({ role: 'error', text: ev.message });
        },
        abort.signal,
        { deep: useDeep, close: extra.close, instrucao: extra.instrucao, provider: from },
      );
    } catch (err) {
      if (!abort.signal.aborted) push({ role: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
      abortRef.current = null;
      openedHere.current = null;
      onTurnEnd();
    }
  }

  const question = (
    <>
      O que vamos fazer na música <b>{song}</b>?
    </>
  );

  return (
    <div className="chat">
      <div
        className="messages"
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a[data-wikilink]');
          if (a) {
            e.preventDefault();
            onWikilink(a.getAttribute('data-wikilink')!);
          }
        }}
      >
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <h2>{question}</h2>
            {!date && <p className="muted">A primeira mensagem abre a sessão de hoje.</p>}
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {busy && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="typing" aria-label="digitando">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`O que vamos fazer na música ${song}?`}
          rows={3}
        />
        <div className="composer-side">
          {providers.length > 0 && <ProviderPicker value={provider} providers={providers} onChange={chooseProvider} disabled={busy} />}
          <button
            type="button"
            className={`deep-toggle ${deep ? 'on' : ''}`}
            aria-pressed={deep}
            onClick={() => setDeep((d) => !d)}
            disabled={busy}
            title="Pensar mais: raciocínio mais profundo só nesta mensagem (no Claude, usa o modelo e o esforço definidos em Configurações)"
          >
            🧠 Pensar mais
          </button>
        </div>
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Parar
          </button>
        ) : (
          <button className="primary" disabled={!input.trim()}>
            Enviar
          </button>
        )}
      </form>
    </div>
  );
}
