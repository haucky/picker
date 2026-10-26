// Fragen, die es im Vault schon gibt (VL-Editor und Diary → Schreiben): erkannt, sobald die Frage-Zeile verlassen
// wird, unterkringelt mit „!“ dahinter. Das „!“ öffnet die vorhandene Frage im Nebenfenster (peek.js: Frage, Tags,
// Inhalt direkt bearbeiten) und die Optionen: Zusammenführen bzw. als Antwort anhängen (ausgeführt beim Speichern) und
// Link einfügen. [[Links]] im Editor öffnen dasselbe Nebenfenster. Logik ohne DOM (planSave, applyMerge): studydoc.js.
import { h } from './dom.js';
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
 *         onChange() (Markierungen/Entwurf/Hinweise neu, z. B. nach einer Entscheidung oder einer Änderung im Vault) }.
 */
export function createConflicts({ ui, mode, exclude = () => false, onChange }) {
  const core = ui.core;
  const resolutions = new Map(); // Titel (klein) → Entscheidung
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
    attach(editor) { cm = editor; },
    /** Editor geschlossen: nicht mehr auf Änderungen im Vault hören. */
    destroy() { off(); cm = null; closeMenu(); closePeek(true); },
    /** Für den Editor: [[Link]] im Nebenfenster öffnen. */
    openLink: (target) => peekLink(target),

    /** Zeile mit dem Cursor wechselt: die verlassene Frage wird jetzt geprüft. */
    setActive(line) {
      if (line === active) return;
      active = line;
      cm?.refresh();
      onChange();
    },

    /** Markierungen für eine Frage-Zeile (nicht in der Zeile mit dem Cursor). */
    marks(q, line) {
      if (line === active || !cm) return [];
      const ex = existing(q.title);
      if (!ex) return [];
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
      return items.filter((it) => it.line !== active && existing(it.title) && !resolutions.has(it.title.toLowerCase()))
        .map((it) => ({ line: it.line, msg: `„${it.title}?“ gibt es schon – „!“ hinter der Frage antippen` }));
    },

    /** Für Entwürfe: [[Titel, Entscheidung]]. */
    toJSON() { return [...resolutions]; },
    load(entries) { resolutions.clear(); for (const [k, v] of entries || []) resolutions.set(k, v); },
    clear() { resolutions.clear(); },
  };
}
