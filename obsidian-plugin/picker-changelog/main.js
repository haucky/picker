// Picker Changelog: schreibt jede Änderung an .md-Dateien als JSON-Zeile nach .picker/changes.log.
// Die Vault-Picker-PWA liest dieses Log und prüft beim Start nur die dort genannten Dateien.
// Läuft nur auf Mobilgeräten (dort liest die PWA den Vault); auf dem Desktop tut das Plugin nichts.
'use strict';

const { Plugin, Platform } = require('obsidian');

const DIR = '.picker';
const LOG = '.picker/changes.log';
const FLUSH_MS = 5000;                       // gesammelt schreiben (Obsidian speichert beim Tippen alle ~2 s)
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;    // Einträge älter als 30 Tage entfernen

module.exports = class PickerChangelog extends Plugin {
  onload() {
    if (!Platform.isMobile) return;
    this.queue = new Map(); // path -> neuester Eintrag

    // Erst nach dem Start registrieren: Beim Laden des Vaults löst Obsidian für jede Datei 'create' aus.
    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.prune();
      } catch (err) {
        console.error('[picker-changelog] prune', err);
      }
      this.queue.set('', { t: Date.now(), op: 'start' });

      this.registerEvent(this.app.vault.on('create', (f) => this.record('create', f.path)));
      this.registerEvent(this.app.vault.on('modify', (f) => this.record('modify', f.path)));
      this.registerEvent(this.app.vault.on('delete', (f) => this.record('delete', f.path)));
      this.registerEvent(this.app.vault.on('rename', (f, oldPath) => this.record('rename', f.path, oldPath)));

      this.registerInterval(window.setInterval(() => this.flush(), FLUSH_MS));
      // Beim Wechsel in den Hintergrund sofort schreiben, Android beendet Apps dort gern.
      this.registerDomEvent(document, 'visibilitychange', () => { if (document.hidden) this.flush(); });
      this.flush();
    });
  }

  onunload() {
    if (this.queue) this.flush();
  }

  record(op, path, oldPath) {
    const isNote = (p) => p && p.toLowerCase().endsWith('.md') && !p.startsWith(DIR + '/');
    if (!isNote(path) && !isNote(oldPath)) return;
    const entry = { t: Date.now(), op, path };
    if (oldPath) entry.oldPath = oldPath;
    this.queue.set(path, entry);
  }

  /** Schreibt die gesammelten Einträge; Aufrufe werden nacheinander ausgeführt, damit nichts verloren geht. */
  flush() {
    this.writing = (this.writing || Promise.resolve()).then(() => this.writeQueue());
    return this.writing;
  }

  async writeQueue() {
    if (!this.queue.size) return;
    const entries = [...this.queue.values()];
    this.queue.clear();
    try {
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(DIR))) await adapter.mkdir(DIR);
      if (await adapter.exists(LOG)) await adapter.append(LOG, lines);
      else await adapter.write(LOG, lines);
    } catch (err) {
      console.error('[picker-changelog] flush', err);
      // beim nächsten Mal erneut versuchen (neuere Einträge desselben Pfads haben Vorrang)
      for (const e of entries) {
        const key = e.op === 'start' ? '' : e.path;
        if (!this.queue.has(key)) this.queue.set(key, e);
      }
    }
  }

  async prune() {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(LOG))) return;
    const cutoff = Date.now() - KEEP_MS;
    const lines = (await adapter.read(LOG)).split('\n').filter((l) => {
      try { return JSON.parse(l).t >= cutoff; } catch { return false; }
    });
    await adapter.write(LOG, lines.length ? lines.join('\n') + '\n' : '');
  }
};
