import { useEffect, useMemo, useState } from 'react';
import type { Song, TreeNode } from '../api';
import { ALL_TYPES, filterTree, typeOf, walkFiles } from '../fileTypes';

interface Props {
  songs: Song[];
  current: string | null;
  tree: TreeNode[] | null;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  vaultPath: string | null;
  onChangeVault: () => void;
  onOpenSettings: () => void;
}

const songHref = (name: string) => `#/m/${encodeURIComponent(name)}`;

function Tree({ nodes, selected, onSelect, depth = 0 }: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (p: string) => void;
  depth?: number;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (p: string) =>
    setClosed((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  return (
    <ul className="tree">
      {nodes.map((n) =>
        n.type === 'dir' ? (
          <li key={n.path}>
            <button className="tree-row dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(n.path)}>
              <span className="caret">{closed.has(n.path) ? '▸' : '▾'}</span> 📁 {n.name}
              <span className="count">{walkFiles(n.children ?? []).length || ''}</span>
            </button>
            {!closed.has(n.path) && (
              <Tree nodes={n.children ?? []} selected={selected} onSelect={onSelect} depth={depth + 1} />
            )}
          </li>
        ) : (
          <li key={n.path}>
            <button
              className={`tree-row file ${n.path === selected ? 'active' : ''}`}
              style={{ paddingLeft: 22 + depth * 14 }}
              onClick={() => onSelect(n.path)}
              title={n.path}
            >
              {typeOf(n.ext).icon} {n.name}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

export function Sidebar({ songs, current, tree, selectedFile, onSelectFile, vaultPath, onChangeVault, onOpenSettings }: Props) {
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  /** a música aberta pode ser recolhida; ao trocar de música ela abre expandida */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [current]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of walkFiles(tree ?? [])) c[typeOf(f.ext).id] = (c[typeOf(f.ext).id] ?? 0) + 1;
    return c;
  }, [tree]);
  const filtered = useMemo(() => filterTree(tree ?? [], types), [tree, types]);
  const visibleSongs = songs.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  const toggleType = (id: string) =>
    setTypes((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <a href="#/" className="brand">
          <img src="/favicon-64.png" alt="" width={28} height={28} /> <span>Sostituto</span>
        </a>
        <span className="head-actions">
          <a href="#/" className="new-btn" title="Começar uma música nova">+ Nova</a>
          <button className="icon-btn" onClick={onOpenSettings} title="Configurações" aria-label="Configurações">⚙</button>
        </span>
      </div>

      {songs.length > 6 && (
        <input className="song-search" placeholder="Buscar música…" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}

      <nav className="songs">
        {songs.length === 0 && <p className="muted small pad">Nenhuma música ainda.</p>}
        {visibleSongs.map((s) => {
          const isCurrent = s.name === current;
          const open = isCurrent && !collapsed;
          return (
            <div key={s.name} className={`song-item ${isCurrent ? 'current' : ''} ${open ? 'open' : ''}`}>
              <a
                href={songHref(s.name)}
                className="song-link"
                aria-expanded={isCurrent ? open : undefined}
                onClick={(e) => {
                  // na música já aberta, clicar recolhe/expande a árvore em vez de navegar
                  if (isCurrent) {
                    e.preventDefault();
                    setCollapsed((c) => !c);
                  }
                }}
              >
                <span className="caret">{open ? '▾' : '▸'}</span> 🎵 {s.name}
              </a>
              {open && (
                <div className="song-files">
                  <div className="filters" role="group" aria-label="Filtrar por tipo de arquivo">
                    <button className={`chip ${types.size === 0 ? 'on' : ''}`} onClick={() => setTypes(new Set())}>
                      Todos
                    </button>
                    {ALL_TYPES.filter((t) => counts[t.id]).map((t) => (
                      <button key={t.id} className={`chip ${types.has(t.id) ? 'on' : ''}`} onClick={() => toggleType(t.id)}>
                        {t.icon} {t.label} <span className="count">{counts[t.id]}</span>
                      </button>
                    ))}
                  </div>
                  {tree === null ? (
                    <p className="muted small pad">Carregando…</p>
                  ) : filtered.length === 0 ? (
                    <p className="muted small pad">Nenhum arquivo deste tipo.</p>
                  ) : (
                    <Tree nodes={filtered} selected={selectedFile} onSelect={onSelectFile} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <footer className="sidebar-foot small muted">
        <span title={vaultPath ?? ''}>📂 {vaultPath}</span>
        <button className="link" onClick={onChangeVault}>trocar</button>
      </footer>
    </aside>
  );
}
