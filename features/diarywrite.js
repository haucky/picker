// Diary → Schreiben: neue Einträge (TILs) im selben Fragen-Editor wie eine VL (qeditor.js): „Frage?“ + Inhalt,
// mehrere auf einmal. Neue Einträge bekommen #life/diary und #date/… von heute; eine Zeile „TT.MM.JJJJ“ legt die
// folgenden an diesem Tag an. Optional ein festes Intervall (Chips oder #review/… hinter der Frage), dann auch
// #reviewed/… mit dem Tag des Eintrags. Hier wird nur angelegt, nichts geändert oder gelöscht; kein Review-Status.
import { parseTags } from '../core.js';
import { h } from './dom.js';
import { createQuestionEditor, createIssues } from './qeditor.js';
import { parseDoc, planSave } from './studydoc.js';
import {
  today, dayToTagDate, dayToGerman, fixedInterval, setFixedInterval, reviewedDay, setReviewed, sameInterval,
  formatFixed, intervalTag,
} from './srs.js';

export const DIARY_TAG = 'life/diary';
const DRAFT_KEY = 'diary-write-draft';
const IV_KEY = 'diary-write-interval';
const CHOICES = [null, ...[[1, 'd'], [1, 'w'], [1, 'm'], [2, 'm'], [3, 'm'], [1, 'y']].map(([n, unit]) => ({ n, unit }))];

let ui, core, root;
let cm, issues, saveBtn, countEl, infoEl, chipsEl;
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
  issues.show(parsed);
  countEl.textContent = parsed.items.length ? plural(parsed.items.length, 'Eintrag', 'Einträge') : '';
  saveBtn.disabled = busy || !parsed.items.length;
}

let raf = 0;
function onInput() {
  store(DRAFT_KEY, cm.value.trim() ? cm.value : null);
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
  const plan = planSave(text, [], { folder: '', base: baseTags(day), day, exists, existsHint: '', order: false });
  if (plan.errors.length) {
    update();
    ui.toast(plan.errors[0].msg + (plan.errors.length > 1 ? ` (+${plan.errors.length - 1})` : ''), 4000);
    return;
  }
  if (!plan.creates.length) return;
  busy = true;
  saveBtn.disabled = true;
  const fail = [];
  try {
    for (const c of plan.creates) {
      try {
        await core.create(c.path, withInterval(c.text, c.day ?? day));
      } catch (err) {
        fail.push(`${c.title}: ${err.message}`);
        if (err.name === 'NotAllowedError') break; // kein Zugriff: Rest gar nicht erst versuchen
      }
    }
    const failed = new Set(plan.creates.filter((c) => !core.get(c.path)).map((c) => c.title));
    const ok = plan.creates.length - failed.size;
    if (failed.size) {
      cm.set(keepOnly(text, failed, day)); // nicht angelegte bleiben im Editor
      alert(`${plural(ok, 'Eintrag', 'Einträge')} angelegt, nicht angelegt:\n\n` + (fail.join('\n') || [...failed].join('\n')));
    } else {
      cm.set('');
      ui.toast(`Gespeichert ✓ ${plural(ok, 'neuer Eintrag', 'neue Einträge')}`);
    }
  } finally {
    busy = false;
    update();
  }
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
