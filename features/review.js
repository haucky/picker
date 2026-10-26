// Feature: Notizen wiederholen – Spaced Repetition (Stapel aus Review.md, Stand in der Frontmatter wie beim
// Obsidian-Plugin) und feste Intervalle (#review/weekly, #review/3m, …). Vorderseite = Dateiname, Rückseite = Inhalt.
import { parseTags } from '../core.js';
import { h, stableView } from './dom.js';
import { renderMarkdown } from './markdown.js';
import {
  CONFIG_PATH, RESPONSES, parseDecks, buildCards, srState, nextState, writeState, dueDateCounts,
  formatInterval, setReviewed, seedDay, splitAnswers, appendAnswer, cardBody, today, isConfig,
  setReviewState, fixedInterval, reviewedDay, setFixedInterval, markDone, addInterval,
  formatFixed, formatIntervalShort, sameInterval, intervalTag, dayToGerman,
} from './srs.js';
import { studyOrder } from './studydoc.js';
import { relatedTo } from './similar.js';
import { relatedRows } from './related.js';
import { openPeek, closePeek } from './peek.js';

const RESPONSE_LABEL = { hard: 'Schwer', good: 'Gut', easy: 'Leicht' };
// Auswahl beim Erledigen fester Intervalle; die gewählte wird zum neuen Intervall der Notiz.
const DONE_CHOICES = [[1, 'd'], [1, 'w'], [1, 'm'], [2, 'm'], [3, 'm'], [1, 'y']].map(([n, unit]) => ({ n, unit }));
const INTERVAL_PRESETS = [[1, 'd'], [1, 'w'], [2, 'w'], [1, 'm'], [2, 'm'], [3, 'm'], [6, 'm'], [1, 'y'], [2, 'y']]
  .map(([n, unit]) => ({ n, unit }));
const UNIT_NAMES = { d: 'Tage', w: 'Wochen', m: 'Monate', y: 'Jahre' };
const ALL = 'all';
const FIXED = 'fixed';

const CONFIG_TEMPLATE = `# Review

Jede Überschrift ist ein Stapel. Eine Notiz gehört dazu, wenn sie den Tag hinter „tag:“ hat
(Untertags zählen mit). Abgefragt werden nur Fragen mit Review-Status „bereit“ (im Study-Editor über den
Punkt vor der Frage setzen). Notizen mit festem Intervall (review/daily, weekly, monthly, yearly oder z. B.
review/2w, review/3m, review/1y) werden nur nach ihrem festen Intervall wiederholt.

## Datenbanken WS26
- tag: #uni/dbs
`;

let ui, core, root;
let overviewEl, sessionEl, overviewView;
let session = null;  // { key, title, queue: [Karte], index, revealed, answering, history: [], rated }
let objectUrls = [];

/* ---------- Daten ---------- */

function configNote() {
  return core.list().find((n) => isConfig(n.path)) || null;
}

function decks() {
  const cfg = configNote();
  return cfg ? parseDecks(cfg.text) : [];
}

function cardsFor(key, cards) {
  if (key === ALL) return cards;
  if (key === FIXED) return cards.filter((c) => c.kind === 'fixed');
  return cards.filter((c) => c.kind === 'sr' && c.decks.includes(key));
}

const isDue = (c) => !c.isNew && c.overdue >= 0;

/**
 * Fällige zuerst (am längsten überfällig oben), danach neue Karten: älteste Notiz (VL) zuerst,
 * innerhalb eines Datums in der Reihenfolge aus dem Study-Editor (study-order).
 */
function queueOf(cards) {
  const time = (c) => { const n = core.get(c.path); return n ? n.date ?? n.mtime : 0; };
  const order = (c) => { const n = core.get(c.path); return n ? studyOrder(n.text) : Infinity; };
  const due = cards.filter(isDue).sort((a, b) => b.overdue - a.overdue || a.path.localeCompare(b.path, 'de'));
  const fresh = cards.filter((c) => c.isNew).map((c) => ({ c, t: time(c), o: order(c) }))
    .sort((a, b) => a.t - b.t || (a.o - b.o || 0) || a.c.path.localeCompare(b.c.path, 'de'))
    .map((x) => x.c);
  return [...due, ...fresh];
}

/* ---------- Übersicht ---------- */

