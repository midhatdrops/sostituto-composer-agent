import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type AppConfig, type Song, type TreeNode } from './api';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { Home } from './pages/Home';
import { SongPage } from './pages/SongPage';
import { applyTheme, getTheme } from './theme';
import './styles.css';

applyTheme(getTheme());

/** Rotas por hash: #/ (início) e #/m/<música>. */
function useRouteSong(): string | null {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const m = hash.match(/^#\/m\/(.+)$/);
  return m ? decodeURIComponent(m[1]).normalize('NFC') : null;
}

function App() {
  const song = useRouteSong();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const loadSongs = useCallback(() => {
    api.songs().then(setSongs).catch((e) => setError(e.message));
  }, []);
  const loadTree = useCallback(() => {
    if (song) api.tree(song).then(setTree).catch(() => setTree([]));
  }, [song]);

  useEffect(() => {
    api.config().then((c) => {
      setConfig(c);
      if (c.vaultOk) loadSongs();
    });
  }, [loadSongs]);

  // trocar de música: limpa a árvore e o arquivo aberto
  useEffect(() => {
    setTree(null);
    setSelectedFile(null);
    loadTree();
  }, [loadTree]);

  async function changeVault() {
    const p = prompt('Pasta das músicas (o vault). As músicas ficam em Músicas/ dentro dela:', config?.vaultPath ?? '');
    if (!p) return;
    try {
      await api.setVault(p);
      location.hash = '#/';
      location.reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  if (!config) return <div className="center muted">Carregando…</div>;

  return (
    <div className="shell">
      <Sidebar
        songs={songs}
        current={song}
        tree={tree}
        selectedFile={selectedFile}
        onSelectFile={setSelectedFile}
        vaultPath={config.vaultPath}
        onChangeVault={changeVault}
        onOpenSettings={() => setShowSettings(true)}
      />
      <main className="main">
        {!config.vaultOk ? (
          <div className="center">
            <div className="card">
              <p className="error">A pasta das músicas não está acessível:</p>
              <p><code>{config.vaultPath}</code></p>
              <p className="muted small">Se ela está num HD externo, conecte-o e recarregue a página, ou troque a pasta.</p>
              <button onClick={changeVault}>Trocar pasta</button>
            </div>
          </div>
        ) : error ? (
          <div className="center error">{error}</div>
        ) : song ? (
          <SongPage
            key={song}
            song={song}
            tree={tree ?? []}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            onOpenSettings={() => setShowSettings(true)}
            settingsVersion={settingsVersion}
            onChanged={() => {
              loadTree();
              loadSongs();
            }}
          />
        ) : (
          <Home onCreated={loadSongs} vaultPath={config.vaultPath} />
        )}
      </main>
      {showSettings && (
        <SettingsModal
          song={song}
          onClose={() => setShowSettings(false)}
          onSettingsChanged={() => setSettingsVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
