// Gemeinsamer Markdown-Editor (CodeMirror 6) mit Live-Vorschau wie in Obsidian: Markdown wird gerendert,
// nur wo der Cursor steht, ist der Quelltext zu sehen (Inline-Formatierung pro Element, Überschriften,
// Listen und Zitate pro Zeile). Ohne Fokus ist alles gerendert.
import {
  EditorState, EditorView, ViewPlugin, Decoration, WidgetType, keymap, placeholder as cmPlaceholder, Prec,
  StateField, StateEffect, showTooltip, EditorSelection,
  history, defaultKeymap, historyKeymap, indentMore, indentLess,
  Language, defineLanguageFacet, LanguageSupport, syntaxTree, markdownParser, GFM,
} from '../vendor/codemirror.js';
import { parseSize, splitAlt, sizeImage } from './image.js';
import { sentenceAround } from './aicorrect.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const WIKI_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;
const TAG_RE = /(^|[\s(,])(#[\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu;
const INLINE_HIDE = { Emphasis: 'cm-em', StrongEmphasis: 'cm-strong', Strikethrough: 'cm-strike', InlineCode: 'cm-icode' };
const INLINE_MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark']);
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);

const markdownLang = new LanguageSupport(new Language(defineLanguageFacet(), markdownParser.configure([GFM]), [], 'markdown'));

/* ---------- Widgets ---------- */

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(o) { return o.checked === this.checked && o.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

class LinkWidget extends WidgetType {
  constructor(text, target, open) { super(); this.text = text; this.target = target; this.open = open; }
  eq(o) { return o.text === this.text && o.target === this.target; }
  toDOM() {
    const a = document.createElement('span');
    a.className = 'cm-wikilink';
    a.textContent = this.text;
    a.addEventListener('mousedown', (e) => e.preventDefault());
    a.addEventListener('click', (e) => { e.preventDefault(); this.open?.(this.target); });
    return a;
  }
  ignoreEvent() { return true; }
}

class ImageWidget extends WidgetType {
  constructor(link, resolve, size) { super(); this.link = link; this.resolve = resolve; this.size = size; }
  eq(o) { return o.link === this.link && JSON.stringify(o.size) === JSON.stringify(this.size); }
  toDOM() {
    const img = sizeImage(document.createElement('img'), this.size);
    img.classList.add('cm-img');
    img.alt = this.link;
    if (this.resolve) {
      this.resolve(this.link).then((url) => { if (url) img.src = url; else img.replaceWith(missing(this.link)); })
        .catch(() => img.replaceWith(missing(this.link)));
    }
    return img;
  }
}
function missing(link) {
  const s = document.createElement('span');
  s.className = 'cm-img-missing';
  s.textContent = `🖼 ${link}`;
  return s;
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const hr = document.createElement('span'); hr.className = 'cm-hr'; return hr; }
}

/* ---------- Live-Vorschau ---------- */

function livePreview({ openLink, resolveImage }) {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = this.build(u.view);
    }
    build(view) {
      const { state } = view;
      const focused = view.hasFocus;
      const sel = state.selection.ranges;
      const touches = (from, to) => focused && sel.some((r) => r.from <= to && r.to >= from);
      const lineActive = (pos) => {
        const l = state.doc.lineAt(pos);
        return touches(l.from, l.to);
      };
      const out = [];
      const hide = (from, to) => { if (to > from) out.push(Decoration.replace({}).range(from, to)); };
      const tree = syntaxTree(state);
      const code = [];
      // YAML-Frontmatter am Anfang nicht als Markdown rendern (sonst Trennlinie/Überschrift)
      const fm = /^---[ \t]*\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)/.exec(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
      const fmEnd = fm ? fm[0].replace(/\n$/, '').length : 0;
      if (fmEnd) {
        for (let l = state.doc.line(1); ; l = state.doc.line(l.number + 1)) {
          out.push(Decoration.line({ class: 'cm-frontmatter' }).range(l.from));
          if (l.to >= fmEnd || l.number >= state.doc.lines) break;
        }
        code.push([0, fmEnd]);
      }

      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from, to,
          enter: (node) => {
            if (node.from < fmEnd) return node.to > fmEnd;
            const name = node.name;
            if (CODE_NODES.has(name)) code.push([node.from, node.to]);
            const heading = /^ATXHeading(\d)$/.exec(name);
            if (heading) {
              out.push(Decoration.line({ class: `cm-h cm-h${heading[1]}` }).range(state.doc.lineAt(node.from).from));
              return;
            }
            if (name === 'HeaderMark') {
              if (!lineActive(node.from)) {
                const next = state.doc.sliceString(node.to, node.to + 1);
                hide(node.from, node.to + (next === ' ' ? 1 : 0));
              }
              return;
            }
            if (INLINE_HIDE[name]) {
              out.push(Decoration.mark({ class: INLINE_HIDE[name] }).range(node.from, node.to));
              if (!touches(node.from, node.to)) {
                const c = node.node.cursor();
                if (c.firstChild()) {
                  do { if (INLINE_MARKS.has(c.name)) hide(c.from, c.to); } while (c.nextSibling());
                }
              }
              return name !== 'InlineCode';
            }
            if (name === 'Link') {
              if (touches(node.from, node.to)) return false;
              const c = node.node.cursor();
              let textEnd = null;
              if (c.firstChild()) {
                do {
                  if (c.name === 'LinkMark') { if (textEnd == null && state.doc.sliceString(c.from, c.to) === ']') textEnd = c.from; }
                } while (c.nextSibling());
              }
              if (textEnd == null) return false;
              hide(node.from, node.from + 1);
              out.push(Decoration.mark({ class: 'cm-link' }).range(node.from + 1, textEnd));
              hide(textEnd, node.to);
              return false;
            }
            if (name === 'Image') {
              if (touches(node.from, node.to)) return false;
              const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)/.exec(state.doc.sliceString(node.from, node.to));
              if (m) out.push(Decoration.replace({ widget: new ImageWidget(decodeURI(m[2]), resolveImage, splitAlt(m[1]).size) }).range(node.from, node.to));
              return false;
            }
            if (name === 'ListMark') {
              const mark = state.doc.sliceString(node.from, node.to);
              const task = state.doc.sliceString(node.to, node.to + 5);
              if (/^ \[[ xX]\]/.test(task)) {
                if (!lineActive(node.from)) {
                  hide(node.from, node.to + 1);
                  out.push(Decoration.replace({ widget: new CheckboxWidget(task[2] !== ' ', node.to + 1) }).range(node.to + 1, node.to + 4));
                }
              } else if (/^[-*+]$/.test(mark) && !lineActive(node.from)) {
                out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
              } else {
                out.push(Decoration.mark({ class: 'cm-listmark' }).range(node.from, node.to));
              }
              return;
            }
            if (name === 'Blockquote') {
              for (let l = state.doc.lineAt(node.from); ; l = state.doc.line(l.number + 1)) {
                out.push(Decoration.line({ class: 'cm-quote' }).range(l.from));
                if (l.to >= node.to || l.number >= state.doc.lines) break;
              }
              return;
            }
            if (name === 'QuoteMark') {
              if (!lineActive(node.from)) {
                const next = state.doc.sliceString(node.to, node.to + 1);
                hide(node.from, node.to + (next === ' ' ? 1 : 0));
              }
              return;
            }
            if (name === 'FencedCode') {
              for (let l = state.doc.lineAt(node.from); ; l = state.doc.line(l.number + 1)) {
                const fence = l.from === node.from || l.to >= node.to;
                out.push(Decoration.line({ class: fence ? 'cm-codeblock cm-fence' : 'cm-codeblock' }).range(l.from));
                if (l.to >= node.to || l.number >= state.doc.lines) break;
              }
              return false;
            }
            if (name === 'HorizontalRule') {
              if (!lineActive(node.from)) out.push(Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to));
              return false;
            }
          },
        });

        // [[Wikilinks]], ![[Bilder]] und #Tags (nicht in Code)
        const inCode = (pos) => code.some(([a, b]) => pos >= a && pos < b);
        const text = state.doc.sliceString(from, to);
        for (const m of text.matchAll(WIKI_RE)) {
          const a = from + m.index;
          const b = a + m[0].length;
          if (inCode(a)) continue;
          const [target, alias] = m[2].split('|');
          if (touches(a, b)) { out.push(Decoration.mark({ class: 'cm-wikilink-src' }).range(a, b)); continue; }
          if (m[1] && IMAGE_EXT.test(target.trim())) {
            out.push(Decoration.replace({ widget: new ImageWidget(target.trim(), resolveImage, parseSize(alias)) }).range(a, b));
          } else {
            const shown = (alias || target).trim();
            out.push(Decoration.replace({ widget: new LinkWidget(shown, target.split('#')[0].trim(), openLink) }).range(a, b));
          }
        }
        for (const m of text.matchAll(TAG_RE)) {
          const a = from + m.index + m[1].length;
          if (!inCode(a)) out.push(Decoration.mark({ class: 'cm-tag' }).range(a, a + m[2].length));
        }
      }
      return Decoration.set(out, true);
    }
  }, { decorations: (v) => v.decorations });
}

