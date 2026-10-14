// App-Rahmen: Startseite, Tabs für Feature-Module, gemeinsamer Notiz-Editor.
import { core } from './core.js';
import search from './features/search.js';
import tagging from './features/tagging.js';
import study from './features/study.js';
import review from './features/review.js';
import syncTab from './features/sync.js';
import { applyTheme } from './features/theme.js';

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

const isDirty = () => current !== null && el.editor.value !== current.original;

async function pickVault() {
  if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  try {
    if (await core.pickVault()) showApp();
  } catch (err) {
    toast('Fehler: ' + err.message, 4000);
  }
}

async function openNote(path) {
  try {
    const text = await core.read(path);
    const note = core.get(path);
    current = { path, original: text };
    el.noteTitle.textContent = note.title;
    el.notePath.textContent = path;
    el.editor.value = text;
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

const ui = { core, toast, openNote, pickVault };

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
    const text = el.editor.value;
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
  el.editor.addEventListener('input', () => { el.btnSave.disabled = !isDirty(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && current) { e.preventDefault(); save(); }
  });
  // Android-Zurück-Taste / Geste schließt die Notiz.
  window.addEventListener('popstate', () => {
    if (!current) return;
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
