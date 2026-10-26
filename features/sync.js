// Feature „Settings“: Name für den Export, KI-Key, ähnliche Fragen (Test mit Ollama), Darstellung, Stand des Abgleichs,
// manueller (vollständiger) Abgleich, Diagnose des Obsidian-Plugin-Logs.
import { h } from './dom.js';
import { THEMES, getTheme, setTheme } from './theme.js';
import { exportName, setExportName } from './export.js';
import { apiKey, setApiKey, chat, modelFor, setModel, DEFAULT_MODELS, listModels } from './llm.js';
import { PROMPTS_PATH, parsePrompts } from './prompts.js';
import {
  FILE as EMBED_FILE, DEFAULT_URL, DEFAULT_MODEL, embedUrl, embedModel, setEmbedUrl, setEmbedModel, parseStore,
  updateStore, similarPairs,
} from './similar.js';

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

function nameInput() {
  return h('input', {
    type: 'text', class: 'filter settings-name', value: exportName(), placeholder: 'Vor- und Nachname',
    autocomplete: 'name', 'aria-label': 'Name für den Export', oninput: (e) => setExportName(e.target.value),
  });
}

let modelList, promptsInfo;

function aiRow() {
  const input = h('input', {
    type: 'password', class: 'filter settings-name', value: apiKey(), placeholder: 'Tinfoil-API-Key', autocomplete: 'off',
    spellcheck: 'false', 'aria-label': 'Tinfoil-API-Key', oninput: (e) => setApiKey(e.target.value),
  });
  const test = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    if (!apiKey()) return ui.toast('Erst einen Key eintragen.');
    test.disabled = true;
    try {
      const models = [...new Set(Object.keys(DEFAULT_MODELS).map(modelFor))];
      for (const model of models) await chat({ user: 'Antworte nur mit: OK', model, maxTokens: 5, timeout: 30000 });
      ui.toast(`Verbunden ✓ Enclave geprüft (${models.join(', ')})`, 4000);
      loadModels();
    } catch (err) {
      ui.toast('Fehlgeschlagen: ' + (err.message || err.name), 6000);
    } finally {
      test.disabled = false;
    }
  } }, 'Testen');
  return h('div', { class: 'settings-key' }, input, test);
}

function modelRow(purpose, label) {
  return h('label', { class: 'settings-model' },
    h('span', { class: 'kv-label' }, label),
    h('input', {
      type: 'text', class: 'filter', list: 'ai-models', value: modelFor(purpose), placeholder: DEFAULT_MODELS[purpose],
      autocomplete: 'off', spellcheck: 'false', onchange: (e) => { setModel(purpose, e.target.value); e.target.value = modelFor(purpose); },
    }));
}

/* ---------- Ähnliche Fragen (Test) ---------- */

const MIN_SCORES = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
let simBox, simRunning = false;
let simMin = 0.85;
let simPairs = null; // Ergebnis der letzten Berechnung (alle ≥ 0,7)

function similarSection() {
  const field = (label, value, def, onchange) => h('label', { class: 'settings-model' },
    h('span', { class: 'kv-label' }, label),
    h('input', { type: 'text', class: 'filter', value, placeholder: def, autocomplete: 'off', spellcheck: 'false', onchange }));
  simBox = h('div', { class: 'sim-result' });
  const btn = h('button', { type: 'button', class: 'btn', onclick: () => runSimilar(btn) }, 'Berechnen & vergleichen');
  return [
    field('Ollama-Server', embedUrl(), DEFAULT_URL, (e) => { setEmbedUrl(e.target.value); e.target.value = embedUrl(); }),
    field('Embedding-Modell', embedModel(), DEFAULT_MODEL, (e) => { setEmbedModel(e.target.value); e.target.value = embedModel(); }),
    h('div', { class: 'btn-row' }, btn),
    h('p', { class: 'hint left' },
      'Test am Computer: berechnet für jede Frage (Dateiname) einen Vektor über den lokalen Ollama-Server, speichert ' +
      `sie in .picker/${EMBED_FILE} (danach nur Neues und Geändertes) und zeigt die ähnlichsten Fragenpaare. ` +
      'Einrichtung: siehe README, Abschnitt „Ähnliche Fragen“.'),
    simBox,
  ];
}

async function runSimilar(btn) {
  if (simRunning) return;
  if (!(await core.hasPermission(true))) return ui.toast('Zugriff auf den Vault wurde nicht erlaubt.', 4000);
  simRunning = true;
  btn.disabled = true;
  const status = h('p', { class: 'hint left' }, 'Lade gespeicherte Vektoren …');
  simBox.replaceChildren(status);
  const model = embedModel();
  try {
    const store = parseStore(await core.readAppFile(EMBED_FILE), model);
    const save = (st) => core.writeAppFile(EMBED_FILE, JSON.stringify(st));
    const t0 = Date.now();
    const { computed, total } = await updateStore(store, core.list(), {
      url: embedUrl(), model, save,
      onProgress: (done, all) => { status.textContent = all ? `Berechne Vektoren … ${done} / ${all}` : 'Alle Vektoren aktuell.'; },
    });
    status.textContent = `${total} Fragen, ${computed} neu berechnet (${((Date.now() - t0) / 1000).toFixed(1)} s). Vergleiche …`;
    simPairs = await similarPairs(store, {
      min: MIN_SCORES.at(-1), limit: 500,
      onProgress: (done, all) => { status.textContent = `Vergleiche … ${Math.round((done / all) * 100)} %`; },
    });
    status.textContent = `${total} Fragen, ${computed} neu berechnet (${model}).`;
    renderPairs(status);
  } catch (err) {
    simBox.replaceChildren(h('div', { class: 'notice err' }, h('strong', {}, 'Fehlgeschlagen'), h('p', {}, err.message)));
  } finally {
    simRunning = false;
    btn.disabled = false;
  }
}