function renderOverview() {
  if (session) return;
  const cfg = configNote();
  const ds = decks();
  const day = today();
  const cards = buildCards(core.list(), ds, day);
  const children = [h('header', { class: 'bar' }, h('h1', {}, 'Review'))];

  if (!core.notes.size) {
    children.push(h('p', { class: 'hint left' }, core.syncing ? 'Index wird aufgebaut …' : 'Keine Notizen.'));
    overviewView.show(children);
    return;
  }

  const entries = [];
  const fixedCount = cards.filter((c) => c.kind === 'fixed').length;
  entries.push({ key: ALL, title: 'Alle' });
  ds.forEach((d, i) => entries.push({ key: i, title: d.name, sub: '#' + d.tag }));
  if (fixedCount) entries.push({ key: FIXED, title: 'Feste Intervalle', sub: '#review/weekly · 3m · 1y …' });

  children.push(h('ul', { class: 'decks' }, ...entries.map((e) => {
    const cs = cardsFor(e.key, cards);
    const due = cs.filter(isDue).length;
    const fresh = cs.filter((c) => c.isNew).length;
    const tomorrow = cs.filter((c) => !c.isNew && c.overdue === -1).length;
    const empty = !due && !fresh;
    return h('li', {}, h('button', {
      type: 'button', class: 'deck' + (empty ? ' done' : ''), disabled: empty,
      onclick: () => startSession(e.key, e.title),
    },
    h('div', { class: 'deck-main' },
      h('div', { class: 'deck-title' }, e.title),
      e.sub ? h('div', { class: 'deck-sub' }, e.sub) : null),
    h('div', { class: 'deck-counts' },
      empty ? h('span', { class: 'muted' }, tomorrow ? `morgen ${tomorrow}` : '✓') : null,
      due ? h('span', { class: 'due' }, `${due} fällig`) : null,
      fresh ? h('span', { class: 'new' }, `${fresh} neu`) : null)));
  })));

  const unseeded = cards.filter((c) => c.unseeded);
  if (unseeded.length) {
    children.push(h('div', { class: 'notice' },
      h('strong', {}, `${unseeded.length} Notiz${unseeded.length === 1 ? '' : 'en'} mit festem Intervall ohne #reviewed/…`),
      h('p', {}, 'Sie gelten als heute fällig. „Startdatum verteilen“ setzt wie das Obsidian-Snippet ein zufälliges ' +
        'Datum innerhalb des Intervalls, damit nicht alle auf einmal fällig sind.'),
      h('button', { type: 'button', class: 'btn small', onclick: () => seed(unseeded) }, 'Startdatum verteilen')));
  }

  if (!cfg) {
    children.push(h('div', { class: 'notice' },
      h('strong', {}, `Keine ${CONFIG_PATH} im Vault.`),
      h('p', {}, `Welche Notizen per Spaced Repetition wiederholt werden, steht in ${CONFIG_PATH} im obersten Ordner ` +
        'des Vaults. Jede Überschrift ist ein Stapel, darunter „- tag: #…“.'),
      h('button', { type: 'button', class: 'btn small', onclick: createConfig }, `${CONFIG_PATH} anlegen`)));
  } else {
    if (!ds.length) {
      children.push(h('p', { class: 'hint left' }, `${CONFIG_PATH} enthält noch keinen Stapel mit „tag:“.`));
    }
    children.push(h('button', { type: 'button', class: 'link', onclick: () => ui.openNote(cfg.path) }, `${CONFIG_PATH} bearbeiten`));
  }

  overviewView.show(children);
}

async function createConfig() {
  try {
    await core.create(CONFIG_PATH, CONFIG_TEMPLATE);
    ui.openNote(CONFIG_PATH);
  } catch (err) {
    ui.toast('Konnte nicht anlegen: ' + err.message, 4000);
  }
}

async function seed(cards) {
  if (!confirm(`${cards.length} Datei(en) bekommen einen #reviewed/…-Tag. Fortfahren?`)) return;
  const day = today();
  let ok = 0;
  for (const c of cards) {
    try {
      await core.update(c.path, (text) => setReviewed(text, seedDay(c.interval, day)));
      ok++;
    } catch (err) {
      ui.toast(`${c.path}: ${err.message}`, 4000);
      if (err.name === 'NotAllowedError') break;
    }
  }
  ui.toast(`${ok} Datei(en) aktualisiert.`);
  renderOverview();
}

