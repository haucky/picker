'use strict';

const HIDDEN_DIRS = new Set(['.obsidian', '.trash', '.git']);
const DB_NAME = 'vault-picker';
const STORE = 'handles';
const KEY = 'vault';

const $ = (id) => document.getElementById(id);
const el = {
  vaultName: $('vault-name'),
  unsupported: $('unsupported'),
  actions: $('actions'),
  btnOpen: $('btn-open'),
  btnPermission: $('btn-permission'),
  hint: $('hint'),
  browser: $('browser'),
  btnRescan: $('btn-rescan'),
  btnOther: $('btn-other'),
  search: $('search'),
  count: $('count'),
  tree: $('tree'),
  results: $('results'),
  viewList: $('view-list'),
  viewEditor: $('view-editor'),
  btnBack: $('btn-back'),
  btnSave: $('btn-save'),
  noteTitle: $('note-title'),
  notePath: $('note-path'),
  editor: $('editor'),
  toast: $('toast'),
};

let vault = null;     // FileSystemDirectoryHandle
let files = [];       // [{ path, name, handle }]
let current = null;   // { path, name, handle, original }

/* ---------- IndexedDB ---------- */

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const loadHandle = () => idb('readonly', (s) => s.get(KEY));
const saveHandle = (h) => idb('readwrite', (s) => s.put(h, KEY));

/* ---------- UI helpers ---------- */

let toastTimer;
function toast(msg, ms = 2500) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function showStart(hint, needsPermission = false) {
  el.actions.hidden = false;
  el.browser.hidden = true;
  el.btnRescan.hidden = true;
  el.btnPermission.hidden = !needsPermission;
  el.btnOpen.textContent = needsPermission ? 'Anderen Vault wählen' : 'Vault öffnen';
  el.btnOpen.classList.toggle('primary', !needsPermission);
  el.hint.textContent = hint || '';
}

function isDirty() {
  return current !== null && el.editor.value !== current.original;
}

/* ---------- Vault ---------- */

async function pickVault() {
  try {
    const handle = await window.showDirectoryPicker({ id: 'vault', mode: 'readwrite' });
    await saveHandle(handle);
    await openVault(handle);
  } catch (err) {
    if (err.name !== 'AbortError') toast('Fehler: ' + err.message, 4000);
  }
}

async function requestAccess() {
  const handle = await loadHandle();
  if (!handle) return showStart('Kein gespeicherter Vault gefunden.');
  try {
    const state = await handle.requestPermission({ mode: 'readwrite' });
    if (state === 'granted') await openVault(handle);
    else showStart('Zugriff wurde nicht erlaubt.', true);
  } catch (err) {
    // Handle ungültig (Ordner gelöscht/verschoben) → neu wählen lassen.
    showStart('Gespeicherter Ordner nicht mehr erreichbar: ' + err.message);
  }
}

async function openVault(handle) {
  vault = handle;
  el.vaultName.textContent = handle.name;
  el.actions.hidden = true;
  el.browser.hidden = false;
  el.btnRescan.hidden = false;
  await scan();
}

async function scan() {
  el.count.textContent = 'Lese Dateien …';
  el.tree.replaceChildren();
  files = [];
  try {
    const root = await walk(vault, '');
    el.tree.replaceChildren(...renderChildren(root));
    el.count.textContent = `${files.length} Notiz${files.length === 1 ? '' : 'en'}`;
    filter();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showStart(`Zugriff auf „${vault.name}“ muss neu erlaubt werden.`, true);
    } else {
      el.count.textContent = 'Fehler beim Lesen: ' + err.message;
    }
  }
}

// Liefert { dirs: [{name, path, node}], files: [{name, path, handle}] }, nur Ordner mit .md-Inhalt.
async function walk(dir, prefix) {
  const node = { dirs: [], files: [] };
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (HIDDEN_DIRS.has(name)) continue;
      const child = await walk(handle, path);
      if (child.dirs.length || child.files.length) node.dirs.push({ name, path, node: child });
    } else if (name.toLowerCase().endsWith('.md')) {
      const file = { name, path, handle };
      node.files.push(file);
      files.push(file);
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });
  node.dirs.sort(byName);
  node.files.sort(byName);
  return node;
}

