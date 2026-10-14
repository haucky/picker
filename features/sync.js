// Feature: Stand des Abgleichs, manueller (vollständiger) Abgleich, Diagnose des Obsidian-Plugin-Logs.
import { h } from './dom.js';
import { THEMES, getTheme, setTheme } from './theme.js';

const SHOW_ENTRIES = 30;
const OPS = { create: 'neu', modify: 'geändert', delete: 'gelöscht', rename: 'umbenannt', start: 'Obsidian gestartet' };

let ui, core, root, info, logEl, btnSync, btnFull;

const fmt = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' }) : '–');

function ago(t) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return `vor ${Math.round(s / 86400)} Tagen`;
}

function row(label, value) {
  return h('div', { class: 'kv-row' }, h('span', { class: 'kv-label' }, label), h('span', {}, value));
}

function renderInfo() {
  const m = core.syncMeta || {};
  const mode = m.mode === 'log' ? 'über Plugin-Log' : m.mode === 'full' ? 'vollständig' : '–';
  info.replaceChildren(
    row('Notizen', String(core.notes.size)),
    row('Status', core.statusText || '–'),
    row('Letzter Abgleich', m.lastSync ? `${fmt(m.lastSync)} (${ago(m.lastSync)})` : '–'),
    row('Art', m.lastSync ? `${mode} · ${m.changed ?? 0} Datei(en) aktualisiert · ${((m.duration || 0) / 1000).toFixed(1)} s` : '–'),
    row('Letzter vollständiger', m.lastFull ? `${fmt(m.lastFull)} (${ago(m.lastFull)})` : '–'),
  );
  btnSync.disabled = btnFull.disabled = core.syncing;
}

async function renderLog() {
  logEl.replaceChildren(h('p', { class: 'hint left' }, 'Lese Log …'));
  let log;
  try {
    if (!(await core.hasPermission())) {
      logEl.replaceChildren(h('p', { class: 'hint left' }, 'Zugriff auf den Vault nötig.'));
      return;
    }
    log = await core.readChangeLog();
  } catch (err) {
    logEl.replaceChildren(h('p', { class: 'hint left' }, 'Fehler: ' + err.message));
    return;
  }
  if (!log) {
    logEl.replaceChildren(h('div', { class: 'notice' },
      h('strong', {}, 'Kein Plugin-Log gefunden.'),
      h('p', {}, 'Ohne das Obsidian-Plugin „Picker Changelog“ prüft die App bei jedem Start alle Dateien. ' +
        'Installation: siehe README, Abschnitt „Obsidian-Plugin“.')));
    return;
  }
  const starts = log.filter((e) => e.op === 'start');
  const recent = log.slice(-SHOW_ENTRIES).reverse();
  logEl.replaceChildren(
    h('div', { class: 'kv' },
      row('Einträge', String(log.length)),
      row('Ältester', fmt(log[0]?.t)),
      row('Neuester', log.length ? `${fmt(log.at(-1).t)} (${ago(log.at(-1).t)})` : '–'),
      row('Obsidian zuletzt gestartet', starts.length ? fmt(starts.at(-1).t) : '–')),
    h('ol', { class: 'log' }, ...recent.map((e) => h('li', {},
      h('span', { class: 'log-time' }, fmt(e.t)),
      h('span', { class: 'log-op' }, OPS[e.op] || e.op),
      e.path ? h('span', { class: 'log-path' }, e.oldPath ? `${e.oldPath} → ${e.path}` : e.path) : null))),
  );
}

function themeRow() {
  const row = h('div', { class: 'picks theme-picks' });
  const render = () => row.replaceChildren(...Object.entries(THEMES).map(([k, label]) =>
    h('button', { type: 'button', class: 'chip' + (getTheme() === k ? ' on' : ''), onclick: () => { setTheme(k); render(); } }, label)));
  render();
  return row;
}

async function run(full) {
  if (!(await core.hasPermission(true))) return ui.toast('Zugriff auf den Vault wurde nicht erlaubt.', 4000);
  await core.sync({ full });
  renderInfo();
  renderLog();
}

export default {
  id: 'sync',
  title: 'Sync',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    info = h('div', { class: 'kv' });
    logEl = h('div', {});
    btnSync = h('button', { type: 'button', class: 'btn', onclick: () => run(false) }, 'Jetzt abgleichen');
    btnFull = h('button', { type: 'button', class: 'btn', onclick: () => run(true) }, 'Komplett abgleichen');
    root.append(
      h('header', { class: 'bar' }, h('h1', {}, 'Abgleich')),
      info,
      h('div', { class: 'btn-row' }, btnSync, btnFull),
      h('p', { class: 'hint left' },
        'Normalerweise werden nur Dateien geprüft, die das Obsidian-Plugin als geändert gemeldet hat. ' +
        'Vollständig wird abgeglichen beim ersten Mal, ohne Plugin-Log, wenn das Log nicht weit genug zurückreicht ' +
        'und spätestens alle 3 Tage.'),
      h('h2', { class: 'section' }, 'Plugin-Log'),
      logEl,
      h('h2', { class: 'section' }, 'Darstellung'),
      themeRow(),
      h('p', { class: 'hint left' }, 'Solarized hell/dunkel. „Automatisch“ folgt der Einstellung des Handys.'),
    );
    core.on('status', () => { if (!root.hidden) renderInfo(); });
  },

  show() {
    renderInfo();
    renderLog();
  },
};