/* ---------- Sitzung ---------- */

function startSession(key, title) {
  const cards = cardsFor(key, buildCards(core.list(), decks(), today()));
  const queue = queueOf(cards);
  if (!queue.length) return;
  session = { key, title, queue, index: 0, revealed: false, answering: false, editingInterval: false, history: [], rated: 0 };
  overviewEl.hidden = true;
  sessionEl.hidden = false;
  history.pushState({ review: true }, '');
  window.scrollTo(0, 0);
  renderCard();
}

function endSession() {
  session = null;
  clearUrls();
  sessionEl.hidden = true;
  sessionEl.replaceChildren();
  overviewEl.hidden = false;
  renderOverview();
}

function leave() {
  if (history.state && history.state.review) history.back(); // popstate beendet die Sitzung
  else endSession();
}

function clearUrls() {
  for (const u of objectUrls) URL.revokeObjectURL(u);
  objectUrls = [];
}

const current = () => session && session.queue[session.index];

const overdueText = (days) => `🔥 ${days} Tag${days === 1 ? '' : 'e'} überfällig`;

function badge(card) {
  if (card.kind === 'fixed') {
    let status;
    if (card.unseeded) status = 'noch nie';
    else if (card.overdue > 0) status = overdueText(card.overdue);
    else if (card.overdue === 0) status = 'heute fällig';
    else status = `fällig am ${dayToGerman(card.due)}`; // nach einer Intervall-Änderung in der Sitzung
    return h('div', { class: 'card-badge' },
      h('button', {
        type: 'button', class: 'interval-chip' + (session.editingInterval ? ' on' : ''),
        'aria-expanded': String(session.editingInterval), title: 'Intervall ändern',
        onclick: () => { session.editingInterval = !session.editingInterval; renderCard(); },
      }, `📅 ${formatFixed(card.interval)} ✎`),
      ' · ' + status);
  }
  const text = card.isNew ? '✨ neu' : card.overdue > 0 ? overdueText(card.overdue) : '🔔 heute fällig';
  return h('div', { class: 'card-badge' }, text);
}

/** Auswahl für das feste Intervall: häufige Werte als Chips, dazu Zahl + Einheit frei. */
function intervalPicker(card) {
  const num = h('input', {
    type: 'number', min: 1, max: 999, value: card.interval.n, class: 'interval-num', 'aria-label': 'Anzahl',
  });
  const unit = h('select', { class: 'interval-unit', 'aria-label': 'Einheit' },
    ...Object.entries(UNIT_NAMES).map(([u, name]) => h('option', { value: u, selected: u === card.interval.unit }, name)));
  const custom = () => {
    const n = Math.round(+num.value);
    if (!(n >= 1 && n <= 999)) { ui.toast('Bitte eine Zahl von 1 bis 999.'); return; }
    changeInterval({ n, unit: unit.value });
  };
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); custom(); } });
  return h('div', { class: 'interval-picker' },
    h('div', { class: 'picks' }, ...INTERVAL_PRESETS.map((iv) => h('button', {
      type: 'button', class: 'chip' + (sameInterval(iv, card.interval) ? ' on' : ''),
      title: '#review/' + intervalTag(iv), onclick: () => changeInterval(iv),
    }, formatIntervalShort(iv)))),
    h('div', { class: 'interval-custom' }, 'alle', num, unit,
      h('button', { type: 'button', class: 'btn small', onclick: custom }, 'Setzen')));
}

function mdContext(path) {
  return {
    openNote: (target) => {
      const want = target.toLowerCase().replace(/\.md$/, '');
      const notes = core.list();
      const hit = notes.find((n) => n.path.toLowerCase().replace(/\.md$/, '') === want)
        || notes.filter((n) => n.nameLower === want.split('/').at(-1)).sort((a, b) => a.path.length - b.path.length)[0];
      if (hit) ui.openNote(hit.path); else ui.toast(`„${target}“ nicht gefunden`);
    },
    resolveImage: async (link) => {
      if (!(await core.hasPermission())) throw new Error('kein Zugriff');
      const p = await core.resolveAttachment(link, path);
      if (!p) return null;
      const url = await core.fileUrl(p);
      objectUrls.push(url);
      return url;
    },
  };
}

