// KI-Prompts auf markierten Text (Editor, nur am Computer): eigener Prompt oder Abkürzung aus Prompts.md
// („summary“, „explain“ …), Antwort gestreamt in einem kleinen Dialog mit „Einfügen“ (unter dem Cursor) und „Schließen“.
import { h } from './dom.js';
import { renderMarkdown } from './markdown.js';
import { chat, llmAvailable, warmUp } from './llm.js';

export const PROMPTS_PATH = 'Prompts.md';
const TIMEOUT = 90000;
const MAX_TOKENS = 1500;
const SYSTEM = 'Du hilfst beim Schreiben und Lernen mit Notizen in Obsidian. Antworte in der Sprache des Textes, ' +
  'außer der Auftrag verlangt etwas anderes. Antworte knapp und als Markdown, ohne Einleitung und ohne Schlussformel.';

/** Prompts.md → [{ name (klein), prompt }]: jede ##-Überschrift ist eine Abkürzung, der Text darunter der Prompt. */
export function parsePrompts(text) {
  const out = [];
  let cur = null;
  let fence = false;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      cur = { name: m[1].trim().toLowerCase().replace(/\s+/g, '-'), lines: [] };
      out.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  const seen = new Set();
  return out.map((p) => ({ name: p.name, prompt: p.lines.join('\n').trim() }))
    .filter((p) => p.prompt && !seen.has(p.name) && seen.add(p.name));
}

/**
 * Eingabe + markierter Text → { label, user }. Beginnt die Eingabe mit einer Abkürzung, wird sie durch ihren Prompt
 * ersetzt; was danach steht, kommt als weitere Anweisung dazu. Sonst ist die Eingabe selbst der Prompt.
 */
export function buildPrompt(input, text, prompts) {
  const trimmed = input.trim();
  const [first, ...rest] = trimmed.split(/\s+/);
  const hit = prompts.find((p) => p.name === (first || '').replace(/^\//, '').toLowerCase());
  let instruction = hit ? hit.prompt : trimmed;
  const extra = hit ? rest.join(' ') : '';
  if (extra) instruction += '\n\nZusätzlich: ' + extra;
  const user = instruction.includes('{{text}}')
    ? instruction.replaceAll('{{text}}', text)
    : `${instruction}\n\nText:\n"""\n${text}\n"""`;
  return { label: hit ? hit.name + (extra ? ' ' + extra : '') : trimmed, user };
}

/** Abkürzungen, die zur bisherigen Eingabe passen (erstes Wort als Anfang des Namens). */
export function matchPrompts(input, prompts) {
  const t = input.trim().replace(/^\//, '').toLowerCase();
  if (/\s/.test(t)) return [];
  return prompts.filter((p) => p.name.startsWith(t));
}

/* ---------- Dialog ---------- */

let dialog = null; // { el, ctrl }

function closeDialog() {
  if (!dialog) return;
  dialog.ctrl.abort();
  dialog.el.remove();
  document.removeEventListener('keydown', dialog.onKey, true);
  dialog = null;
}

/**
 * Antwort-Dialog: streamt die Antwort, „Einfügen“ ruft insert(text) auf und schließt, „Schließen“/Escape schließt.
 * focusBack() gibt den Fokus zurück an den Editor.
 */
function openDialog({ label, user, insert, focusBack }) {
  closeDialog();
  const ctrl = new AbortController();
  const body = h('div', { class: 'ai-dialog-body' }, h('span', { class: 'ai-dialog-note loading' }, 'Denkt nach …'));
  const status = h('span', { class: 'ai-dialog-status' });
  const close = () => { closeDialog(); focusBack(); };
  let result = '';
  const btnInsert = h('button', { type: 'button', class: 'btn small', disabled: true, onclick: () => { insert(result.trim()); close(); } }, 'Einfügen');
  const btnCopy = h('button', { type: 'button', class: 'btn small', disabled: true,
    onclick: () => navigator.clipboard?.writeText(result.trim()).then(() => { status.textContent = 'Kopiert ✓'; }, () => {}) }, 'Kopieren');
  const el = h('div', { class: 'ai-dialog', role: 'dialog', 'aria-label': 'KI-Antwort' },
    h('div', { class: 'ai-dialog-head' }, h('span', { class: 'ai-dialog-label' }, '✦ ' + label),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: close }, '×')),
    body,
    h('div', { class: 'ai-dialog-foot' }, status, btnCopy,
      h('button', { type: 'button', class: 'btn small', onclick: close }, 'Schließen'), btnInsert));
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  dialog = { el, ctrl, onKey };

  let raf = 0;
  const show = () => { raf = 0; body.replaceChildren(renderMarkdown(result)); };
  chat({
    system: SYSTEM, user, purpose: 'prompt', maxTokens: MAX_TOKENS, temperature: 0.3, timeout: TIMEOUT, signal: ctrl.signal,
    onDelta: (_, all) => { result = all; if (!raf) raf = requestAnimationFrame(show); },
  }).then((text) => {
    if (ctrl.signal.aborted) return;
    result = text;
    show();
    if (!result.trim()) body.replaceChildren(h('span', { class: 'ai-dialog-note' }, 'Keine Antwort.'));
    btnInsert.disabled = btnCopy.disabled = !result.trim();
    btnInsert.focus();
  }, (err) => {
    if (err.name === 'AbortError') return;
    console.warn('KI-Prompt:', err);
    const msg = err.name === 'TimeoutError' ? 'Keine Antwort in 90 Sekunden.' : 'Fehlgeschlagen: ' + (err.message || err.name);
    body.replaceChildren(h('span', { class: 'ai-dialog-note err' }, msg));
    if (result.trim()) { body.prepend(renderMarkdown(result)); btnInsert.disabled = btnCopy.disabled = false; }
  });
}

/**
 * Für den Editor (opts.prompt): `notes()` liefert die Notizen (für Prompts.md).
 * → { available(), list() → [{ name, prompt }], run({ input, text, insert(text), focusBack() }), warmUp() }
 */
export function createPrompts({ notes }) {
  const list = () => {
    const file = notes().find((n) => n.path.toLowerCase() === PROMPTS_PATH.toLowerCase());
    return file ? parsePrompts(file.text) : [];
  };
  return {
    available: llmAvailable,
    warmUp,
    list,
    run({ input, text, insert, focusBack }) {
      const { label, user } = buildPrompt(input, text, list());
      openDialog({ label, user, insert, focusBack });
    },
  };
}
