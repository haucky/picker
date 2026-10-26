// Feature „Settings“: Name für den Export, KI (lokal/Tinfoil), ähnliche Fragen, Darstellung, Stand des Abgleichs,
// manueller (vollständiger) Abgleich, Diagnose des Obsidian-Plugin-Logs.
import { h } from './dom.js';
import { THEMES, getTheme, setTheme } from './theme.js';
import { exportName, setExportName } from './export.js';
import {
  apiKey, setApiKey, chat, listModels, listLocalModels, TIERS, TIER_LABEL, DEFAULT_LOCAL_URL, DEFAULT_LOCAL,
  DEFAULT_TINFOIL, localOn, setLocalOn, localUrl, setLocalUrl, localModel, setLocalModel, tinfoilOn, setTinfoilOn,
  tinfoilModel, setTinfoilModel, unloadLocal,
} from './llm.js';
import { PROMPTS_PATH, parsePrompts } from './prompts.js';
import { contextOf } from './studydoc.js';
import {
  FILE as EMBED_FILE, DEFAULT_MODEL, embedModel, setEmbedModel, parseStore, updateStore, similarPairs, sameQuestion,
  judgedSame, seedJudged, judgedJSON, resetVectors, RELATED_MINS, relatedMin, setRelatedMin,
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

let localModels, tinfoilModels, promptsInfo;

const textField = (label, value, placeholder, onchange, attrs = {}) => h('label', { class: 'settings-model' },
  h('span', { class: 'kv-label' }, label),
  h('input', { type: 'text', class: 'filter', value, placeholder, autocomplete: 'off', spellcheck: 'false', onchange, ...attrs }));

const toggle = (label, on, onchange) => h('label', { class: 'settings-toggle' },
  h('input', { type: 'checkbox', checked: on, onchange: (e) => onchange(e.target.checked) }), h('span', {}, label));

/** KI lokal: an/aus, Server, Modelle je Stufe, Testen. */
function localAI() {
  const test = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    test.disabled = true;
    try {
      const have = await listLocalModels({ signal: AbortSignal.timeout(5000) });
      localModels.replaceChildren(...have.map((id) => h('option', { value: id })));
      const missing = TIERS.map(localModel).filter((m) => !have.some((x) => x === m || x === m + ':latest'));
      if (missing.length) throw new Error(`Modell fehlt – im Terminal: ${missing.map((m) => 'ollama pull ' + m).join(' && ')}`);
      if (!localOn()) { setLocalOn(true); onBox.checked = true; }
      for (const tier of TIERS) await chat({ user: 'Antworte nur mit: OK', tier, via: 'local', maxTokens: 5, timeout: 120000 });
      ui.toast(`Lokal verbunden ✓ (${TIERS.map(localModel).join(', ')})`, 4000);
    } catch (err) {
      ui.toast('Fehlgeschlagen: ' + (err.name === 'TimeoutError' || err.name === 'TypeError'
        ? `Server unter ${localUrl()} nicht erreichbar (läuft Ollama, ist OLLAMA_ORIGINS gesetzt?)` : err.message), 7000);
    } finally {
      test.disabled = false;
    }
  } }, 'Testen');
  const box = toggle('Lokales Modell (Ollama) verwenden', localOn(), (on) => setLocalOn(on));
  const onBox = box.querySelector('input');
  return [
    h('div', { class: 'settings-key' }, box, test),
    textField('Server', localUrl(), DEFAULT_LOCAL_URL, (e) => { setLocalUrl(e.target.value); e.target.value = localUrl(); }),
    ...TIERS.map((tier) => textField('Modell ' + TIER_LABEL[tier], localModel(tier), DEFAULT_LOCAL[tier],
      (e) => { setLocalModel(tier, e.target.value); e.target.value = localModel(tier); }, { list: 'ai-local-models' })),
  ];
}