function renderCard() {
  clearUrls();
  if (!session) return;
  const card = current();
  const header = h('header', { class: 'bar' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück', onclick: leave }, '←'),
    h('h1', { class: 'ellipsis' }, session.title),
    h('span', { class: 'count' }, card ? `${session.index + 1} / ${session.queue.length}` : ''));

  if (!card) {
    sessionEl.replaceChildren(header,
      h('div', { class: 'card-done' },
        h('p', { class: 'card-front' }, '🎉 Geschafft'),
        h('p', { class: 'hint' }, `${session.rated} Notiz${session.rated === 1 ? '' : 'en'} wiederholt.`),
        h('button', { type: 'button', class: 'btn', onclick: leave }, 'Zurück zur Übersicht')),
      actions(null));
    return;
  }

  const note = core.get(card.path);
  if (!note) { // inzwischen gelöscht oder umbenannt
    session.queue.splice(session.index, 1);
    renderCard();
    return;
  }

  const ctx = mdContext(note.path);
  const { back, answers, count } = splitAnswers(cardBody(note.text));
  const parts = [
    header,
    badge(card),
    h('button', { type: 'button', class: 'card-front', onclick: () => ui.openNote(note.path) }, note.title + '?'),
  ];
  if (card.kind === 'fixed' && session.editingInterval) parts.splice(2, 0, intervalPicker(card));
  if (note.path.includes('/')) parts.push(h('div', { class: 'card-path' }, note.path.slice(0, note.path.lastIndexOf('/'))));

  if (session.answering) parts.push(answerBox(note));
  else parts.push(h('button', { type: 'button', class: 'link accent', onclick: () => { session.answering = true; renderCard(); } }, '✍️ Antwort notieren'));

  if (!session.revealed) {
    parts.push(h('button', { type: 'button', class: 'btn reveal', onclick: reveal }, 'Antwort zeigen'));
  } else {
    parts.push(h('div', { class: 'card-back' }, back.trim() ? renderMarkdown(back, ctx) : h('p', { class: 'hint left' }, '(leer)')));
    if (count) {
      parts.push(h('details', { class: 'answers' },
        h('summary', {}, `Deine Antworten (${count})`),
        renderMarkdown(answers.replace(/^::(\d{2}\.\d{2}\.\d{4})::\s*$/gm, '#### $1'), ctx)));
    }
    parts.push(relatedBox(note));
    parts.push(ratingRow(card, note));
  }
  parts.push(actions(card));
  sessionEl.replaceChildren(...parts);
}

/**
 * Verwandte Fragen (aus den gespeicherten Embeddings, ohne Server): eingeklappt unter der Rückseite, erscheint erst,
 * wenn es welche gibt. Antippen öffnet die Frage im Nebenfenster.
 */
function relatedBox(note) {
  const box = h('details', { class: 'answers related', hidden: true });
  relatedTo(core, note.path).then((list) => {
    const rows = relatedRows(core, note.title, list, (n) => openPeek(ui, n, { label: 'Verwandt' }));
    if (!rows.length || !box.isConnected) return;
    box.replaceChildren(h('summary', {}, `Verwandte Fragen (${rows.length})`), h('div', { class: 'rel-list' }, ...rows));
    box.hidden = false;
  }, () => {});
  return box;
}

function answerBox(note) {
  const ta = h('textarea', { class: 'answer-input', rows: 4, placeholder: 'Was weißt du noch?', 'aria-label': 'Antwort' });
  const save = async () => {
    const text = ta.value.trim();
    if (!text) { session.answering = false; renderCard(); return; }
    try {
      await core.update(note.path, (cur) => appendAnswer(cur, text, today()));
      session.answering = false;
      ui.toast('Antwort gespeichert ✓');
      renderCard();
    } catch (err) {
      ui.toast('Speichern fehlgeschlagen: ' + err.message, 4000);
    }
  };
  setTimeout(() => ta.focus(), 0);
  return h('div', { class: 'answer-box' }, ta,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn small', onclick: () => { session.answering = false; renderCard(); } }, 'Abbrechen'),
      h('button', { type: 'button', class: 'btn small', onclick: save }, 'Speichern')));
}

