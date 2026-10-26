// Diary → Schreiben: neue Einträge (TILs) im selben Fragen-Editor wie eine VL (qeditor.js): „Frage?“ + Inhalt,
// mehrere auf einmal. Neue Einträge bekommen #life/diary und #date/… von heute; eine Zeile „TT.MM.JJJJ“ legt die
// folgenden an diesem Tag an. Optional ein festes Intervall (Chips oder #review/… hinter der Frage), dann auch
// #reviewed/… mit dem Tag des Eintrags. Gibt es eine Frage schon, kann sie als Antwort an den vorhandenen Eintrag
// gehängt werden (conflicts.js; vermerkt als „noch einmal gefragt“). Sonst wird nur angelegt; kein Review-Status.
import { parseTags } from '../core.js';
import { h } from './dom.js';
import { createQuestionEditor, createIssues, questionLines } from './qeditor.js';
import { createConflicts } from './conflicts.js';
import { parseDoc, planSave, applyMerge, titleProblem } from './studydoc.js';
import {
  today, dayToTagDate, dayToGerman, fixedInterval, setFixedInterval, reviewedDay, setReviewed, sameInterval,
  formatFixed, intervalTag,
} from './srs.js';

export const DIARY_TAG = 'life/diary';
const DRAFT_KEY = 'diary-write-draft';
const IV_KEY = 'diary-write-interval';
const RES_KEY = 'diary-write-conflicts';
const CHOICES = [null, ...[[1, 'd'], [1, 'w'], [1, 'm'], [2, 'm'], [3, 'm'], [1, 'y']].map(([n, unit]) => ({ n, unit }))];

let ui, core, root;
let cm, issues, saveBtn, countEl, infoEl, chipsEl, conflicts;
let interval = null; // Intervall für alle neuen Einträge (null = keins)
let busy = false;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* egal */ }
}

const baseTags = (day) => [DIARY_TAG, 'date/' + dayToTagDate(day)];

/* ---------- Anzeige ---------- */

function renderInfo() {
  infoEl.textContent = `#${baseTags(today()).join(' #')} · oberster Ordner – eine Zeile „TT.MM.JJJJ“ ` +
    'legt die folgenden an diesem Tag an, weitere Tags hinter die Frage';
}

function renderChips() {
  chipsEl.replaceChildren(h('span', { class: 'dw-label' }, 'Wiederholen:'), ...CHOICES.map((iv) => h('button', {
    type: 'button', class: 'chip' + ((iv ? sameInterval(iv, interval) : !interval) ? ' on' : ''),
    title: iv ? '#review/' + intervalTag(iv) : 'kein festes Intervall',
    onclick: () => { interval = iv; store(IV_KEY, iv ? intervalTag(iv) : null); renderChips(); },
  }, iv ? formatFixed(iv) : 'nein')));
}

function update() {
  const parsed = parseDoc(cm.value);
  issues.show({ ...parsed, errors: [...parsed.errors, ...conflicts.issues(parsed.items)] });
  countEl.textContent = parsed.items.length ? plural(parsed.items.length, 'Eintrag', 'Einträge') : '';
  saveBtn.disabled = busy || !parsed.items.length;
}

let raf = 0;
function storeDraft() {
  store(DRAFT_KEY, cm.value.trim() ? cm.value : null);
  store(RES_KEY, conflicts.resolutions.size ? JSON.stringify(conflicts.toJSON()) : null);
}

function onInput() {
  storeDraft();
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); });
}

/* ---------- Speichern ---------- */

/** Festes Intervall: gewähltes Intervall, falls die Frage kein eigenes #review/… hat; dazu #reviewed/ = Tag des Eintrags. */
function withInterval(text, day) {
  let iv = fixedInterval(parseTags(text));
  if (!iv && interval) { text = setFixedInterval(text, interval); iv = interval; }
  if (iv && reviewedDay(parseTags(text)) == null) text = setReviewed(text, day);
  return text;
}

/** Dokument nur noch mit den Einträgen `titles` (z. B. die nicht angelegten), samt Datumszeilen. */
function keepOnly(text, titles, day) {
  const out = [];
  let lastDay = day;
  for (const it of parseDoc(text).items) {
    if (!titles.has(it.title)) continue;
    const d = it.day ?? day;
    if (d !== lastDay) { out.push(dayToGerman(d), ''); lastDay = d; }
    out.push(it.title + '?' + it.tags.map((t) => ' #' + t).join('') + (it.body ? '\n' + it.body : ''), '');
  }
  return out.join('\n').trimEnd() + (out.length ? '\n' : '');
}

