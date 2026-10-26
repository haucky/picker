// Nebenfenster für eine vorhandene Notiz neben dem Fragen-Editor (VL-Editor, Diary → Schreiben): Frage, Tag-Zeile und
// Inhalt direkt bearbeiten, Speichern (sofort, nur diese Notiz) oder in den Papierkorb. Kein Overlay – der Editor
// daneben bleibt bedienbar. Am Computer rechts am Rand, auf dem Handy unten als halbhohes Fenster; dort stehen auch
// die Knöpfe (z. B. Zusammenführen), die am Computer im Menü am „!“ stehen. Es gibt immer nur ein Nebenfenster.
import { parseTags } from '../core.js';
import { h } from './dom.js';
import { createEditor } from './editor.js';
import { splitNote, normBody, setContent, setTagLine, tagLineTags, titleProblem, contextOf } from './studydoc.js';

const wide = matchMedia('(min-width: 900px)');
let cur = null; // { note, el, ed, tagsEd, title, opened, body, tagsText, onClose }

/** Am Computer (breites Fenster): Nebenfenster rechts, Optionen im Menü daneben; sonst unten mit Optionen darin. */
export const peekBeside = () => wide.matches;

export const peekOpen = () => !!cur;

/** Liegt das Element im Nebenfenster (z. B. damit ein Menü bei Klicks dort offen bleibt)? */
export const inPeek = (node) => !!cur && cur.el.contains(node);

const isDirty = () => !!cur && (cur.ed.value !== cur.body || cur.tagsEd.value.trim() !== cur.tagsText ||
  cur.title.value.trim().replace(/\?+$/, '').trim() !== cur.note.title);


/** Nebenfenster abbauen (ohne Rückfrage und ohne den Verlaufseintrag anzufassen). */
function teardown() {
  const c = cur;
  cur = null;
  c.ed.destroy();
  c.tagsEd.destroy();
  c.el.remove();
  document.body.classList.remove('peek-open');
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('popstate', onPop);
  return c;
}

/** Schließt das Nebenfenster; bei ungespeicherten Änderungen erst nach Rückfrage (außer `force`). Gibt true zurück, wenn zu. */
export function closePeek(force = false) {
  if (!cur) return true;
  if (!force && isDirty() && !confirm('Änderungen an der vorhandenen Frage verwerfen?')) return false;
  const c = teardown();
  if (history.state && history.state.peek) history.back();
  c.onClose?.();
  return true;
}

function onKey(e) {
  if (e.key === 'Escape' && cur && cur.el.contains(document.activeElement)) { e.preventDefault(); closePeek(); }
}

// Zurück-Geste schließt das Nebenfenster (der Verlaufseintrag ist dann schon weg)
function onPop() {
  if (!cur || (history.state && history.state.peek)) return;
  if (isDirty() && !confirm('Änderungen an der vorhandenen Frage verwerfen?')) {
    history.pushState({ ...(history.state || {}), peek: true }, '');
    return;
  }
  teardown().onClose?.();
}

/**
 * Öffnet `note` im Nebenfenster (ersetzt ein offenes, nach Rückfrage bei Änderungen).
 * opts: { label (Zeile oben, z. B. „Diese Frage gibt es schon“), actions: [{ label, title, accent, onClick }] (nur auf
 *         dem Handy im Fenster; am Computer zeigt sie der Aufrufer im Menü), openLink(target) (Klick auf [[Link]] im
 *         Inhalt), onSaved(path), onClose() }.
 */
export function openPeek(ui, note, opts = {}) {
  if (cur) { // anderes Nebenfenster ersetzen; der Verlaufseintrag bleibt
    if (isDirty() && !confirm('Änderungen an der vorhandenen Frage verwerfen?')) return;
    teardown();
  }
  const core = ui.core;
  const title = h('input', { type: 'text', class: 'qpop-title', value: note.title + '?', 'aria-label': 'Frage' });
  const tagsHost = h('div', { class: 'md-editor peek-tags', 'aria-label': 'Tags' });
  const host = h('div', { class: 'md-editor qpop-editor', 'aria-label': 'Inhalt' });
  const errEl = h('div', { class: 'qpop-err', hidden: true });
  const actions = !peekBeside() && opts.actions?.length
    ? h('div', { class: 'peek-actions' }, ...opts.actions.map((a) =>
      h('button', { type: 'button', class: 'btn small' + (a.accent ? ' on' : ''), title: a.title || '', onclick: a.onClick }, a.label)))
    : null;
  const el = h('aside', { class: 'peek', role: 'dialog', 'aria-label': 'Vorhandene Frage' },
    h('div', { class: 'qpop-head' },
      h('span', { class: 'qpop-where' }, opts.label ? h('strong', {}, opts.label + ' · ') : null, contextOf(note)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: () => closePeek() }, '×')),
    actions, title, tagsHost, host, errEl,
    h('div', { class: 'qpop-row' },
      h('button', { type: 'button', class: 'link', onclick: () => trash() }, '🗑 In den Papierkorb'),
      h('span', { class: 'qpop-gap' }),
      h('button', { type: 'button', class: 'btn small', onclick: () => save() }, 'Speichern')));

  const body = normBody(splitNote(note.text).content);
  const tagsText = tagLineTags(note.text).map((t) => '#' + t).join(' ');
  const shared = { saveImage: ui.saveImage, spell: ui.spell, ai: ui.ai, tags: ui.tags };
  const openLink = (t) => (opts.openLink ? opts.openLink(t) : ui.openLink(t));
  const tagsEd = createEditor({ parent: tagsHost, doc: tagsText, placeholder: '#tags', tags: ui.tags, openLink });
  const ed = createEditor({ parent: host, doc: body, openLink, resolveImage: (link) => ui.resolveImage(link, note.path), ...shared });
  cur = { note, el, ed, tagsEd, title, opened: note.text, body, tagsText, onClose: opts.onClose };

  let busy = false;
  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

  async function save() {
    if (busy) return;
    const next = title.value.trim().replace(/\?+$/, '').trim();
    const problem = titleProblem(next);
    if (problem) return fail(problem);
    const renamed = next !== note.title;
    const other = renamed && core.list().find((n) => n.path !== note.path && n.title.toLowerCase() === next.toLowerCase());
    if (other) return fail(`„${next}?“ gibt es auch schon (${other.path})`);
    busy = true;
    try {
      const current = await core.read(note.path);
      if (current !== cur.opened && !confirm('Die Notiz wurde inzwischen geändert. Trotzdem mit deinem Stand überschreiben?')) return;
      let text = setContent(current, ed.value);
      const tags = parseTags(' ' + tagsEd.value.replace(/\n/g, ' '));
      if (tags.join(' ') !== tagLineTags(text).join(' ')) text = setTagLine(text, tags);
      let path = note.path;
      if (renamed) {
        const dir = note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/') + 1) : '';
        path = dir + next + '.md';
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
      // offen lassen, mit dem gespeicherten Stand (z. B. um weiter Inhalte rüberzuholen)
      const saved = core.get(path);
      teardown();
      if (saved) openPeek(ui, saved, opts);
      else { if (history.state && history.state.peek) history.back(); opts.onClose?.(); }
      opts.onSaved?.(path);
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
      closePeek(true);
      opts.onSaved?.(null);
    } catch (err) {
      fail('Löschen fehlgeschlagen: ' + err.message);
    } finally {
      busy = false;
    }
  }

  document.body.append(el);
  document.body.classList.add('peek-open');
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', onPop);
  if (!(history.state && history.state.peek)) history.pushState({ ...(history.state || {}), peek: true }, '');
}
