// Feature: TILs durchscrollen und #diary/…-Tags zuweisen; Schreiben erst nach Bestätigung.
import { addTagsToText } from '../core.js';
import { h } from './dom.js';

const PREFIX = 'diary/';
const DEFAULT_FILTER = '#life/diary';
const TOP_N = 5;
const PAGE = 40;
const MAX_SUGGEST = 6;
const STATE_KEY = 'tagging';

let ui, core;
let root, listEl, sentinel, countEl, filterInput, untaggedBox, tagList, bar, barText, reviewEl, mainEl;

// Persistierter Zustand der Sitzung
const state = {
  filter: DEFAULT_FILTER,
  untaggedOnly: true,
  pending: new Map(),   // path -> [tag, …] (volle Tags ohne '#', z. B. "diary/reise")
  sessionTags: [],      // in dieser Sitzung neu eingetippte Tags, neueste zuerst
};

let items = [];         // gefilterte, sortierte Notizen
let shown = 0;          // Anzahl gerenderter Einträge
const rows = new Map(); // path -> { li, picks }
let topTags = [];
let loaded = false;

/* ---------- Zustand ---------- */

// Sofort speichern (nicht verzögert), damit beim Schließen der App kein Tipp verloren geht.
function saveState() {
  core.kv.set(STATE_KEY, {
    filter: state.filter,
    untaggedOnly: state.untaggedOnly,
    pending: [...state.pending],
    sessionTags: state.sessionTags,
  }).catch(() => {});
}

async function loadState() {
  try {
    const s = await core.kv.get(STATE_KEY);
    if (s) {
      state.filter = s.filter ?? DEFAULT_FILTER;
      state.untaggedOnly = s.untaggedOnly ?? true;
      state.pending = new Map(s.pending || []);
      state.sessionTags = s.sessionTags || [];
    }
  } catch { /* egal */ }
}

/* ---------- Tags ---------- */

const isDiary = (t) => t.toLowerCase().startsWith(PREFIX) && t.length > PREFIX.length;
const label = (t) => t.slice(PREFIX.length);
const sameTag = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Alle #diary/…-Tags im Vault mit Häufigkeit, häufigste zuerst. */
function diaryTagCounts() {
  const counts = new Map(); // lower -> { tag, n }
  for (const n of core.notes.values()) {
    for (const t of n.tags) {
      if (!isDiary(t)) continue;
      const k = t.toLowerCase();
      const e = counts.get(k);
      if (e) e.n++; else counts.set(k, { tag: t, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, 'de'));
}

/** Schnellauswahl: Sitzungs-Tags zuerst, dann die häufigsten Tags. */
function quickTags() {
  const out = [...state.sessionTags];
  for (const t of topTags) if (!out.some((x) => sameTag(x, t))) out.push(t);
  return out;
}

/** Eingabe → voller Tag "diary/…" oder null. */
function normalize(input) {
  let v = input.trim().replace(/^#/, '');
  if (v.toLowerCase().startsWith(PREFIX)) v = v.slice(PREFIX.length);
  v = v.replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_\-/]/gu, '').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '');
  if (!v || !/[\p{L}_-]/u.test(v)) return null;
  const tag = PREFIX + v;
  // Schreibweise eines bereits existierenden Tags übernehmen
  const existing = diaryTagCounts().find((e) => sameTag(e.tag, tag)) || state.sessionTags.find((t) => sameTag(t, tag));
  return existing ? existing.tag || existing : tag;
}

function assigned(path) {
  return state.pending.get(path) || [];
}

function toggle(path, tag, on) {
  let tags = assigned(path).filter((t) => !sameTag(t, tag));
  if (on) tags.push(tag);
  if (tags.length) state.pending.set(path, tags); else state.pending.delete(path);
  saveState();
  renderPicks(path);
  renderBar();
}

