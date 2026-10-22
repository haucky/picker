// Volltextsuche über Dateinamen und Inhalt – steht oben im Tab Home (createSearch), dazu Status und „Vault wechseln“.
import { h, highlighted, escapeRe } from './dom.js';

const MAX_HITS = 50;
const SNIPPET_BEFORE = 40;
const SNIPPET_LEN = 160;

let ui, core;
let q, hits;

function search() {
  const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) { hits.replaceChildren(); return; }

  // Alle Suchwörter müssen (als Teilstring, ohne Groß-/Kleinschreibung) im Namen oder Inhalt vorkommen.
  const results = [];
  for (const n of core.notes.values()) {
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const inName = n.nameLower.includes(t);
      const pos = n.lower.indexOf(t);
      if (!inName && pos < 0) { ok = false; break; }
      if (inName) score += n.nameLower.startsWith(t) ? 150 : 100;
      if (pos >= 0) score += 1;
    }
    if (ok) results.push({ n, score });
  }
  results.sort((a, b) => b.score - a.score || a.n.nameLower.localeCompare(b.n.nameLower, 'de', { numeric: true }));

  const re = new RegExp(terms.map(escapeRe).join('|'), 'gi');
  const items = results.slice(0, MAX_HITS).map(({ n }) => hitItem(n, terms, re));
  if (!results.length) {
    items.push(h('li', { class: 'empty' }, core.syncing && !core.notes.size ? 'Index wird aufgebaut …' : 'Keine Treffer.'));
  } else if (results.length > MAX_HITS) {
    items.push(h('li', { class: 'empty' }, `… und ${results.length - MAX_HITS} weitere. Suche genauer eingrenzen.`));
  }
  hits.replaceChildren(...items);
}

function snippet(n, terms) {
  let pos = -1;
  for (const t of terms) {
    const p = n.lower.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return '';
  const start = Math.max(0, pos - SNIPPET_BEFORE);
  const s = n.text.slice(start, start + SNIPPET_LEN).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '… ' : '') + s;
}

function hitItem(n, terms, re) {
  const btn = h('button', { type: 'button', class: 'hit', onclick: () => ui.openNote(n.path) },
    h('div', { class: 'name' }, highlighted(n.title, re)));
  if (n.path !== n.name) btn.append(h('div', { class: 'dir' }, n.path.slice(0, -n.name.length - 1)));
  const snip = snippet(n, terms);
  if (snip) btn.append(h('div', { class: 'snip' }, highlighted(snip, re)));
  return h('li', {}, btn);
}

/**
 * Suchleiste, Trefferliste und Statuszeile (Abgleich, „Zugriff erlauben“, „Vault wechseln“) für Home.
 * `onQuery(active)` meldet, ob gerade gesucht wird (dann blendet Home seinen übrigen Inhalt aus).
 * Gibt { bar, hits, footer, refresh } zurück.
 */
export function createSearch(_ui, { onQuery = () => {} } = {}) {
  ui = _ui;
  core = ui.core;
  q = h('input', {
    type: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'search', placeholder: 'Suchen …', 'aria-label': 'Suchen', class: 'q',
  });
  hits = h('ol', { class: 'hits' });
  const status = h('span', { class: 'status-text' });
  const btnPermission = h('button', { type: 'button', class: 'link accent', hidden: true,
    onclick: () => core.hasPermission(true) }, 'Zugriff erlauben');

  let active = false;
  const run = () => {
    search();
    const now = !!q.value.trim();
    if (now !== active) { active = now; onQuery(active); }
  };

  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 80); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hits.querySelector('.hit')?.click();
    if (e.key === 'Escape' && q.value) { q.value = ''; run(); }
  });

  let pending = false;
  core.on('change', () => {
    if (pending || !q.value.trim()) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; search(); });
  });
  core.on('status', (st) => {
    status.textContent = st.text;
    btnPermission.hidden = !st.needsPermission;
  });
  status.textContent = core.statusText;

  return {
    bar: h('div', { class: 'search' }, q),
    hits,
    footer: h('footer', { class: 'status' }, status, btnPermission,
      h('button', { type: 'button', class: 'link', onclick: ui.pickVault }, 'Vault wechseln')),
    refresh: run,
  };
}
