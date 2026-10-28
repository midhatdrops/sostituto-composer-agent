import { useEffect, useState } from 'react';
import { api, fileUrl, type TreeNode } from '../api';
import { findByWikilink, typeOf, walkFiles } from '../fileTypes';
import { renderMarkdown } from '../markdown';

interface Props {
  song: string;
  path: string;
  tree: TreeNode[];
  onOpen: (path: string) => void;
  onClose: () => void;
}

const fmtSize = (n = 0) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function FilePreview({ song, path, tree, onOpen, onClose }: Props) {
  const node = walkFiles(tree).find((f) => f.path === path);
  const type = typeOf(node?.ext);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setText(null);
    setError('');
    if (type.id === 'md') api.fileText(song, path).then(setText).catch((e) => setError(e.message));
  }, [song, path, type.id, node?.mtime]);

  /** Cliques em [[wikilinks]] abrem o arquivo correspondente no painel. */
  function onClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[data-wikilink]');
    if (!a) return;
    e.preventDefault();
    const target = findByWikilink(tree, a.getAttribute('data-wikilink')!);
    if (target) onOpen(target.path);
  }

  return (
    <aside className="preview">
      <header className="preview-head">
        <div className="preview-title">
          <span>{type.icon} {node?.name ?? path}</span>
          <span className="muted small">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span>
        </div>
        <a className="btn" href={fileUrl(song, path, true)} title="Baixar">⬇</a>
        <button onClick={onClose} title="Fechar">✕</button>
      </header>
      <div className="preview-body">
        {error && <p className="error">{error}</p>}
        {type.id === 'md' &&
          (text === null ? (
            !error && <p className="muted">Carregando…</p>
          ) : (
            <div
              className="md"
              onClick={onClick}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(text, (t) => !!findByWikilink(tree, t)) }}
            />
          ))}
        {type.id === 'audio' && <audio controls src={fileUrl(song, path)} style={{ width: '100%' }} />}
        {type.id !== 'md' && type.id !== 'audio' && (
          <div className="muted">
            <p>{fmtSize(node?.size)} · {node?.mtime && new Date(node.mtime).toLocaleString('pt-BR')}</p>
            {(type.id === 'midi' || type.id === 'xml') && <p>O player MIDI e a partitura chegam na etapa 2. Por enquanto, baixe o arquivo.</p>}
            {type.id === 'mscz' && <p>Partitura do MuseScore: somente leitura.</p>}
            <a className="btn primary" href={fileUrl(song, path, true)}>Baixar arquivo</a>
          </div>
        )}
      </div>
    </aside>
  );
}
