// Feature Streams (im Tab Diary): Stapel aus Streams.md über die Zeit – Zeitleiste mit Kapiteln und eigenen
// Antworten („Heute sehe ich das so …“), Damals (an diesem Tag, Zufall, Damals ↔ Heute) und Muster (auffällige Wörter).
import { h, stableView } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { today, dayToGerman, appendAnswer } from './srs.js';
import {
  STREAMS_PATH, isStreamsConfig, parseStreams, addStream, addChapter, streamEntries, entryParts, weekCounts,
  topDiaryTags, nearestEntry, entryWords, periods, distinctiveWords, threadWords, threadEntries,
} from './streamsdoc.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTH_STEP = 4;      // so viele Monate werden auf einmal gezeichnet
const STOP_WORDS = 400;    // die häufigsten Wörter der Wortlisten gelten als Füllwörter
const LISTS = ['vendor/dict/de.txt', 'vendor/dict/en.txt'];

let ui, core, root, view;
let urls = [];             // Object-URLs der Bilder im aktuellen Bild, beim Neuzeichnen freigeben
let st = { view: 'list', idx: 0, mode: 'zeit', expanded: new Set(), writing: null, months: MONTH_STEP,
  pick: null, adding: false, threadWord: null, threadPos: 0, randomPath: null };
let stopWords = null;      // Set, lazy aus den Wortlisten
let wordCache = new Map(); // Pfad → { text, words }

/* ---------- Daten ---------- */

function configNote() { return core.list().find((n) => isStreamsConfig(n.path)) || null; }
function streams() { const c = configNote(); return c ? parseStreams(c.text) : []; }
const fmtDay = (day) => dayToGerman(day).slice(0, 6);
const monthKey = (day) => { const d = new Date(day * 864e5); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const monthLabel = (k) => `${MONTHS[k % 12]} ${Math.floor(k / 12)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Füllwörter: die ersten Zeilen der Häufigkeitslisten (nur so viel lesen wie nötig). */
async function loadStopWords() {
  if (stopWords) return stopWords;
  const set = new Set();
  for (const url of LISTS) {
    try {
      const res = await fetch(url);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let lines = [];
      while (lines.length <= STOP_WORDS) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        lines = buf.split('\n');
      }
      reader.cancel().catch(() => {});
      lines.slice(0, STOP_WORDS).forEach((w) => w && set.add(w.trim().toLowerCase()));
    } catch { /* ohne Liste geht es auch, nur mit mehr Füllwörtern */ }
  }
  stopWords = set;
  wordCache = new Map(); // ohne Füllwortliste gezählte Wörter verwerfen
  return set;
}

function wordsOf(entries) {
  const m = new Map();
  for (const e of entries) {
    const c = wordCache.get(e.note.path);
    if (c && c.text === e.note.text) { m.set(e, c.words); continue; }
    const words = entryWords(e.note.text, stopWords || new Set());
    wordCache.set(e.note.path, { text: e.note.text, words });
    m.set(e, words);
  }
  return m;
}

async function writeConfig(change) {
  const c = configNote();
  if (c) await core.update(c.path, change);
  else await core.create(STREAMS_PATH, change(null));
}

/* ---------- Kleine Grafiken ---------- */

function sparkline(counts) {
  const W = 108;
  const H = 28;
  const max = Math.max(1, ...counts);
  const pts = counts.map((v, i) => [i * (W / (counts.length - 1)), H - 3 - (v / max) * (H - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'st-spark');
  svg.setAttribute('aria-hidden', 'true');
  const last = pts.at(-1);
  svg.innerHTML = `<path class="area" d="${d} L${W} ${H} L0 ${H} Z"/><path class="line" d="${d}"/>` +
    `<circle class="dot" cx="${last[0]}" cy="${last[1]}" r="2.4"/>`;
  return svg;
}

/* ---------- Übersicht ---------- */

function renderList() {
  const ss = streams();
  const notes = core.list();
  const day = today();
  const children = [h('header', { class: 'bar' }, h('h1', {}, 'Streams'))];
  if (!core.notes.size) {
    children.push(h('p', { class: 'hint left' }, core.syncing ? 'Index wird aufgebaut …' : 'Keine Notizen.'));
  } else {
    if (!ss.length) {
      children.push(h('p', { class: 'hint left' },
        `Ein Stream zeigt einen Tag über die Zeit, z. B. #diary/mental. Die Streams stehen in ${STREAMS_PATH} im obersten Ordner des Vaults.`));
    }
    children.push(h('ul', { class: 'decks' }, ...ss.map((s, i) => {
      const es = streamEntries(notes, s);
      return h('li', {}, h('button', { type: 'button', class: 'deck', onclick: () => openStream(i) },
        h('div', { class: 'deck-main' },
          h('div', { class: 'deck-title' }, s.name),
          h('div', { class: 'deck-sub' }, '#' + s.tag, ' · ', plural(es.length, 'Eintrag', 'Einträge'),
            es.length ? ' · zuletzt ' + fmtDay(es[0].day) : '')),
        sparkline(weekCounts(es, day, 52))));
    })));
    if (ss.length) children.push(h('p', { class: 'hint' }, 'Kurve: Einträge pro Woche, letzte 12 Monate'));
    children.push(st.adding ? addPanel(ss, notes) :
      h('button', { type: 'button', class: 'btn', onclick: () => { st.adding = true; render(); } }, '+ Neuer Stream'));
  }
  root.replaceChildren(...children);
}

