// Core: Vault-Zugriff, Zwischenspeicher, Abgleich und CRUD für Notizen.
// Feature-Module greifen nur über dieses Modul auf Dateien zu.

const HIDDEN_DIRS = new Set(['.obsidian', '.trash', '.git']);
const READ_CONCURRENCY = 16;
const TAG_RE = /(?:^|[\s(,])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu;
const DATE_TAG_RE = /^date\/(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?$/;

/* ---------- Parsing ---------- */

/** Alle Tags einer Notiz ohne führendes '#', in Originalschreibweise, ohne Duplikate. */
export function parseTags(text) {
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[1].replace(/\/+$/, '');
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) { seen.add(key); out.push(tag); }
  }
  return out;
}

/** Datum aus #date/YYYY/MM/DD (Zeitstempel in ms) oder null. */
export function parseDate(tags) {
  for (const t of tags) {
    const m = t.match(DATE_TAG_RE);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1));
  }
  return null;
}

/** Ist die Zeile eine Tag-Zeile (beginnt mit #wort, nicht mit einer Überschrift "# Titel")? */
export function isTagLine(line) {
  return /^\s*#[^\s#]/.test(line);
}

/** Hängt Tags (ohne '#') an die Tag-Zeile in Zeile 1 an bzw. setzt eine neue Tag-Zeile davor. */
export function addTagsToText(text, tags) {
  const present = new Set(parseTags(text).map((t) => t.toLowerCase()));
  const add = tags.filter((t) => !present.has(t.toLowerCase()));
  if (!add.length) return text;
  const str = add.map((t) => '#' + t).join(' ');
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const nl = body.includes('\r\n') ? '\r\n' : '\n';
  const end = body.indexOf('\n');
  const first = end < 0 ? body : body.slice(0, end).replace(/\r$/, '');
  if (isTagLine(first)) {
    const rest = end < 0 ? '' : body.slice(end - (body[end - 1] === '\r' ? 1 : 0));
    return bom + first.trimEnd() + ' ' + str + rest;
  }
  return bom + str + nl + body;
}

function makeNote({ path, size, mtime, text }) {
  const name = path.split('/').at(-1);
  const tags = parseTags(text);
  return {
    path, name, size, mtime, text, tags,
    title: name.replace(/\.md$/i, ''),
    tagsLower: tags.map((t) => t.toLowerCase()),
    date: parseDate(tags),
    lower: text.toLowerCase(),
    nameLower: name.replace(/\.md$/i, '').toLowerCase(),
  };
}

/* ---------- IndexedDB ---------- */

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('vault-picker', 3);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'path' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
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

const persist = (puts, dels = []) => tx('notes', 'readwrite', (s) => {
  for (const n of puts) s.put({ path: n.path, size: n.size, mtime: n.mtime, text: n.text });
  for (const p of dels) s.delete(p);
});

/* ---------- Core ---------- */

const listeners = { change: new Set(), status: new Set() };
const handles = new Map(); // path -> FileSystemFileHandle
let syncRun = 0;