/** KI über Tinfoil: an/aus (auch mit Key erst nach Einschalten), Key, Modelle je Stufe, Testen. */
function tinfoilAI() {
  const input = h('input', {
    type: 'password', class: 'filter settings-name', value: apiKey(), placeholder: 'Tinfoil-API-Key', autocomplete: 'off',
    spellcheck: 'false', 'aria-label': 'Tinfoil-API-Key', oninput: (e) => setApiKey(e.target.value),
  });
  const test = h('button', { type: 'button', class: 'btn small', onclick: async () => {
    if (!apiKey()) return ui.toast('Erst einen Key eintragen.');
    test.disabled = true;
    try {
      const models = [...new Set(TIERS.map(tinfoilModel))];
      for (const model of models) await chat({ user: 'Antworte nur mit: OK', model, via: 'tinfoil', maxTokens: 5, timeout: 30000 });
      ui.toast(`Verbunden ✓ Enclave geprüft (${models.join(', ')})`, 4000);
      loadModels();
    } catch (err) {
      ui.toast('Fehlgeschlagen: ' + (err.message || err.name), 6000);
    } finally {
      test.disabled = false;
    }
  } }, 'Testen');
  return [
    toggle('Tinfoil verwenden (wenn lokal aus oder nicht erreichbar)', tinfoilOn(), (on) => setTinfoilOn(on)),
    h('div', { class: 'settings-key' }, input, test),
    ...TIERS.map((tier) => textField('Modell ' + TIER_LABEL[tier], tinfoilModel(tier), DEFAULT_TINFOIL[tier],
      (e) => { setTinfoilModel(tier, e.target.value); e.target.value = tinfoilModel(tier); }, { list: 'ai-tinfoil-models' })),
  ];
}

/* ---------- Ähnliche Fragen ---------- */

const MIN_SCORES = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7];
let simBox, simRunning = false;
let simMin = 0.85;
let simPairs = null; // Ergebnis der letzten Berechnung (alle ≥ 0,7)
let simStore = null; // dazu der gespeicherte Stand (Vektoren, Entscheidungen des Sprachmodells)
let simAbort = null; // AbortController der laufenden Prüfung

function similarSection() {
  simBox = h('div', { class: 'sim-result' });
  const btn = h('button', { type: 'button', class: 'btn', onclick: () => runSimilar(btn) }, 'Berechnen & vergleichen');
  return [
    textField('Embedding-Modell', embedModel(), DEFAULT_MODEL, (e) => { setEmbedModel(e.target.value); e.target.value = embedModel(); resetVectors(); },
      { list: 'ai-local-models' }),
    h('label', { class: 'settings-model' }, h('span', { class: 'kv-label' }, 'Verwandt ab'),
      h('select', { class: 'filter', onchange: (e) => setRelatedMin(+e.target.value) },
        ...RELATED_MINS.map((m) => h('option', { value: m, selected: m === relatedMin() }, m.toFixed(2).replace('.', ','))))),
    h('div', { class: 'btn-row' }, btn),
    h('p', { class: 'hint left' },
      'Am Computer mit lokalem Server (oben): berechnet für jede Frage (Dateiname) einen Vektor, speichert sie in ' +
      `.picker/${EMBED_FILE} (danach nur Neues und Geändertes) und zeigt die ähnlichsten Fragenpaare. „Mit Sprachmodell ` +
      'prüfen“ lässt das schnelle Modell entscheiden, ob zwei Fragen wirklich dasselbe fragen. „Verwandt ab“: ab welcher ' +
      'Ähnlichkeit gespeicherte Fragen im VL-Editor (↔ N) und auf der Review-Rückseite als verwandt gezeigt werden (geht auch ' +
      'ohne Server, z. B. am Handy). Einrichtung: README, „Ähnliche Fragen“.'),
    simBox,
  ];
}

