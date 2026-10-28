export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'sostituto.theme';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  return 'auto';
}

/** "auto" segue o claro/escuro do sistema (via prefers-color-scheme no CSS). */
export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    if (t === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
}