/* ---------- Zusätzliche Markierungen (z. B. Study: Fragen, Todos, Fehler) ---------- */

/**
 * `decorate(text)` → [{ line (0-basiert), class } | { line, from, to, class }] (from/to = Spalten).
 * Wird bei jeder Änderung für das ganze Dokument neu berechnet (für Dokumente in Notizgröße unkritisch).
 */
function extraMarks(decorate) {
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = this.build(view); }
    update(u) { if (u.docChanged) this.decorations = this.build(u.view); }
    build(view) {
      const doc = view.state.doc;
      const out = [];
      for (const d of decorate(doc.toString())) {
        if (d.line >= doc.lines) continue;
        const l = doc.line(d.line + 1);
        if (d.from == null) out.push(Decoration.line({ class: d.class }).range(l.from));
        else if (d.to > d.from) out.push(Decoration.mark({ class: d.class }).range(l.from + d.from, l.from + Math.min(d.to, l.length)));
      }
      return Decoration.set(out, true);
    }
  }, { decorations: (v) => v.decorations });
}

/* ---------- Korrekturvorschläge (Desktop) ---------- */

const setSuggest = StateEffect.define();
const suggestField = StateField.define({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSuggest)) return e.value;
    return tr.docChanged || tr.selection ? null : v;
  },
  provide: (f) => showTooltip.from(f, (v) => v && {
    pos: v.from,
    above: false,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'cm-suggest';
      v.suggestions.forEach((s, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = s;
        b.title = `Alt+${i + 1}`;
        b.addEventListener('mousedown', (e) => { e.preventDefault(); applySuggestion(view, i); });
        dom.append(b);
      });
      if (!v.suggestions.length) dom.append(Object.assign(document.createElement('span'), { className: 'cm-suggest-none', textContent: 'keine Vorschläge' }));
      return { dom };
    },
  }),
});

