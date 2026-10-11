'use strict';

const HIDDEN_DIRS = new Set(['.obsidian', '.trash', '.git']);
const MAX_HITS = 50;
const SNIPPET_BEFORE = 40;
const SNIPPET_LEN = 160;
const READ_CONCURRENCY = 16;

const $ = (id) => document.getElementById(id);
const el = {
  viewStart: $('view-start'),
  viewSearch: $('view-search'),
  viewEditor: $('view-editor'),
  unsupported: $('unsupported'),
  actions: $('actions'),
  btnOpen: $('btn-open'),
  q: $('q'),
  hits: $('hits'),
  status: $('status'),
  btnPermission: $('btn-permission'),
  btnSwitch: $('btn-switch'),
  btnBack: $('btn-back'),
  btnSave: $('btn-save'),
  noteTitle: $('note-title'),
  notePath: $('note-path'),
  editor: $('editor'),
  toast: $('toast'),
};

let vault = null;           // FileSystemDirectoryHandle
const notes = new Map();    // path -> { path, name, size, mtime, text, lower, nameLower }
const handles = new Map();  // path -> FileSystemFileHandle (nach Abgleich bekannt)
let current = null;         // { path, name, handle, original }
let syncRun = 0;            // erhöht sich bei jedem Abgleich; ältere brechen ab
let syncing = false;

/* ---------- IndexedDB ---------- */
// Store "handles": Vault-Handle. Store "notes": Kopie aller Notizen für die Suche.

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('vault-picker', 2);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'path' });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

const loadHandle = () => tx('handles', 'readonly', (s) => s.get('vault'));
const saveHandle = (h) => tx('handles', 'readwrite', (s) => s.put(h, 'vault'));
const loadNotes = () => tx('notes', 'readonly', (s) => s.getAll());
const clearNotes = () => tx('notes', 'readwrite', (s) => s.clear());
const writeNotes = (puts, dels = []) => tx('notes', 'readwrite', (s) => {
  for (const n of puts) s.put({ path: n.path, name: n.name, size: n.size, mtime: n.mtime, text: n.text });
  for (const p of dels) s.delete(p);
});

function remember(n) {
  n.lower = n.text.toLowerCase();
  n.nameLower = n.name.replace(/\.md$/i, '').toLowerCase();
  notes.set(n.path, n);
}

/* ---------- UI-Helfer ---------- */

let toastTimer;
function toast(msg, ms = 2500) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function show(view) {
  for (const v of [el.viewStart, el.viewSearch, el.viewEditor]) v.hidden = v !== view;
}

function setStatus(text) {
  el.status.textContent = text;
}

function countLabel() {
  return `${notes.size} Notiz${notes.size === 1 ? '' : 'en'}`;
}

const isDirty = () => current !== null && el.editor.value !== current.original;

async function hasPermission(handle, request = false) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return request && (await handle.requestPermission(opts)) === 'granted';
}

/* ---------- Vault ---------- */

async function pickVault() {
  if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'vault', mode: 'readwrite' });
  } catch (err) {
    if (err.name !== 'AbortError') toast('Fehler: ' + err.message, 4000);
    return;
  }
  const same = vault && (await vault.isSameEntry(handle));
  vault = handle;
  await saveHandle(handle);
  if (!same) {
    syncRun++;          // laufenden Abgleich des alten Vaults verwerfen
    syncing = false;
    notes.clear();
    handles.clear();
    await clearNotes();
  }
  showSearch();
  sync();
}

function showSearch() {
  show(el.viewSearch);
  el.q.value = '';
  search();
  setStatus(countLabel());
  el.q.focus();
}

async function allowAccess() {
  if (await hasPermission(vault, true)) {
    el.btnPermission.hidden = true;
    sync();
  }
}

/* ---------- Abgleich im Hintergrund ---------- */
// Liest alle .md-Dateien; nur neue/geänderte (Größe oder Änderungsdatum) werden neu eingelesen.

async function listFiles(dir, prefix, out) {
  const subdirs = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (!HIDDEN_DIRS.has(name)) subdirs.push(listFiles(handle, path, out));
    } else if (name.toLowerCase().endsWith('.md')) {
      out.push({ path, name, handle });
    }
  }
  await Promise.all(subdirs);
  return out;
}

async function sync() {
  if (!vault || syncing) return;
  if (!(await hasPermission(vault))) {
    el.btnPermission.hidden = false;
    setStatus(`${countLabel()} · Zugriff nötig für Aktualisierung`);
    return;
  }
  const run = ++syncRun;
  syncing = true;
  const first = notes.size === 0;
  setStatus(notes.size ? `${countLabel()} · aktualisiere …` : 'Lese Dateiliste …');

  try {
    const found = await listFiles(vault, '', []);
    if (run !== syncRun) return;

    const seen = new Set();
    let pending = [];
    let changed = 0;
    let done = 0;
    let next = 0;

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      await writeNotes(batch);
      if (el.q.value.trim()) search();
    };

    const worker = async () => {
      while (next < found.length && run === syncRun) {
        const f = found[next++];
        seen.add(f.path);
        handles.set(f.path, f.handle);
        const file = await f.handle.getFile();
        const old = notes.get(f.path);
        if (!old || old.size !== file.size || old.mtime !== file.lastModified) {
          const n = { path: f.path, name: f.name, size: file.size, mtime: file.lastModified, text: await file.text() };
          remember(n);
          pending.push(n);
          changed++;
          if (pending.length >= 200) await flush();
        }
        done++;
        if (first && done % 100 === 0) setStatus(`Indexiere ${done} / ${found.length} …`);
      }
    };
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
    if (run !== syncRun) return;
    await flush();

    const gone = [...notes.keys()].filter((p) => !seen.has(p));
    for (const p of gone) { notes.delete(p); handles.delete(p); }
    if (gone.length) await writeNotes([], gone);
    if (gone.length || changed) search();

    setStatus(countLabel());
  } catch (err) {
    if (run !== syncRun) return;
    if (err.name === 'NotAllowedError') {
      el.btnPermission.hidden = false;
      setStatus(`${countLabel()} · Zugriff nötig für Aktualisierung`);
    } else {
      setStatus(`${countLabel()} · Fehler beim Aktualisieren: ${err.message}`);
    }
  } finally {
    if (run === syncRun) syncing = false;
  }
}