function ratingRow(card, note) {
  const day = today();
  if (card.kind === 'fixed') {
    return h('div', { class: 'ratings done-choices' },
      h('div', { class: 'done-title' }, '✅ Erledigt – wieder:'),
      h('div', { class: 'done-grid' }, ...doneChoices(card.interval).map((iv) =>
        h('button', {
          type: 'button', class: 'rate' + (sameInterval(iv, card.interval) ? ' good' : ''),
          title: '#review/' + intervalTag(iv), onclick: () => rate('done', iv),
        }, doneLabel(iv), h('small', {}, dayToGerman(addInterval(day, iv)))))));
  }
  const st = srState(note.text);
  const dd = dueDateCounts(core.list(), day, note.path);
  return h('div', { class: 'ratings' }, ...RESPONSES.map((r) => {
    const next = nextState(st, r, day, { ...dd });
    return h('button', { type: 'button', class: 'rate ' + r, onclick: () => rate(r) },
      RESPONSE_LABEL[r], h('small', {}, formatInterval(next.due - day)));
  }));
}

/** Feste Auswahl, dazu das aktuelle Intervall, falls es nicht dabei ist (z. B. 2 Wochen). */
function doneChoices(current) {
  return DONE_CHOICES.some((iv) => sameInterval(iv, current)) ? DONE_CHOICES : [current, ...DONE_CHOICES];
}

const doneLabel = (iv) => (iv.n === 1 && iv.unit !== 'm' ? formatFixed(iv)
  : `${iv.n} ${(iv.n === 1 ? { d: 'Tag', w: 'Woche', m: 'Monat', y: 'Jahr' } : { d: 'Tage', w: 'Wochen', m: 'Monate', y: 'Jahre' })[iv.unit]}`);

function actions(card) {
  return h('div', { class: 'card-actions' },
    card ? h('button', { type: 'button', class: 'link', onclick: () => ui.openNote(card.path) }, '✏️ Bearbeiten') : null,
    card ? h('button', { type: 'button', class: 'link', onclick: skip }, '↷ Überspringen') : null,
    card && card.kind === 'sr'
      ? h('button', { type: 'button', class: 'link', onclick: retire, title: 'Review-Status „nicht abfragen“ (wieder änderbar im Study-Editor)' }, '⊘ Aussortieren')
      : null,
    session.history.length ? h('button', { type: 'button', class: 'link', onclick: undo }, '↶ Rückgängig') : null);
}

function reveal() {
  session.revealed = true;
  renderCard();
}

function advance() {
  closePeek(true);
  session.index++;
  session.revealed = false;
  session.answering = false;
  session.editingInterval = false;
  window.scrollTo(0, 0);
  renderCard();
}

function skip() {
  advance();
}

let busy = false;
/** Bewertung; bei festem Intervall `response` = 'done' und `iv` = gewähltes Intervall (ohne = bisheriges). */
async function rate(response, iv) {
  const card = current();
  if (!card || busy) return;
  busy = true;
  const day = today();
  let before, after;
  try {
    await core.update(card.path, (text) => {
      before = text;
      if (card.kind === 'fixed') {
        // Intervall aus der aktuellen Datei (kann inzwischen im Editor geändert worden sein)
        after = markDone(text, iv || fixedInterval(parseTags(text)) || card.interval, day);
      } else {
        const dd = dueDateCounts(core.list(), day, card.path);
        after = writeState(text, nextState(srState(text), response, day, dd));
      }
      return after;
    });
    session.history.push({ path: card.path, index: session.index, before, after, rated: true });
    session.rated++;
    advance();
  } catch (err) {
    ui.toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  } finally {
    busy = false;
  }
}

/** Fälligkeit einer Karte mit festem Intervall aus dem (neuen) Text. */
function refreshFixed(card, text) {
  const tags = parseTags(text);
  const iv = fixedInterval(tags);
  if (!iv) return;
  const day = today();
  const last = reviewedDay(tags);
  card.interval = iv;
  card.due = last == null ? day : addInterval(last, iv);
  card.overdue = day - card.due;
  card.unseeded = last == null;
}