function applySuggestion(view, i) {
  const v = view.state.field(suggestField, false);
  if (!v || !v.suggestions[i]) return false;
  view.dispatch({ changes: { from: v.from, to: v.to, insert: v.suggestions[i] }, selection: { anchor: v.from + v.suggestions[i].length }, userEvent: 'input' });
  return true;
}

const SKIP_NODES = new Set([...CODE_NODES, 'URL', 'LinkLabel', 'HTMLTag', 'Comment']);

/** Steht das Wort ab `from` nicht im Fließtext (Tag, Code, URL, HTML, Kommentar, [[Link]])? */
function notProse(state, from) {
  if (state.sliceDoc(from - 1, from) === '#') return true;
  for (let n = syntaxTree(state).resolveInner(from, 1); n; n = n.parent) if (SKIP_NODES.has(n.name)) return true;
  const line = state.doc.lineAt(from);
  return /\[\[[^\]]*$/.test(state.sliceDoc(line.from, from));
}

/** Zeigt für das Wort am Cursor Vorschläge, wenn `spell` es nicht kennt (kurz nach dem letzten Tastendruck). */
function spellSuggest(spell) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; this.timer = 0; spell.ready().then(() => this.schedule()); }
    update(u) { if (u.docChanged || u.selectionSet || u.focusChanged) this.schedule(); }
    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.check(), 250);
    }
    check() {
      const { view } = this;
      const { state } = view;
      const r = state.selection.main;
      if (!view.hasFocus || !r.empty) return;
      const range = state.wordAt(r.head);
      if (!range) return;
      const word = state.sliceDoc(range.from, range.to);
      if (!/^\p{L}+$/u.test(word) || spell.isKnown(word) || notProse(state, range.from)) return;
      view.dispatch({ effects: setSuggest.of({ from: range.from, to: range.to, suggestions: spell.suggest(word) }) });
    }
    destroy() { clearTimeout(this.timer); }
  });
  return [
    suggestField,
    plugin,
    keymap.of([1, 2, 3, 4].map((n) => ({ key: `Alt-${n}`, run: (view) => applySuggestion(view, n - 1) }))),
  ];
}

