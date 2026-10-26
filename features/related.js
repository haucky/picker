// Verwandte Fragen anzeigen (VL-Editor: Menü am „↔ N“ hinter einer gespeicherten Frage; Review: unter der
// Rückseite). Gefunden werden sie über die gespeicherten Embeddings (similar.js: relatedTo) – ohne Server.
import { h } from './dom.js';
import { judgedSame } from './similar.js';
import { contextOf } from './studydoc.js';

/**
 * Zeilen für verwandte Fragen `list` ([{ path, score }]) zu der Frage `title`: Titel, Primary Tag · Datum, Ähnlichkeit und ggf.
 * „dieselbe Frage“ (wenn das Sprachmodell das Paar schon so bewertet hat). Antippen ruft onPick(note) auf.
 */
export function relatedRows(core, title, list, onPick) {
  return list.map(({ path, score }) => {
    const n = core.get(path);
    if (!n) return null;
    const same = judgedSame(title, n.title) === true;
    return h('button', { type: 'button', class: 'rel-item', onclick: () => onPick(n) },
      h('span', { class: 'rel-title' }, n.title + '?'),
      h('span', { class: 'rel-meta' }, contextOf(n) + ' · ' + score.toFixed(2).replace('.', ',') + (same ? ' · dieselbe Frage' : '')));
  }).filter(Boolean);
}
