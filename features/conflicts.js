// Fragen, die es im Vault schon gibt (VL-Editor und Diary → Schreiben): erkannt, sobald die Frage-Zeile verlassen
// wird, unterkringelt mit „!“ dahinter. Das „!“ öffnet ein Menü: Vorschau der vorhandenen Notiz, Zusammenführen bzw.
// als Antwort anhängen (ausgeführt beim Speichern), Umformulieren, Vorhandenes öffnen (Pop-up zum direkten Bearbeiten,
// speichert sofort). Die Logik ohne DOM (planSave, applyMerge) steht in studydoc.js.
import { h } from './dom.js';
import { createEditor } from './editor.js';
import { popMenu, closeMenu } from './qeditor.js';
import { parseQuestion, splitNote, normBody, setContent, titleProblem, dayOfNote } from './studydoc.js';
import { entryParts } from './streamsdoc.js';
import { dayToGerman } from './srs.js';

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
 *         rename(oldTitle, newTitle) → bool (Frage im Text umformulieren), onChange() (Markierungen/Entwurf/Hinweise
 *         neu, z. B. nach einer Entscheidung oder einer Änderung im Vault) }.
 */
export function createConflicts({ ui, mode, exclude = () => false, rename, onChange }) {
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

  /** Wo die Notiz steht: Ordner · Datum. */
  function where(n) {
    const dir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : 'oberster Ordner';
    const day = dayOfNote(n);
    return [dir, day != null ? dayToGerman(day) : null].filter(Boolean).join(' · ');
  }

  function preview(n) {
    const { body, answers } = entryParts(n.text);
    const last = answers.at(-1);
    return h('div', { class: 'qconf-preview' },
      h('div', { class: 'qconf-where' }, where(n)),
      body ? h('div', { class: 'qconf-body' }, body) : h('div', { class: 'qconf-where' }, '(kein Inhalt)'),
      last ? h('div', { class: 'qconf-answer' }, h('span', {}, `Neueste Antwort (${last.date}): `), last.text) : null,
      answers.length > 1 ? h('div', { class: 'qconf-where' }, `${answers.length} Antworten`) : null);
  }

  function openMenu(line, rect) {
    const q = parseQuestion(lineText(line));
    const ex = q && existing(q.title);
    if (!ex) return;
    const key = q.title.toLowerCase();
    const item = (label, onclick, attrs = {}) => h('button', { type: 'button', class: 'qmenu-item', role: 'menuitem', onclick, ...attrs }, label);
    const decide = (action) => {
      if (action) resolutions.set(key, action); else resolutions.delete(key);
      closeMenu();
      cm.refresh();
      onChange();
    };
    const chosen = resolutions.get(key);
    const showMain = (el) => el.replaceChildren(...[
      h('div', { class: 'qmenu-label' }, chosen ? `Gibt es schon – ${LABEL[chosen]}` : 'Diese Frage gibt es schon:'),
      preview(ex),
      ...ACTIONS[mode].map(([a, label, title]) => item(label, () => decide(a), { title, class: 'qmenu-item' + (a === chosen ? ' accent' : '') })),
      item('✎ Umformulieren', () => showRename(el)),
      item('📝 Vorhandenes öffnen', () => { closeMenu(); openExisting(ex); }),
      chosen ? h('div', { class: 'qmenu-sep' }) : null,
      chosen ? item('Entscheidung aufheben', () => decide(null)) : null].filter(Boolean));
    const showRename = (el) => {
      const input = h('input', { type: 'text', class: 'qmenu-input', value: q.title, 'aria-label': 'Frage umformulieren' });
      const ok = () => {
        const next = input.value.trim().replace(/\?+$/, '').trim();
        if (!next || next === q.title) { closeMenu(); return; }
        if (existing(next)) { ui.toast('Diese Frage gibt es auch schon', 3000); return; }
        if (rename(q.title, next)) closeMenu();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      el.replaceChildren(h('div', { class: 'qmenu-label' }, 'Frage umformulieren'), input,
        h('div', { class: 'qmenu-row' }, item('Abbrechen', closeMenu), item('Übernehmen', ok, { class: 'qmenu-item accent' })));
      setTimeout(() => { input.focus(); input.select(); });
    };
    popMenu(rect, showMain, 'qconf-menu');
  }

  /* ---------- Pop-up: vorhandene Notiz direkt bearbeiten ---------- */

  function openExisting(note) {
    const opened = note.text;
    const title = h('input', { type: 'text', class: 'qpop-title', value: note.title + '?', 'aria-label': 'Frage' });
    const host = h('div', { class: 'md-editor qpop-editor', 'aria-label': 'Inhalt' });
    const errEl = h('div', { class: 'qpop-err', hidden: true });
    const box = h('div', { class: 'qpop', role: 'dialog', 'aria-label': 'Vorhandene Frage bearbeiten' },
      h('div', { class: 'qpop-head' }, h('span', { class: 'qpop-where' }, where(note)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => close() }, '×')),
      title, host, errEl,
      h('div', { class: 'qpop-row' },
        h('button', { type: 'button', class: 'link', onclick: () => trash() }, '🗑 In den Papierkorb'),
        h('span', { class: 'qpop-gap' }),
        h('button', { type: 'button', class: 'btn small', onclick: () => save() }, 'Speichern')));
    const back = h('div', { class: 'qpop-back' }, box);
    const body = normBody(splitNote(note.text).content);
    const ed = createEditor({
      parent: host, doc: body,
      openLink: (t) => ui.openLink(t),
      resolveImage: (link) => ui.resolveImage(link, note.path),
      saveImage: ui.saveImage, spell: ui.spell, ai: ui.ai, tags: ui.tags,
    });
    let busy = false;
    const dirty = () => ed.value !== body || title.value.trim().replace(/\?+$/, '').trim() !== note.title;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const onPop = () => { if (back.isConnected) finish(); };

    function finish() {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('popstate', onPop);
      ed.destroy();
      back.remove();
      if (cm) { cm.refresh(); onChange(); }
    }
    function close(force = false) {
      if (!force && dirty() && !confirm('Änderungen an der vorhandenen Frage verwerfen?')) return;
      if (history.state && history.state.qpop) history.back(); // popstate schließt
      else finish();
    }
    const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

    async function save() {
      if (busy) return;
      const next = title.value.trim().replace(/\?+$/, '').trim();
      const problem = titleProblem(next);
      if (problem) return fail(problem);
      const renamed = next !== note.title;
      const other = renamed && byTitle(next).find((n) => n.path !== note.path);
      if (other) return fail(`„${next}?“ gibt es auch schon (${other.path})`);
      busy = true;
      try {
        const current = await core.read(note.path);
        if (current !== opened && !confirm('Die Notiz wurde inzwischen geändert. Trotzdem mit deinem Stand überschreiben?')) return;
        const text = setContent(current, ed.value);
        if (renamed) {
          const dir = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/') + 1) : '';
          const path = dir + next + '.md';
          if (path.toLowerCase() === note.path.toLowerCase()) { // nur Groß-/Kleinschreibung: über einen Zwischennamen
            const tmp = dir + next + ' (umbenennen).md';
            await core.create(tmp, text);
            await core.remove(note.path);
            await core.create(path, text);
            await core.remove(tmp);
          } else {
            await core.create(path, text);
            await core.remove(note.path);
          }
        } else if (text !== current) {
          await core.update(note.path, text);
        }
        ui.toast(renamed ? `Gespeichert ✓ – umbenannt in „${next}?“` : 'Gespeichert ✓');
        close(true);
      } catch (err) {
        fail('Speichern fehlgeschlagen: ' + err.message);
      } finally {
        busy = false;
      }
    }

    async function trash() {
      if (busy || !confirm(`„${note.title}?“ in den Papierkorb (.trash) verschieben?`)) return;
      busy = true;
      try {
        await core.trash(note.path);
        ui.toast('In den Papierkorb verschoben');
        close(true);
      } catch (err) {
        fail('Löschen fehlgeschlagen: ' + err.message);
      } finally {
        busy = false;
      }
    }

    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('popstate', onPop);
    history.pushState({ ...(history.state || {}), qpop: true }, '');
    document.body.append(back);
    setTimeout(() => ed.focus());
  }

  return {
    resolutions,
    existing,
    attach(editor) { cm = editor; },
    /** Editor geschlossen: nicht mehr auf Änderungen im Vault hören. */
    destroy() { off(); cm = null; closeMenu(); },

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
        onClick: openMenu,
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