/** Neuer Stream: die 10 häufigsten #diary/…-Tags, die noch kein Stream sind. */
function addPanel(ss, notes) {
  const tops = topDiaryTags(notes, ss.map((s) => s.tag));
  const nameOf = (tag) => { const last = tag.split('/').at(-1); return last[0].toUpperCase() + last.slice(1); };
  const name = h('input', { type: 'text', class: 'filter', placeholder: 'Name des Streams', 'aria-label': 'Name' });
  const tagIn = h('input', { type: 'text', class: 'filter', placeholder: '#diary/…', 'aria-label': 'Tag', autocapitalize: 'off' });
  const pick = (tag) => { tagIn.value = '#' + tag; if (!name.value.trim()) name.value = nameOf(tag); };
  const save = async () => {
    const tag = tagIn.value.trim().replace(/^#/, '');
    const n = name.value.trim() || (tag && nameOf(tag));
    if (!tag) { ui.toast('Erst einen Tag wählen.'); return; }
    if (ss.some((s) => s.name === n)) { ui.toast(`Einen Stream „${n}“ gibt es schon.`); return; }
    try {
      await writeConfig((text) => addStream(text, n, tag));
      st.adding = false;
      ui.toast(`Stream „${n}“ angelegt ✓`);
      render();
    } catch (err) {
      ui.toast('Konnte nicht speichern: ' + err.message, 4000);
    }
  };
  return h('div', { class: 'st-add' },
    h('h2', { class: 'section' }, 'Neuer Stream'),
    tops.length ? h('div', { class: 'picks' }, ...tops.map((t) =>
      h('button', { type: 'button', class: 'chip', onclick: () => pick(t.tag) }, `#${t.tag}`, h('small', {}, ` ${t.count}`)))) :
      h('p', { class: 'hint left' }, 'Keine #diary/…-Tags gefunden.'),
    tagIn, name,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => { st.adding = false; render(); } }, 'Abbrechen'),
      h('button', { type: 'button', class: 'btn', onclick: save }, 'Anlegen')),
    h('p', { class: 'hint left' }, `Wird in ${STREAMS_PATH} gespeichert (Untertags zählen mit).`));
}

/* ---------- Stream ---------- */

function openStream(i) {
  st = { ...st, view: 'stream', idx: i, mode: 'zeit', expanded: new Set(), writing: null, months: MONTH_STEP, pick: null,
    threadWord: null, threadPos: 0, randomPath: null };
  history.pushState({ streams: 'stream' }, '');
  window.scrollTo(0, 0);
  render();
}

function leave() {
  if (history.state && history.state.streams === 'stream') history.back();
  else { st.view = 'list'; render(); }
}