function addNewTag(path, input) {
  const tag = normalize(input);
  if (!tag) { ui.toast('Ungültiger Tag'); return false; }
  if (!quickTags().some((t) => sameTag(t, tag))) {
    state.sessionTags.unshift(tag);
    for (const p of rows.keys()) renderPicks(p);
  }
  const note = core.get(path);
  if (!note.tagsLower.includes(tag.toLowerCase())) toggle(path, tag, true);
  return true;
}

/* ---------- Liste ---------- */

function filterKey() {
  return state.filter.trim().replace(/^#/, '').replace(/\/+$/, '').toLowerCase();
}

function computeItems() {
  const f = filterKey();
  return core.list()
    .filter((n) => !f || n.tagsLower.some((t) => t === f || t.startsWith(f + '/')))
    .filter((n) => !state.untaggedOnly || !n.tags.some(isDiary))
    .sort((a, b) => (b.date ?? b.mtime) - (a.date ?? a.mtime) || a.nameLower.localeCompare(b.nameLower, 'de'));
}

function rebuild() {
  topTags = diaryTagCounts().slice(0, TOP_N).map((e) => e.tag);
  items = computeItems();
  rows.clear();
  shown = 0;
  listEl.replaceChildren();
  countEl.textContent = `${items.length} TIL${items.length === 1 ? '' : 's'}`;
  if (!items.length) {
    listEl.append(h('li', { class: 'empty' },
      core.syncing && !core.notes.size ? 'Index wird aufgebaut …' : 'Keine passenden TILs.'));
  }
  renderMore();
  renderBar();
}

function renderMore() {
  const end = Math.min(items.length, shown + PAGE);
  for (; shown < end; shown++) listEl.append(row(items[shown]));
  sentinel.hidden = shown >= items.length;
}

function formatDate(n) {
  if (n.date != null) return new Date(n.date).toLocaleDateString('de-DE', { timeZone: 'UTC' });
  return new Date(n.mtime).toLocaleDateString('de-DE') + ' (Datei)';
}

function bodyText(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines.length && /^\s*#[^\s#]/.test(lines[0])) lines.shift();
  return lines.join('\n').replace(/^\s*\n/, '');
}

function preview(text) {
  return bodyText(text).split('\n')
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean).slice(0, 4).join(' · ');
}

function row(n) {
  const picks = h('div', { class: 'picks' });
  const body = h('div', { class: 'til-body' });
  const otherTags = n.tags.filter((t) => !t.toLowerCase().startsWith('date/'));

  const renderBody = (expanded) => {
    body.replaceChildren();
    if (expanded) {
      body.append(
        h('div', { class: 'til-full' }, bodyText(n.text)),
        h('button', { type: 'button', class: 'link', onclick: () => ui.openNote(n.path) }, 'Im Editor öffnen'),
      );
    } else {
      body.append(h('div', { class: 'til-preview' }, preview(n.text)));
    }
  };
  let expanded = false;
  renderBody(false);

  const li = h('li', { class: 'til' },
    h('div', { class: 'til-main', onclick: () => { expanded = !expanded; renderBody(expanded); } },
      h('div', { class: 'til-title' }, n.title),
      h('div', { class: 'til-meta' }, formatDate(n),
        otherTags.length ? h('span', { class: 'til-tags' }, ' · ' + otherTags.map((t) => '#' + t).join(' ')) : null),
      body),
    picks);
  rows.set(n.path, { li, picks, note: n });
  renderPicks(n.path);
  return li;
}

function renderPicks(path) {
  const r = rows.get(path);
  if (!r) return;
  const note = core.get(path) || r.note;
  const mine = assigned(path);
  const tags = quickTags();
  for (const t of mine) if (!tags.some((x) => sameTag(x, t))) tags.push(t);

  const chips = tags.map((t) => {
    const have = note.tagsLower.includes(t.toLowerCase());
    const on = mine.some((x) => sameTag(x, t));
    return h('button', {
      type: 'button',
      class: 'chip' + (on ? ' on' : '') + (have ? ' have' : ''),
      disabled: have,
      title: '#' + t,
      'aria-pressed': on ? 'true' : 'false',
      onclick: () => toggle(path, t, !on),
    }, label(t));
  });
  const plus = h('button', { type: 'button', class: 'chip plus', 'aria-label': 'Neuen Tag eingeben',
    onclick: () => openInput(path, plus) }, '+ neu');
  r.picks.replaceChildren(...chips, plus);
}