async function runSimilar(btn) {
  if (simRunning) return;
  if (!localOn()) return ui.toast('Erst oben unter KI den lokalen Server einschalten (Testen).', 4000);
  if (!(await core.hasPermission(true))) return ui.toast('Zugriff auf den Vault wurde nicht erlaubt.', 4000);
  simRunning = true;
  btn.disabled = true;
  const status = h('p', { class: 'hint left' }, 'Lade gespeicherte Vektoren …');
  simBox.replaceChildren(status);
  const model = embedModel();
  try {
    const store = parseStore(await core.readAppFile(EMBED_FILE), model);
    seedJudged(store.judged); // schon geprüfte Paare (auch aus einem abgebrochenen Lauf)
    simStore = store;
    const save = (st) => core.writeAppFile(EMBED_FILE, JSON.stringify(st));
    const t0 = Date.now();
    const { computed, total } = await updateStore(store, core.list(), {
      model, save,
      onProgress: (done, all) => { status.textContent = all ? `Berechne Vektoren … ${done} / ${all}` : 'Alle Vektoren aktuell.'; },
    });
    resetVectors(); // Editor und Review sehen den neuen Stand
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

/**
 * Die angezeigten Paare (ab Schwelle) vom schnellen Sprachmodell prüfen lassen: dieselbe Frage oder nur verwandt.
 * Schonend für den Rechner: vorher die anderen Modelle aus dem Speicher nehmen, eins nach dem anderen mit kleiner
 * Pause, Zwischenstand alle 10 Paare speichern (ein Abbruch verliert nichts), jederzeit abbrechbar.
 */
async function judgePairs(btn, status) {
  if (simAbort) { simAbort.abort(); return; } // zweiter Klick = Abbrechen
  if (simRunning) return;
  simRunning = true;
  simAbort = new AbortController();
  const { signal } = simAbort;
  btn.textContent = 'Abbrechen';
  const title = (path) => core.get(path)?.title ?? '';
  const todo = simPairs.filter((p) => p.score >= simMin && judgedSame(title(p.a), title(p.b)) === undefined);
  const save = () => { if (simStore) { simStore.judged = judgedJSON(); return core.writeAppFile(EMBED_FILE, JSON.stringify(simStore)); } };
  const t0 = Date.now();
  let done = 0;
  try {
    status.textContent = 'Gebe Speicher frei …';
    await unloadLocal(embedModel());
    if (localModel('good') !== localModel('fast')) await unloadLocal(localModel('good'));
    for (const p of todo) {
      if (signal.aborted) break;
      status.textContent = `Prüfe mit Sprachmodell … ${done + 1} / ${todo.length}`;
      await sameQuestion(title(p.a), title(p.b), { signal });
      done++;
      if (done % 10 === 0) await save();
      await new Promise((r) => setTimeout(r, 100)); // dem Rechner Luft lassen
    }
    status.textContent = `${done} von ${todo.length} Paaren geprüft (${((Date.now() - t0) / 1000).toFixed(0)} s)` +
      (done < todo.length ? ' – abgebrochen, Rest beim nächsten Mal.' : '.');
  } catch (err) {
    status.textContent = signal.aborted ? `Abgebrochen nach ${done} Paaren – Rest beim nächsten Mal.` : 'Prüfen fehlgeschlagen: ' + err.message;
  } finally {
    try { await save(); } catch { /* Zwischenstand bleibt im Speicher */ }
    simAbort = null;
    simRunning = false;
    renderPairs(status);
  }
}

function renderPairs(status) {
  const where = (path) => { const n = core.get(path); return n ? contextOf(n) : ''; };
  const title = (path) => (core.get(path)?.title ?? path) + '?';
  const shown = simPairs.filter((p) => p.score >= simMin);
  const verdict = (p) => judgedSame(title(p.a).slice(0, -1), title(p.b).slice(0, -1));
  const same = shown.filter((p) => verdict(p) === true);
  const open = shown.filter((p) => verdict(p) === undefined);
  const related = shown.filter((p) => verdict(p) === false);
  const judge = h('button', { type: 'button', class: 'btn small', onclick: () => judgePairs(judge, status) },
    open.length ? `Mit Sprachmodell prüfen (${open.length})` : 'Alle geprüft');
  judge.disabled = !open.length;
  const list = (pairs) => h('ul', { class: 'sim-list' }, ...pairs.map((p) => h('li', { class: 'sim-pair' },
    h('span', { class: 'sim-score' }, p.score.toFixed(2).replace('.', ',')),
    h('div', { class: 'sim-qs' }, ...[p.a, p.b].map((path) =>
      h('button', { type: 'button', class: 'sim-q', onclick: () => ui.openNote(path) },
        h('span', {}, title(path)), h('small', {}, where(path))))))));
  const select = h('select', { class: 'filter sim-min', onchange: (e) => { simMin = +e.target.value; renderPairs(status); } },
    ...MIN_SCORES.map((m) => h('option', { value: m, selected: m === simMin }, `ab ${m.toFixed(2).replace('.', ',')}`)));
  const section = (label, pairs) => (pairs.length ? [h('h3', { class: 'sim-group' }, `${label} (${pairs.length})`), list(pairs)] : []);
  simBox.replaceChildren(...[status,
    h('div', { class: 'sim-head' }, h('span', {}, `${shown.length} Paare`), select, judge),
    ...(shown.length ? [] : [h('p', { class: 'hint left' }, 'Keine Paare ab dieser Ähnlichkeit – Schwelle senken.')]),
    ...section('Dieselbe Frage', same),
    ...section(same.length || related.length ? 'Noch nicht geprüft' : 'Ähnlich', open),
    ...section('Nur verwandt', related)]);
}

/** Verfügbare Modelle als Vorschläge für die Modell-Felder (einmal pro Sitzung; Tinfoil nur eingeschaltet mit Key). */
let modelsLoaded = false;
function loadModels() {
  if (localOn()) {
    listLocalModels({ signal: AbortSignal.timeout(3000) })
      .then((ids) => localModels.replaceChildren(...ids.map((id) => h('option', { value: id }))), () => {});
  }
  if (modelsLoaded || !tinfoilOn() || !apiKey() || !navigator.onLine) return;
  modelsLoaded = true;
  listModels().then((ids) => tinfoilModels.replaceChildren(...ids.map((id) => h('option', { value: id }))),
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
    localModels = h('datalist', { id: 'ai-local-models' });
    tinfoilModels = h('datalist', { id: 'ai-tinfoil-models' });
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
      h('p', { class: 'hint left' },
        'Für alle KI-Funktionen: Korrektur und Prompts auf markierten Text am Computer, KI-Aktionen an einer Frage ' +
        '(Punkt lang drücken bzw. Rechtsklick) auch am Handy, ähnliche Fragen im Editor. Zuerst wird das lokale Modell ' +
        'gefragt (nichts verlässt den Computer), sonst Tinfoil, wenn eingeschaltet. Ohne beides gibt es einfach keine KI-Funktionen.'),
      h('h3', { class: 'settings-sub' }, 'Lokal (Ollama)'),
      ...localAI(),
      h('p', { class: 'hint left' },
        'Läuft auf dem eigenen Computer (Einrichtung: README, „KI lokal“). Erst einschalten, wenn Ollama läuft – vorher ' +
        'fragt die App den lokalen Server gar nicht an. Schnell: Korrektur (Doppelklick auf ein Wort), Fragen vergleichen. ' +
        'Gut: Prompts (Text markieren, Strg/Cmd+K). Leeres Feld = Standard.'),
      localModels,
      h('h3', { class: 'settings-sub' }, 'Tinfoil (Cloud, verschlüsselt)'),
      ...tinfoilAI(),
      h('p', { class: 'hint left' },
        'Option B, z. B. am Handy oder ohne lokalen Server: verschlüsselt, die Enclave wird vor jeder Sitzung geprüft. ' +
        'Wird nur genutzt, wenn eingeschaltet. Der Key bleibt in diesem Browser; Key unter tinfoil.sh anlegen.'),
      tinfoilModels,
      promptsInfo,
      h('h2', { class: 'section' }, 'Ähnliche Fragen'),
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