/* ---------- Suche ---------- */
// Alle Suchwörter müssen (als Teilstring, ohne Groß-/Kleinschreibung) im Namen oder Inhalt vorkommen.

function search() {
  const terms = el.q.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) { el.hits.replaceChildren(); return; }

  const results = [];
  for (const n of notes.values()) {
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
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = syncing && !notes.size ? 'Index wird aufgebaut …' : 'Keine Treffer.';
    items.push(li);
  } else if (results.length > MAX_HITS) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = `… und ${results.length - MAX_HITS} weitere. Suche genauer eingrenzen.`;
    items.push(li);
  }
  el.hits.replaceChildren(...items);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Text mit <mark> für Treffer, ohne innerHTML.
function highlighted(text, re) {
  const frag = document.createDocumentFragment();
  let last = 0;
  re.lastIndex = 0;
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    frag.append(mark);
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
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
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hit';

  const name = document.createElement('div');
  name.className = 'name';
  name.append(highlighted(n.name.replace(/\.md$/i, ''), re));
  btn.append(name);

  if (n.path !== n.name) {
    const dir = document.createElement('div');
    dir.className = 'dir';
    dir.textContent = n.path.slice(0, -n.name.length - 1);
    btn.append(dir);
  }

  const snip = snippet(n, terms);
  if (snip) {
    const s = document.createElement('div');
    s.className = 'snip';
    s.append(highlighted(snip, re));
    btn.append(s);
  }

  btn.addEventListener('click', () => openNote(n.path));
  li.append(btn);
  return li;
}

/* ---------- Notiz ---------- */

async function resolveHandle(path) {
  if (handles.has(path)) return handles.get(path);
  const parts = path.split('/');
  let dir = vault;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  const h = await dir.getFileHandle(parts.at(-1));
  handles.set(path, h);
  return h;
}

async function openNote(path) {
  try {
    if (!(await hasPermission(vault, true))) return toast('Zugriff auf den Vault wurde nicht erlaubt.', 4000);
    const wasBlocked = !el.btnPermission.hidden;
    el.btnPermission.hidden = true;
    const handle = await resolveHandle(path);
    const file = await handle.getFile();
    const text = await file.text();
    const name = path.split('/').at(-1);

    const cached = notes.get(path);
    if (!cached || cached.text !== text) {
      const n = { path, name, size: file.size, mtime: file.lastModified, text };
      remember(n);
      writeNotes([n]);
    }

    current = { path, name, handle, original: text };
    el.noteTitle.textContent = name.replace(/\.md$/i, '');
    el.notePath.textContent = path;
    el.editor.value = text;
    el.btnSave.disabled = true;
    show(el.viewEditor);
    window.scrollTo(0, 0);
    history.pushState({ note: path }, '');
    if (wasBlocked) sync();
  } catch (err) {
    if (err.name === 'NotFoundError') {
      notes.delete(path);
      handles.delete(path);
      writeNotes([], [path]);
      search();
      toast('Datei existiert nicht mehr.', 3000);
    } else {
      toast('Konnte Datei nicht öffnen: ' + err.message, 4000);
    }
  }
}

function closeEditor() {
  current = null;
  show(el.viewSearch);
}

async function save() {
  if (!current) return;
  el.btnSave.disabled = true;
  try {
    if (!(await hasPermission(current.handle, true))) throw new Error('Kein Schreibzugriff');
    const text = el.editor.value;
    const writable = await current.handle.createWritable();
    await writable.write(text);
    await writable.close();
    current.original = text;
    const file = await current.handle.getFile();
    const n = { path: current.path, name: current.name, size: file.size, mtime: file.lastModified, text };
    remember(n);
    await writeNotes([n]);
    search();
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

/* ---------- Init ---------- */

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  if (!('showDirectoryPicker' in window)) {
    el.unsupported.hidden = false;
    if (!window.isSecureContext) {
      el.unsupported.querySelector('p').textContent += ' Außerdem muss die Seite über HTTPS geladen werden.';
    }
    show(el.viewStart);
    return;
  }

  el.btnOpen.addEventListener('click', pickVault);
  el.btnSwitch.addEventListener('click', pickVault);
  el.btnPermission.addEventListener('click', allowAccess);
  el.btnBack.addEventListener('click', back);
  el.btnSave.addEventListener('click', save);
  el.editor.addEventListener('input', () => { el.btnSave.disabled = !isDirty(); });

  let searchTimer;
  el.q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 80);
  });
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = el.hits.querySelector('.hit');
      if (first) first.click();
    }
  });

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

  try {
    vault = await loadHandle();
    if (vault) (await loadNotes()).forEach(remember);
  } catch { /* IndexedDB nicht verfügbar */ }

  if (!vault) {
    el.actions.hidden = false;
    show(el.viewStart);
    return;
  }

  showSearch();
  sync();
}

init();