function renderStream() {
  const s = streams()[st.idx];
  if (!s) { st.view = 'list'; renderList(); return; }
  const entries = streamEntries(core.list(), s);
  const modes = h('div', { class: 'st-modes', role: 'tablist' }, ...[['zeit', 'Zeitleiste'], ['damals', 'Damals'], ['muster', 'Muster']]
    .map(([k, label]) => h('button', { type: 'button', role: 'tab', class: st.mode === k ? 'on' : '',
      onclick: () => { st.mode = k; st.pick = null; render(); window.scrollTo(0, 0); } }, label)));
  const children = [
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück', onclick: leave }, '←'),
      h('div', { class: 'bar-title' }, h('h1', { class: 'ellipsis' }, s.name),
        h('div', { class: 'bar-sub ellipsis' }, `#${s.tag} · ${plural(entries.length, 'Eintrag', 'Einträge')}`))),
    modes,
  ];
  if (!entries.length) children.push(h('p', { class: 'hint left' }, `Noch keine Notizen mit #${s.tag} und #date/….`));
  else if (st.mode === 'zeit') children.push(...timeline(s, entries));
  else if (st.mode === 'damals') children.push(...damals(entries));
  else children.push(...muster(s, entries));
  root.replaceChildren(...children);
}

/* ----- Eintrag ----- */

function mdCtx(path) {
  return {
    openNote: (t) => ui.openLink(t),
    resolveImage: (link) => ui.resolveImage(link, path).then((u) => { if (u && u.startsWith('blob:')) urls.push(u); return u; }),
  };
}

function answersEl(answers, path, all) {
  if (!answers.length) return null;
  const shown = all ? answers : answers.slice(-1);
  return h('div', { class: 'st-answers' },
    ...shown.map((a) => h('div', { class: 'st-answer' }, h('div', { class: 'st-answer-date' }, a.date), renderMarkdown(a.text, mdCtx(path)))),
    !all && answers.length > 1 ? h('div', { class: 'st-more' }, `+${answers.length - 1} frühere`) : null);
}

function writeBox(e) {
  const ta = h('textarea', { class: 'answer-input', rows: 3, placeholder: 'Wie siehst du das heute?', 'aria-label': 'Heute sehe ich das so' });
  const save = async () => {
    const text = ta.value.trim();
    if (!text) { st.writing = null; render(); return; }
    try {
      await core.update(e.note.path, (cur) => appendAnswer(cur, text, today()));
      st.writing = null;
      ui.toast('Gespeichert ✓');
      render();
    } catch (err) {
      ui.toast('Speichern fehlgeschlagen: ' + err.message, 4000);
    }
  };
  setTimeout(() => ta.focus());
  return h('div', { class: 'st-write' },
    h('div', { class: 'st-answer-date' }, `Heute sehe ich das so · ${dayToGerman(today())}`), ta,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn small', onclick: () => { st.writing = null; render(); } }, 'Abbrechen'),
      h('button', { type: 'button', class: 'btn small', onclick: save }, 'Speichern')));
}

function entryEl(e, { inChapter = false } = {}) {
  const path = e.note.path;
  const open = st.expanded.has(path);
  const { body, answers } = entryParts(e.note.text);
  const onTitle = () => {
    if (st.pick) { pickChapterEntry(e); return; }
    if (open) st.expanded.delete(path); else st.expanded.add(path);
    render();
  };
  const picked = st.pick && st.pick.from === e.day;
  return h('div', { class: 'st-entry' + (inChapter ? ' in-chapter' : '') + (picked ? ' picked' : ''), 'data-path': path },
    h('div', { class: 'st-entry-head' },
      h('span', { class: 'st-date' }, fmtDay(e.day)),
      h('button', { type: 'button', class: 'st-title', onclick: onTitle }, e.note.title),
      st.pick ? null : h('button', { type: 'button', class: 'st-pen', title: 'Heute sehe ich das so …', 'aria-label': 'Heute sehe ich das so',
        onclick: () => { st.writing = path; st.expanded.add(path); render(); } }, '✍️')),
    open ? h('div', { class: 'st-body' }, body ? renderMarkdown(body, mdCtx(path)) : h('p', { class: 'hint left' }, '(leer)')) : null,
    answersEl(answers, path, open),
    st.writing === path ? writeBox(e) : null,
    open && st.writing !== path ? h('div', { class: 'st-actions' },
      h('button', { type: 'button', class: 'link accent', onclick: () => ui.openNote(path) }, 'Bearbeiten')) : null);
}

/* ----- Zeitleiste ----- */

