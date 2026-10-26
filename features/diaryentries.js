// Diary → Einträge: die letzten 100 Diary-Einträge (#life/diary mit #date/…) als ein Dokument im selben Fragen-Editor
// wie eine VL – lesen, ändern, ergänzen, löschen und mit einmal speichern. Vor jedem Tag steht eine Datumszeile
// „TT.MM.JJJJ“ (wie in Diary → Schreiben); wer eine Frage unter ein anderes Datum schiebt, ändert ihr #date/….
// Kein Review-Status und keine study-order. Gespeicherte Einträge zeigen verwandte Fragen (↔ N, conflicts.js).
// Einträge, die sich nicht verlustfrei als Dokument darstellen lassen (Inhalt mit Zeilen, die als Frage gelten
// würden, gleicher Name wie ein anderer Eintrag), bleiben draußen und werden darunter aufgeführt.
import { h } from './dom.js';
import { createQuestionEditor, createIssues } from './qeditor.js';
import { createConflicts } from './conflicts.js';
import { parseDoc, planSave, applyMerge, buildDoc, roundtripIssues, baseForDay, dayOfNote } from './studydoc.js';
import { today, dayToGerman, isConfig } from './srs.js';
import { DIARY_TAG } from './diarywrite.js';

const LIMIT = 100;
const DRAFT_KEY = 'diary-entries-draft';

let ui, core, root;
let cm = null, issues, saveBtn, countEl, skippedEl, conflicts;
let ed = null; // { originals: [{ path, title, text }], base (Text beim Laden), skipped: [{ note, why }] }
let busy = false;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isDiary = (n) => n.tagsLower.some((t) => t === DIARY_TAG || t.startsWith(DIARY_TAG + '/'));

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
}
function storeDraft() {
  try {
    if (!isDirty()) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: cm.value, base: ed.base, conflicts: conflicts.toJSON() }));
  } catch { /* egal */ }
}

const isDirty = () => !!ed && !!cm && cm.value !== ed.base;

/** Dokument aus den letzten Einträgen: neueste Tage zuerst, je Tag eine Datumszeile. */
function buildEntries() {
  const notes = core.list().filter((n) => n.date != null && !isConfig(n.path) && isDiary(n))
    .sort((a, b) => b.date - a.date || a.mtime - b.mtime || a.title.localeCompare(b.title, 'de'))
    .slice(0, LIMIT);
  const seen = new Set();
  const byDay = new Map();
  const skipped = [];
  for (const n of notes) {
    const k = n.title.toLowerCase();
    if (seen.has(k)) { skipped.push({ note: n, why: 'gleicher Name wie ein anderer Eintrag' }); continue; }
    seen.add(k);
    const day = dayOfNote(n);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(n);
  }
  const parts = [];
  const originals = [];
  for (const [day, ns] of byDay) {
    const base = baseForDay([DIARY_TAG], day);
    const bad = new Set(roundtripIssues(ns, base));
    const ok = ns.filter((n) => !bad.has(n.title));
    for (const n of ns) if (bad.has(n.title)) skipped.push({ note: n, why: 'Inhalt hat Zeilen, die als Frage oder Datum gelten würden' });
    if (!ok.length) continue;
    parts.push(dayToGerman(day) + '\n\n' + buildDoc(ok, base).trimEnd());
    originals.push(...ok.map((n) => ({ path: n.path, title: n.title, text: n.text })));
  }
  return { text: parts.length ? parts.join('\n\n') + '\n' : '', originals, skipped };
}

/** Neu aus dem Vault laden (Entwurf nur, wenn `restore`). */
function reload({ restore = false } = {}) {
  const { text, originals, skipped } = buildEntries();
  ed = { originals, base: text, skipped };
  const draft = restore ? loadDraft() : null;
  const useDraft = draft && draft.text !== text;
  conflicts.clear();
  if (useDraft) conflicts.load(draft.conflicts);
  cm.set(useDraft ? draft.text : text);
  if (useDraft) {
    ui.toast(draft.base === text ? 'Ungespeicherter Entwurf wiederhergestellt' :
      'Entwurf wiederhergestellt – Einträge wurden inzwischen geändert, bitte prüfen', 5000);
  }
  renderSkipped();
  update();
}

function renderSkipped() {
  const list = ed?.skipped || [];
  skippedEl.hidden = !list.length;
  skippedEl.replaceChildren(...(list.length ? [
    h('strong', {}, `${plural(list.length, 'Eintrag', 'Einträge')} nicht im Editor`),
    h('p', {}, 'Damit beim Speichern nichts aufgeteilt oder überschrieben wird. Antippen öffnet den Eintrag einzeln.'),
    h('ul', {}, ...list.map(({ note, why }) => h('li', {},
      h('button', { type: 'button', class: 'link', onclick: () => ui.openNote(note.path) }, note.title + '?'), ` – ${why}`))),
  ] : []));
}

function update() {
  if (!cm || !ed) return;
  const parsed = parseDoc(cm.value);
  issues.show({ ...parsed, errors: [...parsed.errors, ...conflicts.issues(parsed.items)] });
  countEl.textContent = plural(parsed.items.length, 'Eintrag', 'Einträge');
  saveBtn.disabled = busy || !isDirty();
}

let raf = 0;
function onInput() {
  storeDraft();
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); });
}

/* ---------- Speichern ---------- */

