// Fragen, die es im Vault schon gibt (VL-Editor und Diary → Schreiben): erkannt, sobald die Frage-Zeile verlassen
// wird, unterkringelt mit „!“ dahinter. Das „!“ öffnet die vorhandene Frage im Nebenfenster (peek.js: Frage, Tags,
// Inhalt direkt bearbeiten) und die Optionen: Zusammenführen bzw. als Antwort anhängen (ausgeführt beim Speichern) und
// Link einfügen. [[Links]] im Editor öffnen dasselbe Nebenfenster. Logik ohne DOM (planSave, applyMerge): studydoc.js.
//
// Ähnliche Fragen (anderer Name, gleiche Bedeutung): mit eingeschaltetem lokalem Server und berechneten Embeddings
// (similar.js) wird eine neue Frage beim Verlassen der Zeile mit den ähnlichsten vorhandenen verglichen; sagt das
// schnelle Sprachmodell „dieselbe Frage“, steht ein „≈“ dahinter – gleiche Optionen, aber es blockiert nichts.
import { h } from './dom.js';
import { loadStore, embedTitle, nearest, sameQuestion, textSimilarity, relatedTo } from './similar.js';
import { relatedRows } from './related.js';
import { localOn } from './llm.js';
import { popMenu, closeMenu, questionLines } from './qeditor.js';
import { parseQuestion, parseDayLine } from './studydoc.js';
import { openPeek, closePeek, peekBeside, inPeek } from './peek.js';

// Optionen je Modus: [Entscheidung, Beschriftung, Erklärung]
const ACTIONS = {
  vl: [
    ['merge', '↪ Zusammenführen', 'Beim Speichern wird dein Inhalt an die vorhandene Frage angehängt; sie bleibt in ihrer VL.'],
    ['here', '⇢ Zusammenführen und hierher holen', 'Wie Zusammenführen, und die vorhandene Frage zieht in diese VL um.'],
  ],
  diary: [
    ['answer', '↪ Als Antwort anhängen', 'Beim Speichern wird dein Text als Antwort mit Datum an den vorhandenen Eintrag gehängt (vermerkt als „noch einmal gefragt“).'],
  ],
};
const BADGE = { merge: '↪', here: '⇢', answer: '↪' };
const LABEL = { merge: 'wird zusammengeführt', here: 'wird zusammengeführt und hierher geholt', answer: 'wird als Antwort angehängt' };

/**
 * opts: { ui, mode: 'vl' | 'diary', exclude(note) → true für Notizen, die zum Dokument selbst gehören,
 *         isNew(title) → false für Fragen, die nicht auf Ähnlichkeit geprüft werden (z. B. schon gespeicherte der VL),
 *         pathOf(title) → Pfad einer schon gespeicherten Frage des Dokuments (für „↔ N“ verwandte Fragen) oder null,
 *         onChange() (Markierungen/Entwurf/Hinweise neu, z. B. nach einer Entscheidung oder einer Änderung im Vault) }.
 */