function timeline(s, entries) {
  const day = today();
  const weeks = weekCounts(entries, day, 26);
  const max = Math.max(1, ...weeks);
  const heat = h('div', { class: 'st-heat', 'aria-label': 'Einträge pro Woche, letzte 26 Wochen' }, ...weeks.map((v, i) => {
    const cell = h('button', { type: 'button', class: 'st-cell', title: plural(v, 'Eintrag', 'Einträge'), 'aria-label': `${25 - i} Wochen zurück: ${v}`,
      onclick: () => { const target = nearestEntry(entries, day - (25 - i) * 7 - 3, 400); if (target) jumpTo(target, entries); } });
    if (v) cell.style.setProperty('--level', String(Math.round(25 + 75 * v / max)));
    return cell;
  }));
  const out = [h('div', { class: 'st-eyebrow' }, 'Letzte 26 Wochen'), heat, chapterBar(s)];

  const chapterOf = (d) => s.chapters.find((c) => d >= c.from && d <= (c.to ?? day));
  const byMonth = new Map();
  for (const e of entries) { const k = monthKey(e.day); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(e); }
  const keys = [...byMonth.keys()];
  const shownChapters = new Set();
  for (const k of keys.slice(0, st.months)) {
    const list = byMonth.get(k);
    out.push(h('div', { class: 'st-month' }, h('b', {}, monthLabel(k)), h('span', {}, plural(list.length, 'Eintrag', 'Einträge'))));
    for (const e of list) {
      const c = chapterOf(e.day);
      if (c && !shownChapters.has(c)) {
        shownChapters.add(c);
        const n = entries.filter((x) => x.day >= c.from && x.day <= (c.to ?? day)).length;
        out.push(h('div', { class: 'st-chapter' }, 'Kapitel: ', c.name,
          h('small', {}, ` · ${fmtDay(c.from)}–${c.to == null ? 'heute' : fmtDay(c.to)} · ${plural(n, 'Eintrag', 'Einträge')}`)));
      }
      out.push(entryEl(e, { inChapter: !!c }));
    }
  }
  if (keys.length > st.months) {
    const more = h('button', { type: 'button', class: 'btn st-more-btn', onclick: () => { st.months += MONTH_STEP; render(); } },
      `Ältere laden (${plural(keys.length - st.months, 'Monat', 'Monate')})`);
    // beim Scrollen von selbst nachladen
    const io = new IntersectionObserver((obs) => { if (obs.some((o) => o.isIntersecting)) { io.disconnect(); st.months += MONTH_STEP; render(); } }, { rootMargin: '400px' });
    setTimeout(() => more.isConnected && io.observe(more));
    out.push(more);
  }
  return out;
}

function jumpTo(e, entries) {
  const k = monthKey(e.day);
  const keys = [...new Set(entries.map((x) => monthKey(x.day)))];
  st.months = Math.max(st.months, keys.indexOf(k) + 1);
  st.mode = 'zeit';
  st.expanded.add(e.note.path);
  render();
  const el = root.querySelector(`.st-entry[data-path="${CSS.escape(e.note.path)}"]`);
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); }
}

/* ----- Kapitel anlegen ----- */

function chapterBar() {
  if (!st.pick) return h('div', { class: 'st-chapter-tools' }, h('button', { type: 'button', class: 'link accent', onclick: () => { st.pick = { stage: 'from' }; render(); } }, '+ Kapitel'));
  const cancel = h('button', { type: 'button', class: 'link', onclick: () => { st.pick = null; render(); } }, 'Abbrechen');
  if (st.pick.stage === 'from') return h('div', { class: 'notice st-pick' }, h('strong', {}, 'Kapitel: ersten Eintrag antippen'), ' ', cancel);
  if (st.pick.stage === 'to') {
    return h('div', { class: 'notice st-pick' }, h('strong', {}, `Ab ${fmtDay(st.pick.from)}: letzten Eintrag antippen`), ' oder ',
      h('button', { type: 'button', class: 'link accent', onclick: () => { st.pick = { ...st.pick, stage: 'name', to: null }; render(); } }, 'bis heute'), ' · ', cancel);
  }
  const name = h('input', { type: 'text', class: 'filter', placeholder: 'Name, z. B. Prüfungsphase', 'aria-label': 'Name des Kapitels' });
  const save = async () => {
    if (!name.value.trim()) { ui.toast('Bitte einen Namen eingeben.'); return; }
    const s = streams()[st.idx];
    try {
      await writeConfig((text) => addChapter(text, s.name, { from: st.pick.from, to: st.pick.to, name: name.value.trim() }));
      st.pick = null;
      ui.toast('Kapitel gespeichert ✓');
      render();
    } catch (err) {
      ui.toast('Konnte nicht speichern: ' + err.message, 4000);
    }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  setTimeout(() => name.focus());
  return h('div', { class: 'notice st-pick' },
    h('strong', {}, `Kapitel ${fmtDay(st.pick.from)}–${st.pick.to == null ? 'heute' : fmtDay(st.pick.to)}`), name,
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: () => { st.pick = null; render(); } }, 'Abbrechen'),
      h('button', { type: 'button', class: 'btn small', onclick: save }, 'Speichern')));
}

