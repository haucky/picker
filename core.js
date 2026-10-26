// Core: Vault-Zugriff, Zwischenspeicher, Abgleich und CRUD für Notizen.
// Feature-Module greifen nur über dieses Modul auf Dateien zu.

const HIDDEN_DIRS = new Set(['.obsidian', '.trash', '.git', '.picker']);
const READ_CONCURRENCY = 16;
const CHANGE_LOG_DIR = '.picker';
const CHANGE_LOG_FILE = 'changes.log';
const LOG_OVERLAP = 60 * 1000;                     // Plugin schreibt gebündelt; Einträge können etwas später ankommen
const FULL_SYNC_EVERY = 3 * 24 * 60 * 60 * 1000;   // spätestens alle 3 Tage vollständig abgleichen
const SYNC_META_KEY = 'syncMeta';
const TAG_RE = /(?:^|[\s(,])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu;
const DATE_TAG_RE = /^date\/(\d{4})[/-](\d{1,2})(?:[/-](\d{1,2}))?$/;

/* ---------- Parsing ---------- */

/** .md-Datei außerhalb ausgeblendeter Ordner? */
export function isNotePath(path) {
  return path.toLowerCase().endsWith('.md') && !path.split('/').slice(0, -1).some((d) => HIDDEN_DIRS.has(d));
}

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

/**
 * Teilt Text in YAML-Frontmatter und Rest: { bom, front, body }. `front` enthält beide '---'-Zeilen
 * samt Zeilenumbruch und ist '' ohne Frontmatter. bom + front + body === text.
 */
export function splitFrontmatter(text) {
  const bom = text.startsWith('\ufeff') ? '\ufeff' : '';
  const rest = bom ? text.slice(1) : text;
  const m = rest.match(/^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/);
  return m ? { bom, front: m[0], body: rest.slice(m[0].length) } : { bom, front: '', body: rest };
}

/** Einfache `schlüssel: wert`-Paare der obersten Ebene aus der Frontmatter (Werte als Text). */
export function parseFrontmatter(text) {
  const { front } = splitFrontmatter(text);
  const out = {};
  for (const line of front.split(/\r?\n/).slice(1, -2)) {
    const m = line.match(/^([\w-]+):[ \t]*(.*?)[ \t]*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * Setzt Felder der obersten Ebene in der Frontmatter (`null` entfernt ein Feld). Legt die Frontmatter
 * bei Bedarf an und entfernt sie wieder, wenn sie dadurch leer wird. Der Rest der Datei bleibt unverändert.
 */
export function setFrontmatterFields(text, fields) {
  const { bom, front, body } = splitFrontmatter(text);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = front ? front.replace(/\r?\n$/, '').split(/\r?\n/).slice(1, -1) : [];
  for (const [key, value] of Object.entries(fields)) {
    const i = lines.findIndex((l) => l.startsWith(key + ':'));
    if (value == null) { if (i >= 0) lines.splice(i, 1); continue; }
    const line = `${key}: ${value}`;
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  if (!lines.length) return bom + body;
  return bom + ['---', ...lines, '---'].join(nl) + nl + body;
}

/** Hängt Tags (ohne '#') an die Tag-Zeile an (erste Zeile nach einer evtl. Frontmatter) bzw. setzt eine neue Tag-Zeile davor. */
export function addTagsToText(text, tags) {
  const present = new Set(parseTags(text).map((t) => t.toLowerCase()));
  const add = tags.filter((t) => !present.has(t.toLowerCase()));
  if (!add.length) return text;
  const str = add.map((t) => '#' + t).join(' ');
  const { bom: fmBom, front, body } = splitFrontmatter(text);
  const bom = fmBom + front;
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
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
const attachments = { index: null, at: 0, loading: null }; // Dateiname (klein) -> [Pfade], für Bilder
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
      if (this.vault) {
        for (const n of await tx('notes', 'readonly', (s) => s.getAll())) this.notes.set(n.path, makeNote(n));
        this.syncMeta = (await this.kv.get(SYNC_META_KEY)) || null;
      }
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
      attachments.index = null;
      await tx('notes', 'readwrite', (s) => s.clear());
      this.syncMeta = null;
      await this.kv.del(SYNC_META_KEY);
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

  /** Stand des letzten Abgleichs: { lastSync, lastFull, mode: 'log'|'full', changed, duration } */
  syncMeta: null,

  /**
   * Abgleich im Hintergrund. Normalerweise über das Änderungsprotokoll des Obsidian-Plugins
   * (nur dort genannte Dateien werden geprüft); vollständig, wenn das Log fehlt, nicht weit genug
   * zurückreicht, der letzte vollständige Abgleich zu alt ist oder `full` gesetzt ist.
   */
  async sync({ full = false } = {}) {
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
    const started = Date.now();
    const meta = { ...(this.syncMeta || (await this.kv.get(SYNC_META_KEY).catch(() => null)) || {}) };
    this.setStatus(this.notes.size ? `${this.countLabel()} · aktualisiere …` : 'Lese Dateiliste …');

    try {
      let mode = 'full';
      let changed = 0;
      if (!full && this.notes.size && meta.lastSync && meta.lastFull && started - meta.lastFull < FULL_SYNC_EVERY) {
        const log = await this.readChangeLog().catch(() => null);
        // Das Log muss vor dem letzten Abgleich beginnen, sonst könnten Änderungen fehlen.
        if (log && log.length && log[0].t <= meta.lastSync) {
          mode = 'log';
          changed = await this.applyLog(log, meta.lastSync - LOG_OVERLAP, run);
        }
      }
      if (mode === 'full') changed = await this.fullScan(run);
      if (run !== syncRun) return;

      Object.assign(meta, { lastSync: started, mode, changed, duration: Date.now() - started });
      if (mode === 'full') meta.lastFull = started;
      this.syncMeta = meta;
      await this.kv.set(SYNC_META_KEY, meta).catch(() => {});
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

  /** Vollständiger Abgleich: prüft jede Datei (Größe/Änderungsdatum). Gibt die Zahl geänderter Dateien zurück. */
  async fullScan(run) {
    const first = this.notes.size === 0;
    const found = await listFiles(this.vault, '', []);
    if (run !== syncRun) return 0;
    const seen = new Set();
    let pending = [];
    let changed = 0;
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
          changed++;
          if (pending.length >= 200) await flush();
        }
        if (++done % 100 === 0) {
          this.setStatus(first ? `Indexiere ${done} / ${found.length} …` : `${this.countLabel()} · prüfe ${done} / ${found.length} …`);
        }
      }
    };
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
    if (run !== syncRun) return changed;
    await flush();

    const gone = [...this.notes.keys()].filter((p) => !seen.has(p));
    for (const p of gone) { this.notes.delete(p); handles.delete(p); }
    if (gone.length) {
      await persist([], gone);
      this.emit('change', { paths: gone, removed: true });
    }
    return changed + gone.length;
  },

  /** Prüft nur die Dateien, die seit `since` im Änderungsprotokoll stehen. */
  async applyLog(log, since, run) {
    const touched = new Set();
    for (const e of log) {
      if (e.t < since) continue;
      for (const p of [e.path, e.oldPath]) if (p && isNotePath(p)) touched.add(p);
    }
    let changed = 0;
    for (const path of touched) {
      if (run !== syncRun) break;
      const had = this.notes.has(path);
      try {
        const file = await (await this.handle(path)).getFile();
        const old = this.notes.get(path);
        if (!old || old.size !== file.size || old.mtime !== file.lastModified) {
          this.remember(path, file, await file.text());
          changed++;
        }
      } catch (err) {
        if (err.name !== 'NotFoundError' && err.name !== 'TypeMismatchError') throw err;
        this.forget(path);
        if (had) changed++;
      }
    }
    return changed;
  },

  /** Einträge aus .picker/changes.log (vom Obsidian-Plugin), aufsteigend nach Zeit. null, wenn es kein Log gibt. */
  async readChangeLog() {
    let text;
    try {
      const dir = await this.vault.getDirectoryHandle(CHANGE_LOG_DIR);
      text = await (await (await dir.getFileHandle(CHANGE_LOG_FILE)).getFile()).text();
    } catch (err) {
      if (err.name === 'NotFoundError') return null;
      throw err;
    }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (typeof e.t === 'number') out.push(e);
      } catch { /* unvollständige Zeile, z. B. während Obsidian gerade schreibt */ }
    }
    return out.sort((a, b) => a.t - b.t);
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

  /** Verschiebt eine Notiz in den Papierkorb von Obsidian (.trash/ im Vault); Namenskonflikte dort bekommen „ 1“, „ 2“ … */
  async trash(path) {
    await this.requireAccess();
    const text = await (await (await this.handle(path)).getFile()).text();
    const dir = await this.vault.getDirectoryHandle('.trash', { create: true });
    const name = path.split('/').at(-1);
    const base = name.replace(/\.md$/i, '');
    let target = name;
    for (let i = 1; ; i++) {
      try {
        await dir.getFileHandle(target);
        target = `${base} ${i}.md`;
      } catch (err) {
        if (err.name !== 'NotFoundError') throw err;
        break;
      }
    }
    await write(await dir.getFileHandle(target, { create: true }), text);
    await this.remove(path);
  },

  /* ----- Anhänge (z. B. Bilder) ----- */

  /**
   * Löst einen Link auf einen Anhang auf wie Obsidian: Pfad relativ zur Notiz, ab Vault-Wurzel,
   * sonst irgendwo im Vault per Dateiname (kürzester Pfad). Gibt den Pfad oder null zurück.
   */
  async resolveAttachment(link, fromPath) {
    const clean = link.split(/[#|]/)[0].trim().replace(/^\/+/, '');
    if (!clean) return null;
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
    const tries = [];
    if (dir) tries.push(normalizePath(dir + '/' + clean));
    tries.push(normalizePath(clean));
    for (const p of tries) {
      if (!p) continue;
      try { await this.fileHandle(p); return p; } catch { /* weiter */ }
    }
    const name = clean.split('/').at(-1).toLowerCase();
    const find = () => [...(attachments.index?.get(name) || [])].sort((a, b) => a.length - b.length)[0] || null;
    if (!attachments.index || (!find() && Date.now() - attachments.at > 60 * 1000)) {
      attachments.loading ??= listFiles(this.vault, '', [], true).then((files) => {
        const index = new Map();
        for (const f of files) {
          const k = f.name.toLowerCase();
          if (!index.has(k)) index.set(k, []);
          index.get(k).push(f.path);
          if (!f.path.toLowerCase().endsWith('.md')) handles.set(f.path, f.handle);
        }
        attachments.index = index;
        attachments.at = Date.now();
      }).finally(() => { attachments.loading = null; });
      await attachments.loading;
    }
    return find();
  },

  /** Object-URL für eine Datei im Vault (z. B. Bild). Mit URL.revokeObjectURL wieder freigeben. */
  /** Legt eine Datei (z. B. ein eingefügtes Bild) an; Ordner werden erzeugt. Fehler, wenn es sie schon gibt. */
  async createFile(path, blob) {
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
    await write(handle, blob);
    handles.set(path, handle);
    const k = parts.at(-1).toLowerCase();
    if (attachments.index) attachments.index.set(k, [...(attachments.index.get(k) || []), path]);
  },

  /** App-Datei in .picker/ (z. B. Embeddings) als Text lesen; null, wenn es sie nicht gibt. */
  async readAppFile(name) {
    try {
      const dir = await this.vault.getDirectoryHandle(CHANGE_LOG_DIR);
      return await (await (await dir.getFileHandle(name)).getFile()).text();
    } catch (err) {
      if (err.name === 'NotFoundError') return null;
      throw err;
    }
  },

  /** App-Datei in .picker/ schreiben (Ordner und Datei werden bei Bedarf angelegt). */
  async writeAppFile(name, text) {
    await this.requireAccess();
    const dir = await this.vault.getDirectoryHandle(CHANGE_LOG_DIR, { create: true });
    await write(await dir.getFileHandle(name, { create: true }), text);
  },

  /** Gibt es die Datei (beliebiger Typ)? */
  async exists(path) {
    try { await this.fileHandle(path); return true; } catch { return false; }
  },

  async fileUrl(path) {
    const file = await (await this.fileHandle(path)).getFile();
    return URL.createObjectURL(file);
  },

  /* ----- intern ----- */

  /** Handle für beliebige Dateien (nicht nur Notizen), ohne den Notiz-Zwischenspeicher anzufassen. */
  async fileHandle(path) {
    if (handles.has(path)) return handles.get(path);
    const parts = path.split('/');
    let dir = this.vault;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    const h = await dir.getFileHandle(parts.at(-1));
    handles.set(path, h);
    return h;
  },

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

/** Löst './' und '../' auf; null, wenn der Pfad aus dem Vault herausführt. */
function normalizePath(path) {
  const out = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!out.length) return null; out.pop(); } else out.push(p);
  }
  return out.join('/') || null;
}

async function write(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

async function listFiles(dir, prefix, out, all = false) {
  const subdirs = [];
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (!HIDDEN_DIRS.has(name)) subdirs.push(listFiles(handle, path, out, all));
    } else if (all || name.toLowerCase().endsWith('.md')) {
      out.push({ path, name, handle });
    }
  }
  await Promise.all(subdirs);
  return out;
}