/* ---------- Wort-Menü per Doppelklick (Desktop): Wörterbuch + KI ---------- */

// Wert: { id, from, to, word, dict: [..], ai: null (aus) | 'loading' | 'timeout' | [..] }
const setWordMenu = StateEffect.define();
const wordMenuField = StateField.define({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setWordMenu)) return e.value;
    if (!v || tr.docChanged) return null;
    const r = tr.newSelection.main;
    return r.from === v.from && r.to === v.to ? v : null;
  },
  provide: (f) => showTooltip.from(f, (v) => v && { pos: v.from, above: false, create: (view) => ({ dom: renderWordMenu(view, v) }) }),
});

const menuItems = (v) => [...v.dict, ...(Array.isArray(v.ai) ? v.ai : [])];

function renderWordMenu(view, v) {
  const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });
  const dom = el('div', 'cm-wordmenu', '');
  let i = 0;
  const item = (s) => {
    const b = el('button', 'cm-wordmenu-item', s);
    const n = i++;
    b.type = 'button';
    if (n < 9) b.title = `Alt+${n + 1}`;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); applyWordMenu(view, n); });
    dom.append(b);
  };
  v.dict.forEach(item);
  if (v.ai != null) {
    if (v.dict.length) dom.append(el('div', 'cm-wordmenu-sep', ''));
    if (v.ai === 'loading') dom.append(el('span', 'cm-wordmenu-note loading', 'KI-Vorschläge …'));
    else if (v.ai === 'timeout') dom.append(el('span', 'cm-wordmenu-note', 'KI-Vorschläge nicht verfügbar'));
    else v.ai.forEach(item);
  }
  if (!dom.childElementCount) dom.append(el('span', 'cm-wordmenu-note', 'keine Vorschläge'));
  return dom;
}

function applyWordMenu(view, i) {
  const v = view.state.field(wordMenuField, false);
  const s = v && menuItems(v)[i];
  if (!s) return false;
  view.dispatch({ changes: { from: v.from, to: v.to, insert: s }, selection: { anchor: v.from + s.length }, userEvent: 'input' });
  return true;
}

function closeWordMenu(view) {
  if (!view.state.field(wordMenuField, false)) return false;
  view.dispatch({ effects: setWordMenu.of(null) });
  return true;
}

/**
 * Doppelklick auf ein Wort öffnet ein Menü: sofort die Wörterbuch-Vorschläge (nur für unbekannte Wörter), darunter
 * KI-Vorschläge (`ai`, siehe aicorrect.js; nur mit Key und online), sobald sie da sind. Escape, Klick daneben oder
 * Tippen schließt es; ein neuer Doppelklick bricht die laufende Anfrage ab.
 */