function pickChapterEntry(e) {
  if (st.pick.stage === 'from') st.pick = { stage: 'to', from: e.day };
  else if (st.pick.stage === 'to') {
    const [from, to] = [Math.min(st.pick.from, e.day), Math.max(st.pick.from, e.day)];
    st.pick = { stage: 'name', from, to };
  }
  render();
  window.scrollTo(0, 0);
}

/* ----- Damals ----- */

function damals(entries) {
  const day = today();
  const back = (months) => { const d = new Date(day * 864e5); d.setUTCMonth(d.getUTCMonth() - months); return Math.round(d / 864e5); };
  const out = [h('div', { class: 'st-eyebrow' }, 'An diesem Tag')];
  let any = false;
  for (const [m, label] of [[1, 'Vor 1 Monat'], [3, 'Vor 3 Monaten'], [12, 'Vor 1 Jahr']]) {
    const e = nearestEntry(entries, back(m));
    if (!e) continue;
    any = true;
    out.push(h('div', { class: 'st-card' }, h('div', { class: 'st-eyebrow' }, `${label} · ${dayToGerman(e.day)}`), ...entryCard(e, entries)));
  }
  if (!any) out.push(h('p', { class: 'hint left' }, 'Keine Einträge um diese Tage herum (±7 Tage).'));

  // Zufälliger Eintrag mit Schreibfrage
  let r = entries.find((e) => e.note.path === st.randomPath);
  if (!r) { r = entries[Math.floor(Math.random() * entries.length)]; st.randomPath = r.note.path; }
  out.push(h('div', { class: 'st-eyebrow' }, 'Zufällig'),
    h('div', { class: 'st-card hl' }, h('div', { class: 'st-eyebrow' }, dayToGerman(r.day)), ...entryCard(r, entries),
      st.writing === r.note.path ? writeBox(r) : h('div', { class: 'st-ask' }, 'Was würdest du heute dazu sagen?'),
      st.writing === r.note.path ? null : h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn small', onclick: () => { st.writing = r.note.path; render(); } }, '✍️ Antworten'),
        h('button', { type: 'button', class: 'btn small', onclick: () => { st.randomPath = null; st.writing = null; render(); } }, 'Anderer Eintrag'))));

  out.push(...thread(entries));
  return out;
}

function entryCard(e, entries) {
  const { body, answers } = entryParts(e.note.text);
  return [
    h('button', { type: 'button', class: 'st-card-title', onclick: () => jumpTo(e, entries) }, e.note.title),
    body ? renderMarkdown(body, mdCtx(e.note.path)) : null,
    answersEl(answers, e.note.path, false),
  ];
}

/** Damals ↔ Heute: frühester Eintrag mit dem Wort neben einem späteren; ‹ › blättert durch alle dazwischen. */
function thread(entries) {
  const sugg = stopWords ? threadWords(entries, wordsOf(entries)) : [];
  if (!stopWords) loadStopWords().then(() => { if (st.view === 'stream' && st.mode === 'damals') render(); });
  const input = h('input', { type: 'text', class: 'filter', placeholder: 'Eigenes Stichwort …', 'aria-label': 'Stichwort', value: st.threadWord && !sugg.includes(st.threadWord) ? st.threadWord : '',
    onkeydown: (e) => { if (e.key === 'Enter') { st.threadWord = input.value.trim() || null; st.threadPos = null; render(); } } });
  const out = [h('div', { class: 'st-eyebrow' }, 'Damals ↔ Heute'),
    h('div', { class: 'picks' }, ...sugg.map((w) => h('button', { type: 'button', class: 'chip' + (st.threadWord === w ? ' on' : ''),
      onclick: () => { st.threadWord = w; st.threadPos = null; render(); } }, w))), input];
  if (!st.threadWord) return out;
  const list = threadEntries(entries, st.threadWord);
  if (list.length < 2) { out.push(h('p', { class: 'hint left' }, list.length ? 'Nur ein Eintrag mit diesem Wort.' : 'Kein Eintrag mit diesem Wort.')); return out; }
  const pos = st.threadPos == null ? list.length - 1 : Math.min(Math.max(1, st.threadPos), list.length - 1);
  const card = (e) => h('div', { class: 'st-card' }, h('div', { class: 'st-eyebrow' }, dayToGerman(e.day)), ...entryCard(e, entries));
  out.push(h('div', { class: 'st-compare' }, card(list[0]), card(list[pos])),
    h('div', { class: 'st-thread-nav' },
      h('button', { type: 'button', class: 'btn small', disabled: pos <= 1, onclick: () => { st.threadPos = pos - 1; render(); } }, '‹'),
      h('span', {}, `${pos + 1} / ${list.length} Einträge mit „${st.threadWord}“`),
      h('button', { type: 'button', class: 'btn small', disabled: pos >= list.length - 1, onclick: () => { st.threadPos = pos + 1; render(); } }, '›')));
  return out;
}

