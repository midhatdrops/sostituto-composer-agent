import { useEffect, useState } from 'react';
import { api, type FsListing } from '../api';

interface Props {
  title: string;
  /** extensões que podem ser escolhidas (o resto aparece apagado) */
  accept: string[];
  start?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

const sep = (p: string) => (p.includes('\\') ? '\\' : '/');

/** Navegador de pastas do computador (somente leitura), servido pelo próprio app. */
export function FilePicker({ title, accept, start, onPick, onClose }: Props) {
  const [roots, setRoots] = useState<{ label: string; path: string }[]>([]);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const go = (p?: string) => {
    setError('');
    api
      .fsList(p)
      .then((l) => {
        setListing(l);
        setTyped(l.path);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    api.fsRoots().then(setRoots).catch(() => {});
    go(start);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const join = (name: string) => (listing!.path.endsWith(sep(listing!.path)) ? listing!.path + name : listing!.path + sep(listing!.path) + name);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide picker" role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} title="Fechar">✕</button>
        </header>
        <div className="picker-body">
          <nav className="picker-roots">
            {roots.map((r) => (
              <button key={r.path} className={listing?.path === r.path ? 'on' : ''} onClick={() => go(r.path)} title={r.path}>
                {r.label}
              </button>
            ))}
          </nav>
          <div className="picker-main">
            <form
              className="picker-path"
              onSubmit={(e) => {
                e.preventDefault();
                go(typed);
              }}
            >
              <button type="button" onClick={() => listing?.parent && go(listing.parent)} disabled={!listing?.parent} title="Pasta acima">
                ↑
              </button>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Caminho" />
              <button>Ir</button>
            </form>
            {error && <p className="error small">{error}</p>}
            <ul className="picker-list">
              {listing?.entries.length === 0 && <li className="muted small pad">Pasta vazia.</li>}
              {listing?.entries.map((e) => {
                const ok = e.type === 'file' && accept.includes(e.ext);
                return (
                  <li key={e.name}>
                    {e.type === 'dir' ? (
                      <button className="tree-row" onClick={() => go(join(e.name))}>📁 {e.name}</button>
                    ) : (
                      <button className={`tree-row ${ok ? 'pickable' : 'dim'}`} disabled={!ok} onClick={() => onPick(join(e.name))}>
                        {ok ? (['mid', 'midi', 'kar', 'rmi'].includes(e.ext) ? '🎹' : '📝') : '📄'} {e.name}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
