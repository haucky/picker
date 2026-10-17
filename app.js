// App-Rahmen: Startseite, Tabs für Feature-Module, gemeinsamer Notiz-Editor.
import { core } from './core.js';
import search from './features/search.js';
import tagging from './features/tagging.js';
import study from './features/study.js';
import review from './features/review.js';
import syncTab from './features/sync.js';
import { applyTheme } from './features/theme.js';
import { createEditor } from './features/editor.js';
import { createSpell } from './features/spell.js';
import { aiCorrect } from './features/aicorrect.js';
import { createPrompts } from './features/prompts.js';
import { createTagIndex } from './features/tags.js';

// Neue Feature-Module hier eintragen: { id, title, mount(root, ui), show?() }
const FEATURES = [search, tagging, study, review, syncTab];

const $ = (id) => document.getElementById(id);
const el = {
  viewStart: $('view-start'),
  unsupported: $('unsupported'),
  actions: $('actions'),
  btnOpen: $('btn-open'),
  app: $('app'),
  panels: $('panels'),
  tabs: $('tabs'),
  viewEditor: $('view-editor'),
  btnBack: $('btn-back'),
  btnSave: $('btn-save'),
  noteTitle: $('note-title'),
  notePath: $('note-path'),
  editor: $('editor'),
  toast: $('toast'),
};

let current = null; // { path, original }
let activeTab = null;
const panels = new Map();

/* ---------- gemeinsame UI-Funktionen für Module ---------- */

let toastTimer;
function toast(msg, ms = 2500) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

let editor = null; // CodeMirror-Editor für Notizen, siehe init()
const isDirty = () => current !== null && editor.value !== current.original;

async function pickVault() {
  if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  try {
    if (await core.pickVault()) showApp();
  } catch (err) {
    toast('Fehler: ' + err.message, 4000);
  }
}

