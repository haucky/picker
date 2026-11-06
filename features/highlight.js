// Farbige Markierungen wie in Obsidian (ab 1.14): ein Farb-Emoji am Anfang, z. B. ==🔴rot==. Ohne Emoji gelb.
// Gemeinsam für Editor (editor.js) und Markdown-Anzeige (markdown.js).

/** [Emoji, Name, Bezeichnung] in der Reihenfolge von Obsidian. */
export const HIGHLIGHT_COLORS = [
  ['🔴', 'red', 'Rot'],
  ['🟠', 'orange', 'Orange'],
  ['🟡', 'yellow', 'Gelb'],
  ['🟢', 'green', 'Grün'],
  ['🔵', 'blue', 'Blau'],
  ['🟣', 'purple', 'Lila'],
];
const BY_EMOJI = new Map(HIGHLIGHT_COLORS.map(([e, name]) => [e, name]));
export const HIGHLIGHT_EMOJI_RE = /^(🔴|🟠|🟡|🟢|🔵|🟣)/u;

/** Inhalt einer Markierung (ohne ==) → { color (Name oder null = Standard-Gelb), emoji, text }. */
export function splitHighlight(inner) {
  const m = HIGHLIGHT_EMOJI_RE.exec(inner);
  return m ? { color: BY_EMOJI.get(m[1]), emoji: m[1], text: inner.slice(m[1].length) } : { color: null, emoji: '', text: inner };
}