function openInput(path, plus) {
  const input = h('input', { type: 'text', class: 'tag-input', placeholder: 'tag', autocapitalize: 'off',
    autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done', 'aria-label': 'Neuer Tag' });
  const sugg = h('div', { class: 'suggest' });
  const box = h('div', { class: 'tag-box' }, input, sugg);
  plus.replaceWith(box);

  const close = () => renderPicks(path);
  const commit = (value) => { if (addNewTag(path, value)) close(); else input.focus(); };
  const update = () => {
    const v = input.value.trim().replace(/^#/, '').toLowerCase().replace(/^diary\//, '');
    const all = diaryTagCounts().map((e) => e.tag);
    for (const t of state.sessionTags) if (!all.some((x) => sameTag(x, t))) all.push(t);
    const matches = all.filter((t) => label(t).toLowerCase().includes(v)).slice(0, MAX_SUGGEST);
    sugg.replaceChildren(...matches.map((t) => h('button', {
      type: 'button', class: 'sugg',
      // pointerdown statt click, damit das Eingabefeld nicht vorher per blur schließt
      onpointerdown: (e) => { e.preventDefault(); commit(t); },
    }, label(t))));
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim()) commit(input.value); else close(); }
    if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(() => { if (box.isConnected) close(); }, 150));
  update();
  input.focus();
}

/* ---------- Bestätigen ---------- */

function renderBar() {
  const files = state.pending.size;
  const tags = [...state.pending.values()].reduce((s, t) => s + t.length, 0);
  bar.hidden = !files || !reviewEl.hidden;
  barText.textContent = `${files} TIL${files === 1 ? '' : 's'} · ${tags} Tag${tags === 1 ? '' : 's'}`;
}

function sortedPending() {
  return [...state.pending.keys()]
    .map((p) => core.get(p) || { path: p, title: p.split('/').at(-1).replace(/\.md$/i, ''), mtime: 0, date: null })
    .sort((a, b) => (b.date ?? b.mtime) - (a.date ?? a.mtime));
}

function openReview() {
  mainEl.hidden = true;
  reviewEl.hidden = false;
  renderBar();
  window.scrollTo(0, 0);
  renderReview();
}

function closeReview() {
  reviewEl.hidden = true;
  mainEl.hidden = false;
  rebuild();
}

function renderReview() {
  const list = sortedPending().map((n) => h('li', { class: 'review-item' },
    h('div', { class: 'til-title' }, n.title),
    h('div', { class: 'review-tags' }, ...assigned(n.path).map((t) => h('button', {
      type: 'button', class: 'chip on', title: 'Entfernen',
      onclick: () => { toggle(n.path, t, false); state.pending.size ? renderReview() : closeReview(); },
    }, label(t) + ' ×')))));
  const n = state.pending.size;
  reviewEl.replaceChildren(
    h('header', { class: 'bar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Zurück', onclick: closeReview }, '←'),
      h('h1', {}, 'Änderungen prüfen')),
    h('p', { class: 'hint left' }, 'Die Tags werden an die erste Zeile der jeweiligen Datei angehängt. Antippen entfernt eine Zuweisung.'),
    h('ol', { class: 'review' }, ...list),
    h('button', { type: 'button', class: 'btn', onclick: write }, `${n} Datei${n === 1 ? '' : 'en'} schreiben`),
  );
}

