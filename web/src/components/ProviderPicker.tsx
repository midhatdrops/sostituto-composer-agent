import { useEffect, useRef, useState } from 'react';
import type { ProviderId, ProviderStatus } from '../api';
import { ProviderIcon } from '../providerIcons';

interface Props {
  value: ProviderId;
  providers: ProviderStatus[];
  onChange: (id: ProviderId) => void;
  disabled?: boolean;
}

/** Escolha de quem responde (Claude, Codex, Kimi). Um provider sem login aparece com o comando para entrar. */
export function ProviderPicker({ value, providers, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = providers.find((p) => p.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('mousedown', onDown);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('mousedown', onDown);
      removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="provider-pick" ref={ref}>
      <button
        type="button"
        className="provider-current"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Escolher a IA que responde"
      >
        <ProviderIcon id={value} />
        <span>{current?.label ?? value}</span>
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="provider-menu" role="listbox" aria-label="IA que responde">
          {providers.map((p) => {
            const ready = p.installed && p.loggedIn;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  className={p.id === value ? 'on' : ''}
                  disabled={!ready}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <ProviderIcon id={p.id} size={18} />
                  <span className="provider-name">{p.label}</span>
                  {p.id === value && <span className="check" aria-hidden="true">✓</span>}
                  {!ready && (
                    <span className="provider-hint">
                      {p.installed ? 'precisa de login: ' : 'não instalado: '}
                      <code>{p.installed ? p.login : 'npm install'}</code>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