/* ----- Muster ----- */

function muster(s, entries) {
  if (!stopWords) {
    loadStopWords().then(() => { if (st.view === 'stream' && st.mode === 'muster') render(); });
    return [h('p', { class: 'hint left' }, 'Wörter werden gezählt …')];
  }
  const words = wordsOf(entries);
  const ps = periods(entries, s.chapters, today()).map((p) => ({ ...p, top: distinctiveWords(p, entries, words) })).filter((p) => p.top.length);
  const out = [h('div', { class: 'st-eyebrow' }, 'Auffällige Wörter'),
    h('p', { class: 'hint left' }, 'Wörter, die in einem Zeitraum (Kapitel, sonst Quartal) deutlich häufiger vorkommen als im Rest des Streams.')];
  if (!ps.length) out.push(h('p', { class: 'hint left' }, 'Noch zu wenige Einträge (mindestens 3 pro Zeitraum).'));
  for (const p of ps) {
    const max = p.top[0].score;
    out.push(h('div', { class: 'st-words' },
      h('div', { class: 'st-words-label' }, p.label, h('small', {}, ` · ${plural(p.entries.length, 'Eintrag', 'Einträge')}`)),
      h('div', { class: 'st-words-list' }, ...p.top.map((w) => h('button', {
        type: 'button', class: 'st-word', style: `--w: ${(0.85 + 0.55 * (w.score / max)).toFixed(2)}`,
        title: `in ${w.count} Einträgen – als Faden unter Damals zeigen`,
        onclick: () => { st.mode = 'damals'; st.threadWord = w.word; st.threadPos = null; render(); window.scrollTo(0, document.body.scrollHeight); },
      }, w.word)))));
  }
  return out;
}

/* ---------- Modul ---------- */

function render() {
  const old = urls;
  urls = [];
  if (st.view === 'stream') renderStream(); else renderList();
  for (const u of old) URL.revokeObjectURL(u);
}

/** Betrifft die Änderung die aktuelle Ansicht? (Streams.md, Notizen des offenen Streams; Übersicht: alles) */
function relevant(ev) {
  if (st.view === 'list' || ev.reset || !ev.paths) return true;
  const s = streams()[st.idx];
  if (!s) return true;
  const shown = new Set([...root.querySelectorAll('[data-path]')].map((el) => el.dataset.path));
  const tag = s.tag.toLowerCase();
  return ev.paths.some((p) => {
    if (isStreamsConfig(p) || shown.has(p)) return true;
    const n = core.get(p);
    return !!n && n.tagsLower.some((t) => t === tag || t.startsWith(tag + '/'));
  });
}

export default {
  id: 'streams',
  title: 'Streams',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;
    root.classList.add('streams');
    window.addEventListener('popstate', () => {
      if (st.view === 'stream' && !(history.state && (history.state.streams || history.state.note))) { st.view = 'list'; render(); }
    });
    // Neu zeichnen nur bei passenden Änderungen und nie unter dem Finger oder während getippt wird
    view = stableView(root, { hold: () => !!root.querySelector('textarea:focus, input:focus') });
    let queued = false;
    core.on('change', (ev) => {
      if (root.hidden || queued || !relevant(ev)) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; view.request(render); });
    });
  },

  show() { render(); },
};