async function write(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Schreibe …';
  const ok = [];
  const external = [];
  const failed = [];
  for (const [path, tags] of [...state.pending]) {
    try {
      const res = await core.update(path, (text) => addTagsToText(text, tags));
      ok.push(path);
      if (res.changedExternally) external.push(path);
      state.pending.delete(path);
    } catch (err) {
      failed.push({ path, msg: err.message });
      if (err.name === 'NotAllowedError') break;
    }
  }
  if (!state.pending.size) state.sessionTags = []; // Sitzung beendet
  saveState();

  reviewEl.replaceChildren(...[
    h('header', { class: 'bar' }, h('h1', {}, 'Fertig')),
    h('p', {}, `${ok.length} TIL${ok.length === 1 ? '' : 's'} aktualisiert.`),
    external.length ? h('div', { class: 'notice' },
      h('strong', {}, 'Zwischenzeitlich geändert:'),
      h('p', {}, 'Diese Dateien wurden seit dem Einlesen verändert. Die Tags wurden auf den aktuellen Stand gesetzt.'),
      h('ul', {}, ...external.map((p) => h('li', {}, p)))) : null,
    failed.length ? h('div', { class: 'notice' },
      h('strong', {}, 'Nicht geschrieben (bleiben vorgemerkt):'),
      h('ul', {}, ...failed.map((f) => h('li', {}, `${f.path}: ${f.msg}`)))) : null,
    h('button', { type: 'button', class: 'btn', onclick: closeReview }, 'Zurück zur Liste'),
  ].filter(Boolean));
}

/* ---------- Modul ---------- */

export default {
  id: 'tagging',
  title: 'Taggen',

  mount(_root, _ui) {
    root = _root;
    ui = _ui;
    core = ui.core;

    filterInput = h('input', { type: 'search', class: 'filter', list: 'tagging-tags', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false', placeholder: '#tag', 'aria-label': 'Nach Tag filtern' });
    tagList = h('datalist', { id: 'tagging-tags' });
    untaggedBox = h('input', { type: 'checkbox' });
    countEl = h('span', { class: 'count' });
    listEl = h('ol', { class: 'tils' });
    sentinel = h('div', { class: 'sentinel' });
    barText = h('span', {});
    bar = h('div', { class: 'confirm-bar', hidden: true }, barText,
      h('button', { type: 'button', class: 'btn small', onclick: openReview }, 'Prüfen & bestätigen'));
    reviewEl = h('div', { class: 'review-view', hidden: true });
    mainEl = h('div', {},
      h('div', { class: 'tag-head' },
        filterInput, tagList,
        h('div', { class: 'tag-head-row' },
          h('label', { class: 'toggle' }, untaggedBox, ' nur ohne #diary/…'),
          countEl)),
      listEl, sentinel);
    root.append(mainEl, reviewEl, bar);

    let timer;
    filterInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.filter = filterInput.value; saveState(); rebuild(); }, 200);
    });
    filterInput.addEventListener('focus', () => {
      const all = new Set();
      for (const n of core.notes.values()) for (const t of n.tags) all.add('#' + t);
      tagList.replaceChildren(...[...all].sort().map((t) => h('option', { value: t })));
    });
    untaggedBox.addEventListener('change', () => { state.untaggedOnly = untaggedBox.checked; saveState(); rebuild(); });

    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) renderMore();
    }, { rootMargin: '600px' }).observe(sentinel);

    // Änderungen aus dem Abgleich: betroffene Zeilen aktualisieren, Liste nicht neu aufbauen (Scrollposition bleibt).
    let rebuildQueued = false;
    core.on('change', (ev) => {
      if (!loaded || root.hidden) return;
      if (ev.reset || !items.length) {
        if (!rebuildQueued) {
          rebuildQueued = true;
          requestAnimationFrame(() => { rebuildQueued = false; if (reviewEl.hidden) rebuild(); });
        }
        return;
      }
      for (const p of ev.paths || []) {
        const r = rows.get(p);
        if (!r) continue;
        const n = core.get(p);
        if (!n) { r.li.remove(); rows.delete(p); continue; }
        const fresh = row(n);
        r.li.replaceWith(fresh);
      }
    });

    loadState().then(() => {
      loaded = true;
      filterInput.value = state.filter;
      untaggedBox.checked = state.untaggedOnly;
      if (!root.hidden) rebuild();
    });
  },

  show() {
    if (loaded && reviewEl.hidden) rebuild();
  },
};