async function openNote(path) {
  if (current && current.path !== path && isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  try {
    const text = await core.read(path);
    const note = core.get(path);
    current = { path, original: text };
    el.noteTitle.textContent = note.title;
    el.notePath.textContent = path;
    editor.set(text);
    el.btnSave.disabled = true;
    el.app.hidden = true;
    el.viewEditor.hidden = false;
    window.scrollTo(0, 0);
    history.pushState({ note: path }, '');
  } catch (err) {
    if (err.name === 'NotFoundError') toast('Datei existiert nicht mehr.', 3000);
    else toast('Konnte Datei nicht öffnen: ' + err.message, 4000);
  }
}

/**
 * Öffnet einen [[Link]] wie Obsidian: Pfad ab Vault-Wurzel, sonst per Dateiname (kürzester Pfad gewinnt).
 * `#Abschnitt` wird ignoriert.
 */
function openLink(target) {
  const want = target.split('#')[0].trim().toLowerCase().replace(/\.md$/, '');
  if (!want) return;
  const notes = core.list();
  const hit = notes.find((n) => n.path.toLowerCase().replace(/\.md$/, '') === want)
    || notes.filter((n) => n.nameLower === want.split('/').at(-1)).sort((a, b) => a.path.length - b.path.length)[0];
  if (hit) openNote(hit.path); else toast(`„${target}“ nicht gefunden`);
}

/** Bild-Link (relativ zu `fromPath`) → Object-URL oder null. */
async function resolveImage(link, fromPath) {
  if (!(await core.hasPermission())) return null;
  const p = await core.resolveAttachment(link, fromPath);
  return p ? core.fileUrl(p) : null;
}

/* ---------- Bilder einfügen ---------- */

const IMAGE_DIR = 'images';
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif' };
let markdownLinks = null; // Obsidian-Einstellung „Wikilinks verwenden“ aus .obsidian/app.json

async function useMarkdownLinks() {
  if (markdownLinks == null) {
    try {
      const dir = await core.vault.getDirectoryHandle('.obsidian');
      const cfg = JSON.parse(await (await (await dir.getFileHandle('app.json')).getFile()).text());
      markdownLinks = cfg.useMarkdownLinks === true;
    } catch {
      markdownLinks = false;
    }
  }
  return markdownLinks;
}

/** Speichert ein eingefügtes Bild wie Obsidian als images/Pasted image JJJJMMTTHHMMSS.png und gibt den Link (klein) zurück. */
async function saveImage(file) {
  const ext = IMAGE_EXT[file.type] || (/\.(\w+)$/.exec(file.name || '')?.[1] ?? 'png');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let name = `Pasted image ${stamp}.${ext}`;
  for (let i = 1; await core.exists(`${IMAGE_DIR}/${name}`); i++) name = `Pasted image ${stamp} ${i}.${ext}`;
  await core.createFile(`${IMAGE_DIR}/${name}`, file);
  return (await useMarkdownLinks()) ? `![|small](${IMAGE_DIR}/${encodeURI(name)})` : `![[${name}|small]]`;
}

/* ---------- Korrekturvorschläge (nur Desktop: feiner Zeiger) ---------- */

const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
const spell = desktop ? createSpell({ notes: () => core.list() }) : null;
if (spell) core.on('change', () => spell.invalidate());
const ai = desktop ? aiCorrect : null; // KI-Vorschläge per Doppelklick, ebenfalls nur am Computer
// KI-Prompts: am Computer auf markierten Text, überall über das Menü am Punkt einer Frage (Study)
const prompts = createPrompts({ notes: () => core.list() });

const tags = createTagIndex({ notes: () => core.list() }); // Tag-Vorschläge im Editor (auch auf dem Handy)
core.on('change', () => tags.invalidate());

const ui = { core, toast, openNote, openLink, resolveImage, saveImage, spell, ai, prompts, tags, desktop, pickVault };

/* ---------- Editor ---------- */

function closeEditor() {
  current = null;
  el.viewEditor.hidden = true;
  el.app.hidden = false;
}

async function save() {
  if (!current) return;
  el.btnSave.disabled = true;
  try {
    const text = editor.value;
    await core.update(current.path, text);
    current.original = text;
    toast('Gespeichert ✓');
  } catch (err) {
    toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  }
  el.btnSave.disabled = !isDirty();
}

// Bestätigung bei ungespeicherten Änderungen erfolgt im popstate-Handler.
function back() {
  if (history.state && history.state.note) history.back();
  else if (!isDirty() || confirm('Ungespeicherte Änderungen verwerfen?')) closeEditor();
}

/* ---------- Tabs ---------- */

function buildTabs() {
  for (const f of FEATURES) {
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.hidden = true;
    el.panels.append(panel);
    panels.set(f.id, panel);
    f.mount(panel, ui);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.dataset.id = f.id;
    btn.textContent = f.title;
    btn.addEventListener('click', () => selectTab(f.id));
    el.tabs.append(btn);
  }
}

function selectTab(id) {
  const f = FEATURES.find((x) => x.id === id) || FEATURES[0];
  activeTab = f.id;
  for (const [pid, panel] of panels) panel.hidden = pid !== f.id;
  for (const b of el.tabs.children) b.classList.toggle('active', b.dataset.id === f.id);
  try { localStorage.setItem('tab', f.id); } catch { /* egal */ }
  window.scrollTo(0, 0);
  f.show?.();
}

function showApp() {
  el.viewStart.hidden = true;
  el.app.hidden = false;
  let tab = activeTab;
  try { tab ??= localStorage.getItem('tab'); } catch { /* egal */ }
  selectTab(tab);
}

/* ---------- Init ---------- */

async function init() {
  applyTheme();
  if ('serviceWorker' in navigator) {
    // Neue Version installiert (neuer Service Worker übernimmt): Hinweis, die geladene Seite ist noch die alte.
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => toast('Neue Version geladen – Seite neu laden.', 8000));
    }
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  if (!core.supported) {
    el.unsupported.hidden = false;
    if (!window.isSecureContext) {
      el.unsupported.querySelector('p').textContent += ' Außerdem muss die Seite über HTTPS geladen werden.';
    }
    el.viewStart.hidden = false;
    return;
  }

  el.btnOpen.addEventListener('click', pickVault);
  el.btnBack.addEventListener('click', back);
  el.btnSave.addEventListener('click', save);
  editor = createEditor({
    parent: el.editor,
    onChange: () => { el.btnSave.disabled = !isDirty(); },
    openLink,
    resolveImage: (link) => resolveImage(link, current ? current.path : ''),
    saveImage,
    spell,
    ai,
    prompt: desktop ? prompts : null,
    tags,
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && current) { e.preventDefault(); save(); }
  });
  // Android-Zurück-Taste / Geste schließt die Notiz.
  window.addEventListener('popstate', () => {
    // noch in derselben Notiz (z. B. Großansicht eines Bilds geschlossen)
    if (!current || (history.state && history.state.note === current.path)) return;
    if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) {
      history.pushState({ note: current.path }, '');
      return;
    }
    closeEditor();
  });
  window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });

  const known = await core.init();
  buildTabs();
  if (!known) {
    el.actions.hidden = false;
    el.viewStart.hidden = false;
    return;
  }
  showApp();
  core.setStatus(core.countLabel());
  core.sync();
}

init();