function renderPairs(status) {
  const where = (path) => {
    const n = core.get(path);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'oberster Ordner';
    return n && n.date != null ? `${dir} · ${new Date(n.date).toLocaleDateString('de-DE', { timeZone: 'UTC' })}` : dir;
  };
  const title = (path) => (core.get(path)?.title ?? path) + '?';
  const shown = simPairs.filter((p) => p.score >= simMin);
  const select = h('select', { class: 'filter sim-min', onchange: (e) => { simMin = +e.target.value; renderPairs(status); } },
    ...MIN_SCORES.map((m) => h('option', { value: m, selected: m === simMin }, `ab ${m.toFixed(2).replace('.', ',')}`)));
  simBox.replaceChildren(status,
    h('div', { class: 'sim-head' }, h('span', {}, `${shown.length} Paare`), select),
    shown.length
      ? h('ul', { class: 'sim-list' }, ...shown.map((p) => h('li', { class: 'sim-pair' },
        h('span', { class: 'sim-score' }, p.score.toFixed(2).replace('.', ',')),
        h('div', { class: 'sim-qs' }, ...[p.a, p.b].map((path) =>
          h('button', { type: 'button', class: 'sim-q', onclick: () => ui.openNote(path) },
            h('span', {}, title(path)), h('small', {}, where(path))))))))
      : h('p', { class: 'hint left' }, 'Keine Paare ab dieser Ähnlichkeit – Schwelle senken.'));
}

/** Verfügbare Modelle als Vorschläge für die Modell-Felder (einmal pro Sitzung, nur mit Key und online). */
let modelsLoaded = false;
function loadModels() {
  if (modelsLoaded || !apiKey() || !navigator.onLine) return;
  modelsLoaded = true;
  listModels().then((ids) => modelList.replaceChildren(...ids.map((id) => h('option', { value: id }))),
    () => { modelsLoaded = false; });
}

function renderPromptsInfo() {
  const file = core.list().find((n) => n.path.toLowerCase() === PROMPTS_PATH.toLowerCase());
  const names = file ? parsePrompts(file.text).map((p) => p.name).join(', ') : '';
  promptsInfo.replaceChildren(h('p', { class: 'hint left' }, !file
    ? `Keine ${PROMPTS_PATH} im Vault – nur eigene Prompts. Abkürzungen: siehe README.`
    : `${PROMPTS_PATH}: ${names || 'keine ##-Überschriften gefunden'}`));
}

async function run(full) {
  if (!(await core.hasPermission(true))) return ui.toast('Zugriff auf den Vault wurde nicht erlaubt.', 4000);
  await core.sync({ full });
  renderInfo();
  renderLog();
}

export default {
  id: 'sync',
  title: 'Settings',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    info = h('div', { class: 'kv' });
    modelList = h('datalist', { id: 'ai-models' });
    promptsInfo = h('div', {});
    logEl = h('div', {});
    btnSync = h('button', { type: 'button', class: 'btn', onclick: () => run(false) }, 'Jetzt abgleichen');
    btnFull = h('button', { type: 'button', class: 'btn', onclick: () => run(true) }, 'Komplett abgleichen');
    root.append(
      h('header', { class: 'bar' }, h('h1', {}, 'Settings')),
      h('h2', { class: 'section' }, 'Name'),
      nameInput(),
      h('p', { class: 'hint left' }, 'Steht beim Export einer VL (Study → VL → PDF) unter dem Titel.'),
      h('h2', { class: 'section' }, 'KI'),
      aiRow(),
      h('p', { class: 'hint left' },
        'Für alle KI-Funktionen: Korrektur und Prompts auf markierten Text am Computer, KI-Aktionen an einer Frage ' +
        '(Punkt lang drücken bzw. Rechtsklick) auch am Handy. Läuft über Tinfoil: verschlüsselt, die Enclave wird vor jeder Sitzung ' +
        'geprüft. Der Key bleibt in diesem Browser. Key unter tinfoil.sh anlegen.'),
      modelRow('correct', 'Modell Korrektur'),
      modelRow('prompt', 'Modell Prompts'),
      modelList,
      h('p', { class: 'hint left' },
        'Korrektur: Doppelklick auf ein Wort (schnelles Modell ohne Thinking). Prompts: Text markieren, Prompt oder ' +
        'Abkürzung eintippen (Strg/Cmd+K), Enter. Leeres Feld = Standard.'),
      promptsInfo,
      h('h2', { class: 'section' }, 'Ähnliche Fragen (Test)'),
      ...similarSection(),
      h('h2', { class: 'section' }, 'Darstellung'),
      themeRow(),
      h('p', { class: 'hint left' }, 'Solarized hell/dunkel. „Automatisch“ folgt der Einstellung des Handys.'),
      h('h2', { class: 'section' }, 'Abgleich'),
      info,
      h('div', { class: 'btn-row' }, btnSync, btnFull),
      h('p', { class: 'hint left' },
        'Normalerweise werden nur Dateien geprüft, die das Obsidian-Plugin als geändert gemeldet hat. ' +
        'Vollständig wird abgeglichen beim ersten Mal, ohne Plugin-Log, wenn das Log nicht weit genug zurückreicht ' +
        'und spätestens alle 3 Tage.'),
      h('h2', { class: 'section' }, 'Plugin-Log'),
      logEl,
    );
    core.on('status', () => { if (!root.hidden) renderInfo(); });
  },

  show() {
    renderInfo();
    renderPromptsInfo();
    loadModels();
    renderLog();
  },
};