function wordMenu({ spell, ai }) {
  let seq = 0;
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.ctrl = null;
      this.dictReady = !spell;
      spell?.ready().then(() => { this.dictReady = true; }, () => {});
      if (ai?.available()) ai.warmUp();
    }
    update(u) {
      if (u.startState.field(wordMenuField, false) && !u.state.field(wordMenuField, false)) this.abort();
      if (u.focusChanged && !u.view.hasFocus) setTimeout(() => { if (this.view.dom.isConnected) closeWordMenu(this.view); });
    }
    abort() { this.ctrl?.abort(); this.ctrl = null; }
    open() {
      const { view } = this;
      const { state } = view;
      let r = state.selection.main;
      if (r.empty) r = state.wordAt(r.head);
      if (!r) return;
      const word = state.sliceDoc(r.from, r.to);
      if (!/^\p{L}+$/u.test(word) || notProse(state, r.from)) return;
      this.abort();
      const dict = spell && this.dictReady && !spell.isKnown(word) ? spell.suggest(word, 5) : [];
      const useAi = !!ai && ai.available();
      const id = ++seq;
      view.dispatch({ effects: setWordMenu.of({ id, from: r.from, to: r.to, word, dict, ai: useAi ? 'loading' : null }) });
      if (!useAi) return;
      const line = state.doc.lineAt(r.from);
      const sentence = sentenceAround(line.text, r.from - line.from, r.to - line.from);
      const ctrl = this.ctrl = new AbortController();
      ai.suggest(word, sentence, ctrl.signal).then((list) => {
        const known = new Set(dict.map((s) => s.toLowerCase()));
        return list.filter((s) => !known.has(s.toLowerCase()));
      }, (err) => {
        if (err.name === 'AbortError') return undefined;
        if (err.name !== 'TimeoutError') console.warn('KI-Vorschläge:', err);
        return err.name === 'TimeoutError' ? 'timeout' : null; // andere Fehler: still nur Wörterbuch
      }).then((res) => {
        if (res === undefined || ctrl.signal.aborted) return;
        const cur = view.state.field(wordMenuField, false);
        if (cur && cur.id === id) view.dispatch({ effects: setWordMenu.of({ ...cur, ai: res }) });
      });
    }
    destroy() { this.abort(); }
  }, {
    eventHandlers: {
      dblclick() { setTimeout(() => this.open()); }, // nach CodeMirrors Wort-Auswahl
    },
  });
  return [
    wordMenuField,
    plugin,
    Prec.high(keymap.of([
      { key: 'Escape', run: closeWordMenu },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ key: `Alt-${n}`, run: (view) => applyWordMenu(view, n - 1) })),
    ])),
  ];
}

/* ---------- Bilder einfügen (Zwischenablage, Ziehen) ---------- */

function imagePaste(saveImage) {
  const insert = async (view, files) => {
    for (const file of files) {
      try {
        const md = await saveImage(file);
        // in die Zeile, mit Leerzeichen getrennt: mehrere eingefügte Bilder ergeben eine Reihe
        const { from, to } = view.state.selection.main;
        const before = /\S/.test(view.state.sliceDoc(from - 1, from)) ? ' ' : '';
        const insert = before + md + ' ';
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input' });
      } catch (err) {
        alert('Bild konnte nicht gespeichert werden: ' + err.message);
      }
    }
  };
  const images = (list) => [...(list || [])].filter((f) => f.type.startsWith('image/'));
  return EditorView.domEventHandlers({
    paste(e, view) {
      const files = images(e.clipboardData?.files);
      if (!files.length) return false;
      e.preventDefault();
      insert(view, files);
      return true;
    },
    drop(e, view) {
      const files = images(e.dataTransfer?.files);
      if (!files.length) return false;
      e.preventDefault();
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos != null) view.dispatch({ selection: { anchor: pos } });
      insert(view, files);
      return true;
    },
  });
}

/* ---------- Formatierung per Tastenkürzel (Strg/Cmd+B, Strg/Cmd+I) ---------- */

/** Ist der Bereich [from, to] von `mark` umschlossen (bei '*' nicht Teil von '**', außer '***')? */
function wrapped(state, from, to, mark) {
  const before = state.sliceDoc(Math.max(0, from - 3), from);
  const after = state.sliceDoc(to, to + 3);
  if (!before.endsWith(mark) || !after.startsWith(mark)) return false;
  if (mark === '*' && before.endsWith('**') && after.startsWith('**')) return before.endsWith('***') && after.startsWith('***');
  return true;
}

/**
 * Setzt bzw. entfernt `mark` um jede Auswahl. Ohne Auswahl: um das Wort am Cursor; außerhalb eines Worts
 * werden leere Marker eingefügt und der Cursor steht dazwischen.
 */