export function createConflicts({ ui, mode, exclude = () => false, isNew = () => true, pathOf = () => null, onChange }) {
  const core = ui.core;
  const resolutions = new Map(); // Titel (klein) → Entscheidung (gleicher Name)
  const similar = new Map();     // Titel (klein) → 'pending' | null (nichts) | { path, score } (ähnliche Frage)
  const simRes = new Map();      // Titel (klein) → { action, path } (Entscheidung bei ähnlicher Frage)
  const dismissed = new Set();   // Titel (klein): „keine Dublette“
  const checked = new Map();     // Titel (klein) → { at, text, title }: kurz angezeigtes Ergebnis einer Prüfung ohne Treffer
  const SHOW_CHECKED = 4000;
  const related = new Map();     // Pfad → [{ path, score }] verwandte Fragen der gespeicherten Fragen (aus den Embeddings)
  let relatedBusy = false;
  let store;                     // Promise der Embeddings (similar.js; Ergebnis null = noch keine berechnet)
  let storeMissingAt = 0;        // wann zuletzt keine gefunden wurden (erneut suchen höchstens alle 15 s)
  const noStoreShown = new Set(); // Titel (klein), bei denen der Hinweis „erst berechnen“ schon kam
  let cm = null;
  let active = -1;   // Zeile mit dem Cursor: dort wird (noch) nicht geprüft
  let index = null;  // Titel (klein) → [Notiz]
  const off = core.on('change', () => { index = null; if (cm) { cm.refresh(); onChange(); } });

  /** Alle Notizen mit diesem Titel (Groß-/Kleinschreibung egal). */
  function byTitle(title) {
    if (!index) {
      index = new Map();
      for (const n of core.list()) {
        const k = n.title.toLowerCase();
        if (!index.has(k)) index.set(k, []);
        index.get(k).push(n);
      }
    }
    return index.get(String(title).toLowerCase()) || [];
  }

  /** Notiz mit diesem Titel außerhalb des Dokuments oder null. */
  const existing = (title) => byTitle(title).find((n) => !exclude(n)) || null;

  const lineText = (line) => cm.value.split('\n')[line] || '';

  /** Fügt [[Titel]] als eigene Zeile ans Ende der Frage in Zeile `line` ein (vor der nächsten Frage/Datumszeile). */
  function insertLink(line, title) {
    const lines = cm.value.split('\n');
    const next = questionLines(lines).find((q) => q.line > line)?.line ?? lines.length;
    let end = lines.findIndex((l, i) => i > line && i < next && parseDayLine(l));
    if (end < 0) end = next;
    let last = end - 1;
    while (last > line && !lines[last].trim()) last--;
    const pos = lines.slice(0, last + 1).reduce((n, l) => n + l.length + 1, 0) - 1;
    const insert = '\n[[' + title + ']]';
    cm.view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, scrollIntoView: true });
    ui.toast(`Link auf „${title}?“ eingefügt`);
  }

  /** Optionen für die Frage in Zeile `line`, die es als `ex` schon gibt. */
  function optionsFor(line, q, ex) {
    const key = q.title.toLowerCase();
    const chosen = resolutions.get(key);
    const decide = (action) => {
      if (action) resolutions.set(key, action); else resolutions.delete(key);
      closeMenu();
      cm.refresh();
      onChange();
      if (!peekBeside()) showConflict(line); // Knöpfe im Fenster neu (Markierung)
    };
    return [
      ...ACTIONS[mode].map(([a, label, title]) => ({ label, title, accent: a === chosen, onClick: () => decide(a) })),
      { label: '🔗 Link einfügen', title: `[[${ex.title}]] ans Ende deiner Frage`, onClick: () => { closeMenu(); insertLink(line, ex.title); } },
      ...(chosen ? [{ label: 'Entscheidung aufheben', onClick: () => decide(null) }] : []),
    ];
  }

  /** Badge angetippt: vorhandene Frage im Nebenfenster, am Computer die Optionen als Menü daneben. */
  function showConflict(line, rect) {
    const q = parseQuestion(lineText(line));
    const ex = q && existing(q.title);
    if (!ex) return;
    const chosen = resolutions.get(q.title.toLowerCase());
    const options = optionsFor(line, q, ex);
    openPeek(ui, ex, {
      label: chosen ? `Gibt es schon – ${LABEL[chosen]}` : 'Gibt es schon',
      actions: options,
      openLink: peekLink,
      onSaved: () => { cm?.refresh(); onChange(); },
    });
    if (peekBeside() && rect) {
      popMenu(rect, (el) => el.replaceChildren(
        h('div', { class: 'qmenu-label' }, chosen ? `Gibt es schon – ${LABEL[chosen]}` : 'Diese Frage gibt es schon:'),
        ...options.map((o) => h('button', {
          type: 'button', role: 'menuitem', class: 'qmenu-item' + (o.accent ? ' accent' : ''), title: o.title || '', onclick: o.onClick,
        }, o.label))), 'qconf-menu', inPeek);
    }
  }

  /* ---------- Ähnliche Fragen ---------- */

  /** Ähnliche vorhandene Frage (vom Sprachmodell bestätigt) oder null. */
  /** Zeile der Frage `title` im Dokument (Groß-/Kleinschreibung egal) oder -1. */
  const docLine = (title) => questionLines(cm ? cm.value.split('\n') : [])
    .find((q) => q.title.toLowerCase() === title.toLowerCase())?.line ?? -1;

  /**
   * Ähnliche vorhandene Frage (vom Sprachmodell bestätigt) oder null: { note, score, inDoc }. `inDoc` = die Frage
   * gehört zum Dokument selbst (z. B. eine andere Frage derselben VL) – dann nur, solange sie noch im Text steht.
   */
  function similarTo(title) {
    const key = title.toLowerCase();
    const m = similar.get(key);
    if (!m || m === 'pending' || dismissed.has(key)) return null;
    const note = core.get(m.path);
    if (!note) return null;
    const inDoc = exclude(note);
    return !inDoc || docLine(note.title) >= 0 ? { note, score: m.score, inDoc } : null;
  }

  /** Ergebnis ohne Treffer kurz hinter der Frage zeigen (✓ bzw. Hinweis), dann wieder ausblenden. */
  function flash(key, text, title) {
    checked.set(key, { at: Date.now(), text, title });
    setTimeout(() => cm?.refresh(), SHOW_CHECKED + 50);
  }

  /** Fast gleich geschriebene vorhandene Frage (Tippfehler, ≥ 85 % gleiche Zeichen) – ohne KI, sofort. */
  function typoMatch(title) {
    const key = title.toLowerCase();
    let best = null;
    for (const n of core.list()) {
      const t = n.title.toLowerCase();
      if (t === key || Math.abs(t.length - key.length) > Math.max(t.length, key.length) * 0.15) continue;
      if (exclude(n) && docLine(n.title) < 0) continue;
      const score = textSimilarity(title, n.title);
      if (score >= 0.85 && (!best || score > best.score)) best = { path: n.path, score };
    }
    return best;
  }

  /**
   * Neue Frage prüfen (im Hintergrund): erst fast gleich geschriebene (ohne KI), dann mit lokalem Server
   * Embedding → ähnlichste vorhandene → Sprachmodell.
   */
  async function check(title) {
    const key = title.toLowerCase();
    if (similar.has(key) || existing(title) || !isNew(title)) return;
    const typo = typoMatch(title);
    if (typo || !localOn()) { // ohne lokalen Server: nur die Tippfehler-Prüfung, still
      similar.set(key, typo);
      if (typo && cm) { cm.refresh(); onChange(); }
      return;
    }
    similar.set(key, 'pending');
    cm?.refresh(); // Ladeanzeige hinter der Frage
    let found = null;
    try {
      if (store === undefined || (storeMissingAt && Date.now() - storeMissingAt > 15000)) {
        storeMissingAt = 0;
        store = loadStore(core).catch(() => null);
      }
      const st = await store;
      if (!st) {
        storeMissingAt ||= Date.now();
        if (!noStoreShown.has(key)) flash(key, 'i', 'Ähnliche Fragen: erst unter Settings → Ähnliche Fragen „Berechnen & vergleichen“');
        noStoreShown.add(key);
        similar.delete(key); // später nochmal prüfen, wenn es Vektoren gibt
        cm?.refresh();
        return;
      } else {
        const vec = await embedTitle(st, title);
        // Kandidaten: alle gespeicherten Fragen außer dieser selbst; Fragen des Dokuments nur, wenn sie noch im Text stehen
        const cands = nearest(st, vec, { skip: (path) => {
          const n = core.get(path);
          return !n || n.title.toLowerCase() === key || (exclude(n) && docLine(n.title) < 0);
        } });
        for (const c of cands) {
          if (await sameQuestion(title, core.get(c.path).title)) { found = { path: c.path, score: c.score }; break; }
        }
        if (!found) flash(key, '✓', cands.length ? `Keine gleiche Frage (${cands.length} ähnliche geprüft)` : 'Keine ähnliche Frage gefunden');
      }
    } catch (err) {
      flash(key, '⚠', 'Prüfung nicht möglich: ' + (err.message || err.name));
    }
    similar.set(key, found);
    if (cm) { cm.refresh(); if (found) onChange(); }
  }

  /* ---------- Verwandte Fragen (gespeicherte, „↔ N“) ---------- */

  /** Verwandte Fragen für alle gespeicherten Fragen des Dokuments berechnen, die noch fehlen (im Hintergrund). */
  async function ensureRelated() {
    if (relatedBusy || !cm) return;
    const paths = questionLines(cm.value.split('\n')).map((q) => pathOf(q.title)).filter((p) => p && !related.has(p));
    if (!paths.length) return;
    relatedBusy = true;
    try {
      for (const p of paths) {
        related.set(p, await relatedTo(core, p));
        await new Promise((r) => setTimeout(r)); // Editor bedienbar lassen
      }
    } finally {
      relatedBusy = false;
    }
    cm?.refresh();
  }

  function showRelated(line, rect) {
    const q = parseQuestion(lineText(line));
    const list = q && related.get(pathOf(q.title));
    if (!list?.length) return;
    const pick = (n) => {
      closeMenu();
      const at = exclude(n) ? docLine(n.title) : -1;
      if (at >= 0) cm.jumpToLine(at); // steht hier im Editor
      else openPeek(ui, n, { label: 'Verwandt', openLink: peekLink, onSaved: () => { cm?.refresh(); onChange(); } });
    };
    popMenu(rect || { left: 16, bottom: 80 }, (el) => el.replaceChildren(
      h('div', { class: 'qmenu-label' }, `Verwandte Fragen (${list.length})`),
      ...relatedRows(core, q.title, list, pick)), 'qconf-menu rel-menu', inPeek);
  }

  // Prüfungen nacheinander (nicht parallel), damit der lokale Server nicht mehrere auf einmal rechnen muss
  let queue = Promise.resolve();
  const queued = new Set(); // Titel (klein), die auf ihre Prüfung warten (Ladeanzeige schon sichtbar)
  const enqueue = (title) => {
    queued.add(title.toLowerCase());
    queue = queue.then(() => { queued.delete(title.toLowerCase()); return check(title); });
  };

  /** Alle neuen, noch nicht geprüften Fragen außerhalb der Cursor-Zeile prüfen (auch eingefügte). */
  function checkLeft() {
    if (!cm) return;
    const lines = cm.value.split('\n');
    for (const q of questionLines(lines)) {
      if (q.line === active) continue;
      const key = q.title.toLowerCase();
      if (similar.has(key) || queued.has(key) || existing(q.title) || !isNew(q.title)) continue;
      enqueue(q.title);
    }
  }

  function showSimilar(line, rect) {
    const q = parseQuestion(lineText(line));
    const sim = q && similarTo(q.title);
    if (!sim) return;
    const key = q.title.toLowerCase();
    const scoreText = sim.score.toFixed(2).replace('.', ',');
    if (sim.inDoc) { // steht hier im Editor: kein Nebenfenster, kein Zusammenführen – hinspringen
      const at = docLine(sim.note.title);
      const item = (label, onclick) => h('button', { type: 'button', role: 'menuitem', class: 'qmenu-item', onclick }, label);
      popMenu(rect || { left: 16, bottom: 80 }, (el) => el.replaceChildren(
        h('div', { class: 'qmenu-label' }, `Ähnliche Frage hier im Text (${scoreText}): „${sim.note.title}?“`),
        item(`↧ Zur Frage springen (Zeile ${at + 1})`, () => { closeMenu(); cm.jumpToLine(at); }),
        item('🔗 Link einfügen', () => { closeMenu(); insertLink(line, sim.note.title); }),
        item('✕ Keine Dublette', () => { dismissed.add(key); closeMenu(); cm.refresh(); onChange(); })), 'qconf-menu');
      return;
    }
    const chosen = simRes.get(key)?.path === sim.note.path ? simRes.get(key).action : null;
    const decide = (action) => {
      if (action) simRes.set(key, { action, path: sim.note.path }); else simRes.delete(key);
      closeMenu();
      cm.refresh();
      onChange();
      if (!peekBeside()) showSimilar(line);
    };
    const label = `Ähnlich (${sim.score.toFixed(2).replace('.', ',')})` + (chosen ? ` – ${LABEL[chosen]}` : '');
    const options = [
      ...ACTIONS[mode].map(([a, text, title]) => ({ label: text, title, accent: a === chosen, onClick: () => decide(a) })),
      { label: '🔗 Link einfügen', title: `[[${sim.note.title}]] ans Ende deiner Frage`, onClick: () => { closeMenu(); insertLink(line, sim.note.title); } },
      { label: '✕ Keine Dublette', title: 'Hinweis ausblenden', onClick: () => { dismissed.add(key); simRes.delete(key); closeMenu(); closePeek(); cm.refresh(); onChange(); } },
      ...(chosen ? [{ label: 'Entscheidung aufheben', onClick: () => decide(null) }] : []),
    ];
    openPeek(ui, sim.note, { label, actions: options, openLink: peekLink, onSaved: () => { cm?.refresh(); onChange(); } });
    if (peekBeside() && rect) {
      popMenu(rect, (el) => el.replaceChildren(
        h('div', { class: 'qmenu-label' }, `Ähnliche Frage gibt es schon (${sim.score.toFixed(2).replace('.', ',')}):`),
        ...options.map((o) => h('button', {
          type: 'button', role: 'menuitem', class: 'qmenu-item' + (o.accent ? ' accent' : ''), title: o.title || '', onclick: o.onClick,
        }, o.label))), 'qconf-menu', inPeek);
    }
  }

  /** [[Link]] im Editor angetippt: verlinkte Notiz im Nebenfenster (wie Obsidian: Pfad, sonst Dateiname). */
  function peekLink(target) {
    const want = String(target).split('#')[0].trim().toLowerCase().replace(/\.md$/, '');
    if (!want) return;
    const notes = core.list();
    const hit = notes.find((n) => n.path.toLowerCase().replace(/\.md$/, '') === want)
      || notes.filter((n) => n.nameLower === want.split('/').at(-1) || n.title.toLowerCase() === want.split('/').at(-1))
        .sort((a, b) => a.path.length - b.path.length)[0];
    if (!hit) { ui.toast(`„${target}“ nicht gefunden`); return; }
    closeMenu();
    openPeek(ui, hit, { openLink: peekLink, onSaved: () => { cm?.refresh(); onChange(); } });
  }

  return {
    resolutions,
    existing,
    attach(editor) { cm = editor; setTimeout(ensureRelated); },
    /** Editor geschlossen: nicht mehr auf Änderungen im Vault hören. */
    destroy() { off(); cm = null; closeMenu(); closePeek(true); },
    /** Für planSave: ähnliche Frage, bei der zusammengeführt bzw. angehängt werden soll → { path, action } oder null. */
    similarMerge(title) {
      const sim = similarTo(title);
      const r = simRes.get(title.toLowerCase());
      return sim && !sim.inDoc && r && r.path === sim.note.path ? r : null;
    },
    /** Für den Editor: [[Link]] im Nebenfenster öffnen. */
    openLink: (target) => peekLink(target),

    /** Zeile mit dem Cursor wechselt: die verlassene Frage wird jetzt geprüft. */
    setActive(line) {
      if (line === active) return;
      active = line;
      checkLeft(); // u. a. die gerade verlassene Frage auf ähnliche prüfen
      ensureRelated();
      cm?.refresh();
      onChange();
    },

    /** Markierungen für eine Frage-Zeile (nicht in der Zeile mit dem Cursor). */
    marks(q, line) {
      if (line === active || !cm) return [];
      const ex = isNew(q.title) ? existing(q.title) : null; // gespeicherte Fragen des Dokuments: kein „gibt es schon“
      if (!ex) {
        const key = q.title.toLowerCase();
        if (similar.get(key) === 'pending' || queued.has(key)) {
          return [{ line, badge: { at: q.tagsAt, text: '', class: 'checking', title: 'Suche ähnliche Fragen …', onClick: () => {} } }];
        }
        const sim = similarTo(q.title);
        const c = checked.get(key);
        if (!sim && c && Date.now() - c.at < SHOW_CHECKED) {
          return [{ line, badge: { at: q.tagsAt, text: c.text, class: 'checked', title: c.title, onClick: () => ui.toast(c.title, 4000) } }];
        }
        if (!sim) {
          const rel = related.get(pathOf(q.title));
          if (!rel?.length) return [];
          return [{ line, badge: {
            at: q.tagsAt, text: '↔ ' + rel.length, class: 'related', title: `${rel.length} verwandte Fragen – antippen`, onClick: showRelated,
          } }];
        }
        const r = simRes.get(q.title.toLowerCase());
        const res = r && r.path === sim.note.path ? r.action : null;
        return [{ line, badge: {
          at: q.tagsAt, text: res ? BADGE[res] : '≈', class: res ? 'resolved' : 'similar',
          title: res ? `Ähnlich zu „${sim.note.title}?“ – ${LABEL[res]}`
            : `Ähnlich zu „${sim.note.title}?“${sim.inDoc ? ' (hier im Text)' : ''} – antippen`,
          onClick: showSimilar,
        } }];
      }
      const res = resolutions.get(q.title.toLowerCase());
      const out = [];
      if (!res) out.push({ line, from: 0, to: q.tagsAt, class: 'cm-conflict' });
      out.push({ line, badge: {
        at: q.tagsAt, text: res ? BADGE[res] : '!', class: res ? 'resolved' : 'open',
        title: res ? `Gibt es schon – ${LABEL[res]} (antippen zum Ändern)` : `Gibt es schon (${ex.path}) – antippen für Optionen`,
        onClick: showConflict,
      } });
      return out;
    },

    /** Hinweise für die Fehlerliste: Fragen, die es schon gibt, ohne Entscheidung (nicht in der Zeile mit dem Cursor). */
    issues(items) {
      return items.filter((it) => it.line !== active && isNew(it.title) && existing(it.title) && !resolutions.has(it.title.toLowerCase()))
        .map((it) => ({ line: it.line, msg: `„${it.title}?“ gibt es schon – „!“ hinter der Frage antippen` }));
    },

    /** Für Entwürfe: Entscheidungen (gleicher Name, ähnliche Fragen) und „keine Dublette“. */
    toJSON() { return { res: [...resolutions], sim: [...simRes], dismissed: [...dismissed] }; },
    load(data) {
      resolutions.clear(); simRes.clear(); dismissed.clear();
      const d = Array.isArray(data) ? { res: data } : data || {}; // früher nur die Liste der Entscheidungen
      for (const [k, v] of d.res || []) resolutions.set(k, v);
      for (const [k, v] of d.sim || []) simRes.set(k, v);
      for (const k of d.dismissed || []) dismissed.add(k);
    },
    clear() { resolutions.clear(); simRes.clear(); dismissed.clear(); similar.clear(); related.clear(); store = undefined; setTimeout(ensureRelated); },
  };
}