function renderChildren(node) {
  const out = [];
  for (const d of node.dirs) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = d.name;
    const children = document.createElement('div');
    children.className = 'children';
    children.append(...renderChildren(d.node));
    details.append(summary, children);
    out.push(details);
  }
  for (const f of node.files) out.push(fileButton(f, false));
  return out;
}

function fileButton(file, showPath) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'file';
  const label = document.createElement('span');
  label.textContent = file.name.replace(/\.md$/i, '');
  if (showPath && file.path !== file.name) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = file.path.slice(0, -file.name.length - 1);
    label.append(sub);
  }
  btn.append(label);
  btn.addEventListener('click', () => openNote(file));
  return btn;
}

/* ---------- Suche ---------- */

function filter() {
  const q = el.search.value.trim().toLowerCase();
  el.tree.hidden = !!q;
  el.results.hidden = !q;
  if (!q) return;
  const hits = files.filter((f) => f.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  el.results.replaceChildren(...hits.map((f) => fileButton(f, true)));
  if (!hits.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Keine Treffer.';
    el.results.append(p);
  }
}

/* ---------- Editor ---------- */

async function openNote(file) {
  try {
    const text = await (await file.handle.getFile()).text();
    current = { ...file, original: text };
    el.noteTitle.textContent = file.name.replace(/\.md$/i, '');
    el.notePath.textContent = file.path;
    el.editor.value = text;
    el.btnSave.disabled = true;
    el.viewList.hidden = true;
    el.viewEditor.hidden = false;
    window.scrollTo(0, 0);
    history.pushState({ note: file.path }, '');
  } catch (err) {
    toast('Konnte Datei nicht lesen: ' + err.message, 4000);
  }
}

function closeEditor() {
  current = null;
  el.viewEditor.hidden = true;
  el.viewList.hidden = false;
}

async function save() {
  if (!current) return;
  el.btnSave.disabled = true;
  try {
    if ((await current.handle.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
        (await current.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Kein Schreibzugriff');
    }
    const text = el.editor.value;
    const writable = await current.handle.createWritable();
    await writable.write(text);
    await writable.close();
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

/* ---------- Init ---------- */

async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }

  if (!('showDirectoryPicker' in window)) {
    el.unsupported.hidden = false;
    if (!window.isSecureContext) {
      el.unsupported.querySelector('p').textContent +=
        ' Außerdem muss die Seite über HTTPS geladen werden.';
    }
    return;
  }

  el.btnOpen.addEventListener('click', pickVault);
  el.btnOther.addEventListener('click', pickVault);
  el.btnPermission.addEventListener('click', requestAccess);
  el.btnRescan.addEventListener('click', scan);
  el.search.addEventListener('input', filter);
  el.btnBack.addEventListener('click', back);
  el.btnSave.addEventListener('click', save);
  el.editor.addEventListener('input', () => { el.btnSave.disabled = !isDirty(); });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && current) { e.preventDefault(); save(); }
  });
  // Android-Zurück-Taste / Geste schließt den Editor.
  window.addEventListener('popstate', () => {
    if (!current) return;
    if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen?')) {
      history.pushState({ note: current.path }, '');
      return;
    }
    closeEditor();
  });
  window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });

  let handle = null;
  try { handle = await loadHandle(); } catch { /* IndexedDB nicht verfügbar */ }
  if (!handle) return showStart('Wähle den Ordner deines Obsidian-Vaults.');

  el.vaultName.textContent = handle.name;
  const state = await handle.queryPermission({ mode: 'readwrite' });
  if (state === 'granted') await openVault(handle);
  else showStart(`Zuletzt geöffnet: „${handle.name}“. Tippe, um den Zugriff erneut zu erlauben.`, true);
}

init();