function toggleMark(mark) {
  return (view) => {
    const { state } = view;
    const n = mark.length;
    view.dispatch(state.changeByRange((r) => {
      let { from, to } = r;
      if (r.empty) {
        const word = state.wordAt(r.head);
        if (word) ({ from, to } = word);
      }
      const text = state.sliceDoc(from, to);
      // Auswahl schließt die Marker selbst ein: **fett** → fett
      if (text.length >= 2 * n && text.startsWith(mark) && text.endsWith(mark) && !(mark === '*' && text.startsWith('**') && !text.startsWith('***'))) {
        return { changes: [{ from, to: from + n }, { from: to - n, to }], range: EditorSelection.range(from, to - 2 * n) };
      }
      if (wrapped(state, from, to, mark)) {
        const map = (pos) => pos - n;
        return { changes: [{ from: from - n, to: from }, { from: to, to: to + n }],
          range: r.empty ? EditorSelection.cursor(map(r.head)) : EditorSelection.range(map(from), map(to)) };
      }
      return { changes: [{ from, insert: mark }, { from: to, insert: mark }],
        range: r.empty ? EditorSelection.cursor(r.head + n) : EditorSelection.range(from + n, to + n) };
    }), { userEvent: 'input' });
    return true;
  };
}

/* ---------- Listen fortsetzen ---------- */

/** Enter in einem Listenpunkt: nächster Punkt (Nummer +1, neue Checkbox); im leeren Punkt: Liste beenden. */
function continueList(view) {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) return false;
  const line = state.doc.lineAt(r.head);
  const m = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line.text);
  if (!m || r.head < line.from + m[0].length) return false;
  const node = syntaxTree(state).resolveInner(r.head, -1);
  for (let n = node; n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return false;
  if (!line.text.slice(m[0].length).trim()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: m[1] }, selection: { anchor: line.from + m[1].length }, userEvent: 'delete' });
    return true;
  }
  const marker = m[2] || `${Number(m[3]) + 1}${m[4]}`;
  view.dispatch({ ...state.replaceSelection('\n' + m[1] + marker + m[5] + (m[6] ? '[ ] ' : '')), scrollIntoView: true, userEvent: 'input' });
  return true;
}

/* ---------- Editor ---------- */

/**
 * opts: { parent, doc, onChange(text), placeholder, decorate(text), openLink(target), resolveImage(link) → Promise<URL>,
 *         spell (siehe spell.js, nur am Desktop übergeben), ai (siehe aicorrect.js, nur am Desktop),
 *         saveImage(file) → Promise<Markdown-Link> }
 * Gibt { view, value, set(text), focus(), jumpToLine(i), destroy() } zurück.
 */
export function createEditor(opts) {
  const urls = new Map(); // Bild-Link → Object-URL (einmal auflösen, beim Neuladen freigeben)
  const resolveImage = opts.resolveImage && ((link) => {
    if (!urls.has(link)) urls.set(link, opts.resolveImage(link).catch(() => null));
    return urls.get(link);
  });
  const freeUrls = () => {
    for (const p of urls.values()) p.then((u) => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
    urls.clear();
  };

  const extensions = () => [
    markdownLang,
    history(),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' }),
    Prec.high(keymap.of([
      { key: 'Enter', run: continueList },
      { key: 'Tab', run: indentMore },
      { key: 'Shift-Tab', run: indentLess },
      { key: 'Mod-b', run: toggleMark('**') },
      { key: 'Mod-i', run: toggleMark('*') },
    ])),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    livePreview({ openLink: opts.openLink, resolveImage }),
    opts.decorate ? extraMarks(opts.decorate) : [],
    opts.placeholder ? cmPlaceholder(opts.placeholder) : [],
    opts.spell ? spellSuggest(opts.spell) : [],
    opts.spell || opts.ai ? wordMenu({ spell: opts.spell, ai: opts.ai }) : [],
    opts.saveImage ? imagePaste(opts.saveImage) : [],
    EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange?.(u.state.doc.toString()); }),
  ];

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc || '', extensions: extensions() }),
  });

  return {
    view,
    get value() { return view.state.doc.toString(); },
    /** Neuer Inhalt mit frischem Verlauf (Rückgängig beginnt neu). */
    set(text) {
      freeUrls();
      view.setState(EditorState.create({ doc: text, extensions: extensions() }));
    },
    focus() { view.focus(); },
    jumpToLine(i) {
      const n = Math.min(Math.max(1, i + 1), view.state.doc.lines);
      const pos = view.state.doc.line(n).from;
      view.focus();
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    },
    destroy() { freeUrls(); view.destroy(); },
  };
}