export const core = {
  /** @type {FileSystemDirectoryHandle|null} */
  vault: null,
  /** path -> Notiz (siehe makeNote) */
  notes: new Map(),
  syncing: false,
  needsPermission: false,
  statusText: '',

  supported: 'showDirectoryPicker' in window,

  on(event, fn) { listeners[event].add(fn); return () => listeners[event].delete(fn); },
  emit(event, data) { for (const fn of listeners[event]) fn(data); },

  setStatus(text) {
    this.statusText = text;
    this.emit('status', { text, needsPermission: this.needsPermission, syncing: this.syncing });
  },
  countLabel() {
    const n = this.notes.size;
    return `${n} Notiz${n === 1 ? '' : 'en'}`;
  },

  /** Einfacher Key-Value-Speicher für Feature-Module (z. B. Sitzungsdaten). */
  kv: {
    get: (key) => tx('kv', 'readonly', (s) => s.get(key)),
    set: (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key)),
    del: (key) => tx('kv', 'readwrite', (s) => s.delete(key)),
  },

  /** Lädt gespeicherten Vault + Zwischenspeicher. Gibt true zurück, wenn ein Vault bekannt ist. */
  async init() {
    try {
      this.vault = (await tx('handles', 'readonly', (s) => s.get('vault'))) || null;
      if (this.vault) for (const n of await tx('notes', 'readonly', (s) => s.getAll())) this.notes.set(n.path, makeNote(n));
    } catch { /* IndexedDB nicht verfügbar */ }
    return !!this.vault;
  },

  /** Ordner-Dialog. Gibt false zurück, wenn abgebrochen. */
  async pickVault() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'vault', mode: 'readwrite' });
    } catch (err) {
      if (err.name === 'AbortError') return false;
      throw err;
    }
    const same = this.vault && (await this.vault.isSameEntry(handle));
    this.vault = handle;
    await tx('handles', 'readwrite', (s) => s.put(handle, 'vault'));
    if (!same) {
      syncRun++;               // laufenden Abgleich des alten Vaults verwerfen
      this.syncing = false;
      this.notes.clear();
      handles.clear();
      await tx('notes', 'readwrite', (s) => s.clear());
      this.emit('change', { reset: true });
    }
    this.sync();
    return true;
  },

  async hasPermission(request = false) {
    if (!this.vault) return false;
    const opts = { mode: 'readwrite' };
    let ok = (await this.vault.queryPermission(opts)) === 'granted';
    if (!ok && request) ok = (await this.vault.requestPermission(opts)) === 'granted';
    if (ok && this.needsPermission) {
      this.needsPermission = false;
      this.sync();
    }
    return ok;
  },

  /** Abgleich im Hintergrund: liest nur neue/geänderte Dateien, entfernt gelöschte. */
  async sync() {
    if (!this.vault || this.syncing) return;
    if ((await this.vault.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      this.needsPermission = true;
      this.setStatus(`${this.countLabel()} · Zugriff nötig für Aktualisierung`);
      return;
    }
    if (this.syncing) return;
    this.needsPermission = false;
    const run = ++syncRun;
    this.syncing = true;
    const first = this.notes.size === 0;
    this.setStatus(first ? 'Lese Dateiliste …' : `${this.countLabel()} · aktualisiere …`);

    try {
      const found = await listFiles(this.vault, '', []);
      if (run !== syncRun) return;
      const seen = new Set();
      let pending = [];
      const changed = [];
      let done = 0;
      let next = 0;

      const flush = async () => {
        if (!pending.length) return;
        const batch = pending;
        pending = [];
        await persist(batch);
        this.emit('change', { paths: batch.map((n) => n.path) });
      };
      const worker = async () => {
        while (next < found.length && run === syncRun) {
          const f = found[next++];
          seen.add(f.path);
          handles.set(f.path, f.handle);
          const file = await f.handle.getFile();
          const old = this.notes.get(f.path);
          if (!old || old.size !== file.size || old.mtime !== file.lastModified) {
            const n = makeNote({ path: f.path, size: file.size, mtime: file.lastModified, text: await file.text() });
            this.notes.set(n.path, n);
            pending.push(n);
            changed.push(n.path);
            if (pending.length >= 200) await flush();
          }
          if (first && ++done % 100 === 0) this.setStatus(`Indexiere ${done} / ${found.length} …`);
        }
      };
      await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
      if (run !== syncRun) return;
      await flush();

      const gone = [...this.notes.keys()].filter((p) => !seen.has(p));
      for (const p of gone) { this.notes.delete(p); handles.delete(p); }
      if (gone.length) {
        await persist([], gone);
        this.emit('change', { paths: gone, removed: true });
      }
      this.syncing = false;
      this.setStatus(this.countLabel());
    } catch (err) {
      if (run !== syncRun) return;
      this.syncing = false;
      if (err.name === 'NotAllowedError') {
        this.needsPermission = true;
        this.setStatus(`${this.countLabel()} · Zugriff nötig für Aktualisierung`);
      } else {
        this.setStatus(`${this.countLabel()} · Fehler beim Aktualisieren: ${err.message}`);
      }
    }
  },

  /* ----- CRUD ----- */

  get(path) {
    return this.notes.get(path);
  },

  list() {
    return [...this.notes.values()];
  },

  /** Liest die Datei frisch von der Platte und aktualisiert den Zwischenspeicher. */
  async read(path) {
    await this.requireAccess();
    const handle = await this.handle(path);
    const file = await handle.getFile();
    const text = await file.text();
    this.remember(path, file, text);
    return text;
  },

  async create(path, text) {
    await this.requireAccess();
    const parts = path.split('/');
    let dir = this.vault;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    try {
      await dir.getFileHandle(parts.at(-1));
      throw new Error(`„${path}“ existiert bereits`);
    } catch (err) {
      if (err.name !== 'NotFoundError') throw err;
    }
    const handle = await dir.getFileHandle(parts.at(-1), { create: true });
    handles.set(path, handle);
    await write(handle, text);
    this.remember(path, await handle.getFile(), text);
  },

  /**
   * Aktualisiert eine Notiz. `change` ist der neue Text oder eine Funktion (aktueller Text) => neuer Text;
   * die Funktion bekommt immer den frischen Stand von der Platte.
   * Gibt { changedExternally } zurück: true, wenn die Datei seit dem letzten Einlesen verändert wurde.
   */
  async update(path, change) {
    await this.requireAccess();
    const handle = await this.handle(path);
    const file = await handle.getFile();
    const old = this.notes.get(path);
    const changedExternally = !!old && (old.size !== file.size || old.mtime !== file.lastModified);
    const current = await file.text();
    const text = typeof change === 'function' ? change(current) : change;
    if (text !== current) await write(handle, text);
    this.remember(path, await handle.getFile(), text);
    return { changedExternally };
  },

  async remove(path) {
    await this.requireAccess();
    const parts = path.split('/');
    let dir = this.vault;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    await dir.removeEntry(parts.at(-1));
    this.forget(path);
  },

  /* ----- intern ----- */

  async requireAccess() {
    if (!(await this.hasPermission(true))) {
      const err = new Error('Zugriff auf den Vault wurde nicht erlaubt');
      err.name = 'NotAllowedError';
      throw err;
    }
  },

  async handle(path) {
    if (handles.has(path)) return handles.get(path);
    const parts = path.split('/');
    let dir = this.vault;
    try {
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      const h = await dir.getFileHandle(parts.at(-1));
      handles.set(path, h);
      return h;
    } catch (err) {
      if (err.name === 'NotFoundError') this.forget(path);
      throw err;
    }
  },

  remember(path, file, text) {
    const old = this.notes.get(path);
    if (old && old.text === text && old.mtime === file.lastModified && old.size === file.size) return;
    const n = makeNote({ path, size: file.size, mtime: file.lastModified, text });
    this.notes.set(path, n);
    persist([n]);
    this.emit('change', { paths: [path] });
  },

  forget(path) {
    if (!this.notes.delete(path)) return;
    handles.delete(path);
    persist([], [path]);
    this.emit('change', { paths: [path], removed: true });
  },
};

async function write(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

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