async function save() {
  if (busy) return;
  const text = cm.value;
  const day = today();
  const exists = (path) => {
    const p = path.toLowerCase();
    for (const k of core.notes.keys()) if (k.toLowerCase() === p) return true;
    return false;
  };
  const plan = planSave(text, [], {
    folder: '', base: baseTags(day), day, exists, existsHint: '', order: false,
    existing: conflicts.existing, resolutions: conflicts.resolutions,
  });
  if (plan.errors.length) {
    update();
    ui.toast(plan.errors[0].msg + (plan.errors.length > 1 ? ` (+${plan.errors.length - 1})` : ''), 4000);
    return;
  }
  const { creates, merges } = plan;
  if (!creates.length && !merges.length) return;
  busy = true;
  saveBtn.disabled = true;
  const fail = [];
  try {
    const failed = new Set();
    let stop = false;
    for (const c of creates) {
      try {
        if (stop) throw new Error('nicht versucht');
        await core.create(c.path, withInterval(c.text, c.day ?? day));
      } catch (err) {
        failed.add(c.title);
        fail.push(`${c.title}: ${err.message}`);
        if (err.name === 'NotAllowedError') stop = true; // kein Zugriff: Rest gar nicht erst versuchen
      }
    }
    // als Antwort an vorhandene Einträge hängen
    for (const m of merges) {
      try {
        if (stop) throw new Error('nicht versucht');
        await core.update(m.path, (cur) => applyMerge(cur, m));
      } catch (err) {
        failed.add(m.title);
        fail.push(`${m.title}: ${err.message}`);
        if (err.name === 'NotAllowedError') stop = true;
      }
    }
    const created = creates.length - creates.filter((c) => failed.has(c.title)).length;
    const appended = merges.length - merges.filter((m) => failed.has(m.title)).length;
    const summary = [created && plural(created, 'neuer Eintrag', 'neue Einträge'), appended && `${appended} als Antwort angehängt`]
      .filter(Boolean).join(', ');
    if (failed.size) {
      cm.set(keepOnly(text, failed, day)); // was nicht gespeichert wurde, bleibt im Editor
      alert(`Nicht alles wurde gespeichert${summary ? ` (${summary})` : ''}:\n\n` + fail.join('\n'));
    } else {
      cm.set('');
      conflicts.clear();
      ui.toast(`Gespeichert ✓ ${summary}`);
    }
    storeDraft();
  } finally {
    busy = false;
    update();
  }
}

/** Frage im Text umformulieren (Menü am „!“). */
function renameQuestion(oldTitle, next) {
  const problem = titleProblem(next);
  if (problem) { ui.toast(problem, 4000); return false; }
  const lines = cm.value.split('\n');
  const qs = questionLines(lines);
  if (qs.some((q) => q.title === next)) { ui.toast('Diese Frage steht schon im Text', 4000); return false; }
  const hit = qs.find((q) => q.title === oldTitle);
  if (!hit) return true;
  const from = lines.slice(0, hit.line).reduce((n, l) => n + l.length + 1, 0);
  cm.view.dispatch({ changes: { from, to: from + oldTitle.length, insert: next } });
  return true;
}

/* ---------- Modul ---------- */

export default {
  id: 'write',
  title: 'Schreiben',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    const saved = load(IV_KEY);
    interval = saved ? fixedInterval(['review/' + saved]) : null;

    countEl = h('span', { class: 'count' });
    saveBtn = h('button', { type: 'button', class: 'btn small', onclick: save, disabled: true }, 'Speichern');
    infoEl = h('p', { class: 'path' });
    chipsEl = h('div', { class: 'dw-chips' });
    const host = h('div', { class: 'md-editor', 'aria-label': 'Neue Diary-Einträge' });
    issues = createIssues((line) => cm.jumpToLine(line));
    conflicts = createConflicts({
      ui, mode: 'diary',
      rename: renameQuestion,
      onChange: () => { if (cm) { update(); storeDraft(); } },
    });
    try { conflicts.load(JSON.parse(load(RES_KEY) || '[]')); } catch { /* egal */ }
    root.classList.add('diary-write');
    root.append(
      h('div', { class: 'dw-head' }, h('h2', { class: 'section' }, 'Neue Einträge'), countEl, saveBtn),
      infoEl, chipsEl, issues.errors, issues.warnings, host);
    renderInfo();
    renderChips();
    cm = createQuestionEditor(ui, {
      parent: host,
      doc: load(DRAFT_KEY) || '',
      placeholder: 'Was war heute?\n- …\n\nNoch eine Frage? #diary/…\n- …\n\nTT.MM.JJJJ (folgende an diesem Tag)',
      onChange: onInput,
      folder: '',
      conflicts,
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !root.hidden && root.offsetParent) { e.preventDefault(); save(); }
    });
    update();
  },

  show() {
    renderInfo(); // Datum kann sich seit dem letzten Öffnen geändert haben
    update();
  },
};