/** Festes Intervall der aktuellen Karte ändern (#review/…-Tag); Rückgängig wie bei einer Bewertung. */
async function changeInterval(iv) {
  const card = current();
  if (!card || card.kind !== 'fixed' || busy) return;
  if (sameInterval(iv, card.interval)) { session.editingInterval = false; renderCard(); return; }
  busy = true;
  let before, after;
  try {
    await core.update(card.path, (text) => { before = text; after = setFixedInterval(text, iv); return after; });
    session.history.push({ path: card.path, index: session.index, before, after, rated: false, revealed: session.revealed });
    refreshFixed(card, after);
    session.editingInterval = false;
    ui.toast(`Intervall: ${formatFixed(iv)}`);
    renderCard();
  } catch (err) {
    ui.toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  } finally {
    busy = false;
  }
}

/** Karte nicht mehr abfragen (Review-Status skip), z. B. Orga-Fragen; Rückgängig wie bei einer Bewertung. */
async function retire() {
  const card = current();
  if (!card || busy) return;
  busy = true;
  let before, after;
  try {
    await core.update(card.path, (text) => { before = text; after = setReviewState(text, 'skip'); return after; });
    session.history.push({ path: card.path, index: session.index, before, after, rated: false });
    ui.toast('Aussortiert – wird nicht mehr abgefragt');
    advance();
  } catch (err) {
    ui.toast('Speichern fehlgeschlagen: ' + err.message, 5000);
  } finally {
    busy = false;
  }
}

async function undo() {
  const last = session.history.at(-1);
  if (!last || busy) return;
  busy = true;
  let changed = false;
  try {
    await core.update(last.path, (text) => {
      if (text !== last.after) { changed = true; return text; }
      return last.before;
    });
    session.history.pop();
    if (changed) {
      ui.toast('Datei wurde inzwischen geändert – nicht rückgängig gemacht.', 4000);
    } else {
      if (last.rated) session.rated--;
      session.index = last.index;
      session.revealed = last.revealed ?? last.rated;
      session.answering = false;
      session.editingInterval = false;
      const card = current();
      if (card && card.kind === 'fixed') refreshFixed(card, last.before);
      renderCard();
    }
  } catch (err) {
    ui.toast('Rückgängig fehlgeschlagen: ' + err.message, 5000);
  } finally {
    busy = false;
  }
}

/* ---------- Modul ---------- */

export default {
  id: 'review',
  title: 'Review',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    overviewEl = h('div', { class: 'review-overview' });
    sessionEl = h('div', { class: 'review-session', hidden: true });
    overviewView = stableView(overviewEl);
    root.append(overviewEl, sessionEl);

    // Zurück-Geste beendet die Sitzung (der Editor legt seinen eigenen Eintrag darüber).
    window.addEventListener('popstate', () => {
      if (session && !(history.state && (history.state.review || history.state.note))) endSession();
    });

    let queued = false;
    core.on('change', (ev) => {
      if (root.hidden) return;
      if (session) {
        const card = current();
        if (card && (ev.paths || []).includes(card.path) && !busy && !session.answering) {
          const note = core.get(card.path);
          if (note && card.kind === 'fixed') refreshFixed(card, note.text); // z. B. Intervall im Editor geändert
          renderCard();
        }
        return;
      }
      if (!queued) {
        queued = true;
        requestAnimationFrame(() => { queued = false; overviewView.request(renderOverview); });
      }
    });

    // Tastatur (Laptop): Leertaste = zeigen, 1/2/3 = Schwer/Gut/Leicht, Enter = Erledigt (bisheriges Intervall),
    // 1–7 = Erledigt mit Intervall aus der Auswahl, u = rückgängig
    document.addEventListener('keydown', (e) => {
      if (!session || root.hidden || sessionEl.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return; // z. B. im Nebenfenster
      if (!document.getElementById('view-editor').hidden) return;
      const card = current();
      if (!card) return;
      if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); return; }
      if (e.key === 'u') { undo(); return; }
      if (!session.revealed) return;
      if (card.kind === 'fixed' && e.key === 'Enter') { e.preventDefault(); rate('done'); }
      if (card.kind === 'fixed' && /^[1-9]$/.test(e.key)) {
        const iv = doneChoices(card.interval)[+e.key - 1];
        if (iv) rate('done', iv);
      }
      if (card.kind === 'sr' && /^[123]$/.test(e.key)) rate(RESPONSES[+e.key - 1]);
    });
  },

  show() {
    if (session) renderCard(); else renderOverview();
  },
};