async function save() {
  if (!ed || busy) return;
  const text = cm.value;
  const day = today();
  const exists = (path) => {
    const p = path.toLowerCase();
    for (const k of core.notes.keys()) if (k.toLowerCase() === p) return true;
    return false;
  };
  const plan = planSave(text, ed.originals, {
    folder: '', base: baseForDay([DIARY_TAG], day), day, exists, existsHint: '', order: false,
    existing: conflicts.existing, resolutions: conflicts.resolutions, similarMerge: conflicts.similarMerge,
  });
  if (plan.errors.length) {
    update();
    ui.toast(plan.errors[0].msg + (plan.errors.length > 1 ? ` (+${plan.errors.length - 1})` : ''), 4000);
    return;
  }
  const { updates, creates, moves, deletes, merges } = plan;
  if (!updates.length && !creates.length && !moves.length && !deletes.length && !merges.length) {
    ed.base = text;
    storeDraft();
    update();
    ui.toast('Nichts zu speichern');
    return;
  }
  if (deletes.length && !confirm(
    `${plural(deletes.length, 'Eintrag fehlt', 'Einträge fehlen')} im Dokument und ${deletes.length === 1 ? 'wird' : 'werden'} ` +
    'in den Papierkorb (.trash) verschoben:\n\n' + deletes.map((d) => `• ${d.title}?`).join('\n') + '\n\nSpeichern?')) return;

  busy = true;
  saveBtn.disabled = true;
  try {
    // Wurde etwas außerhalb geändert (Obsidian Sync, anderer Tab)?
    const touched = [...updates, ...deletes].map((c) => ed.originals.find((o) => o.path === c.path)).filter(Boolean);
    const changed = (await Promise.all(touched.map(async (o) => {
      try {
        return (await core.read(o.path)) !== o.text ? o.title : null;
      } catch (err) {
        if (err.name !== 'NotFoundError') throw err;
        return o.title + ' (gelöscht)';
      }
    }))).filter(Boolean);
    if (changed.length && !confirm('Seit dem Öffnen außerhalb geändert:\n\n' + changed.map((t) => `• ${t}`).join('\n') +
      '\n\nTrotzdem mit deinem Stand überschreiben?')) return;

    const done = { updated: 0, created: 0, deleted: 0, merged: 0 };
    const fail = [];
    const run = async (list, fn, key) => {
      for (const c of list) {
        try { await fn(c); done[key]++; } catch (err) { if (err.name !== 'NotFoundError') fail.push(`${c.title}: ${err.message}`); }
      }
    };
    await run(deletes, (d) => core.trash(d.path), 'deleted');
    await run(updates, (u) => core.update(u.path, u.text), 'updated');
    await run(merges, (m) => core.update(m.path, (cur) => applyMerge(cur, m)), 'merged');
    await run(creates, (c) => core.create(c.path, c.text), 'created');
    const summary = [
      done.updated && `${done.updated} geändert`, done.created && `${done.created} neu`, done.deleted && `${done.deleted} gelöscht`,
      done.merged && `${done.merged} als Antwort angehängt`,
    ].filter(Boolean).join(', ');
    if (fail.length) {
      alert('Nicht alles wurde gespeichert' + (summary ? ` (${summary})` : '') + ':\n\n' + fail.join('\n'));
    } else {
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* egal */ }
      reload(); // neu aufbauen: Daten können sich geändert haben, neue Einträge kommen dazu
      ui.toast(`Gespeichert ✓ ${summary}`);
    }
  } catch (err) {
    ui.toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  } finally {
    busy = false;
    update();
  }
}

/* ---------- Modul ---------- */

export default {
  id: 'entries',
  title: 'Einträge',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    countEl = h('span', { class: 'count' });
    saveBtn = h('button', { type: 'button', class: 'btn small', onclick: save, disabled: true }, 'Speichern');
    const reloadBtn = h('button', { type: 'button', class: 'link', onclick: () => {
      if (isDirty() && !confirm('Ungespeicherte Änderungen verwerfen und neu laden?')) return;
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* egal */ }
      reload();
    } }, 'Neu laden');
    skippedEl = h('div', { class: 'notice', hidden: true });
    const host = h('div', { class: 'md-editor', 'aria-label': 'Letzte Diary-Einträge' });
    issues = createIssues((line) => cm.jumpToLine(line));
    const own = (pred) => !!ed && ed.originals.some(pred);
    conflicts = createConflicts({
      ui, mode: 'diary',
      exclude: (n) => own((o) => o.path === n.path),
      isNew: (title) => !own((o) => o.title.toLowerCase() === title.toLowerCase()),
      pathOf: (title) => ed?.originals.find((o) => o.title.toLowerCase() === title.toLowerCase())?.path ?? null,
      onChange: () => { if (cm && ed) { update(); storeDraft(); } },
    });
    root.classList.add('diary-write');
    root.append(
      h('div', { class: 'dw-head' }, h('h2', { class: 'section' }, `Letzte ${LIMIT}`), countEl, reloadBtn, saveBtn),
      h('p', { class: 'path' }, `Ändern, ergänzen, löschen – gespeichert wird alles auf einmal. „TT.MM.JJJJ“ vor einer Frage legt ihr Datum fest; neue Fragen bekommen #${DIARY_TAG}.`),
      issues.errors, issues.warnings, host, skippedEl);
    cm = createQuestionEditor(ui, {
      parent: host, doc: '', onChange: onInput, folder: '', conflicts,
      placeholder: 'Noch keine Diary-Einträge mit #' + DIARY_TAG + ' und #date/…',
    });
    window.addEventListener('beforeunload', (e) => { if (isDirty()) e.preventDefault(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !root.hidden && root.offsetParent) { e.preventDefault(); save(); }
    });
  },

  show() {
    // beim ersten Öffnen (mit Entwurf) bzw. wenn nichts geändert ist: aktuellen Stand aus dem Vault
    if (!ed) reload({ restore: true });
    else if (!isDirty() && !busy) reload();
    else update();
  },
};
