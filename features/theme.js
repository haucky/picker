// Darstellung: Solarized hell/dunkel. 'auto' folgt der System-Einstellung. Das data-theme-Attribut setzt
// index.html schon vor dem ersten Zeichnen; hier nur Umschalten und die Farbe der Browser-Leiste.
const KEY = 'theme';
export const THEMES = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };

export function getTheme() {
  try { const t = localStorage.getItem(KEY); return t in THEMES ? t : 'auto'; } catch { return 'auto'; }
}

export function setTheme(t) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* egal */ }
  applyTheme();
}

export function applyTheme() {
  const t = getTheme();
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
