// KI-Korrekturvorschläge für ein Wort im Satz (Doppelklick im Editor, nur am Computer), über features/llm.js.
// Nur der Satz um das Wort geht an das Modell, nicht das Dokument. Ergebnisse werden im Speicher gecacht.
import { chat, extractJSON, llmAvailable, warmUp } from './llm.js';

const COUNT = 5;
const TIMEOUT = 5000;
const MAX_CONTEXT = 400;
const SYSTEM = 'Du bist ein Korrekturassistent für deutsche Texte. Gib genau 5 Korrekturvorschläge für das markierte ' +
  'Wort im gegebenen Kontext zurück, bester zuerst. Antworte ausschließlich als JSON-Array von Strings.';

const cache = new Map(); // wort \0 satz → [Vorschläge]

/**
 * Satz um das Wort [from, to) in `line` (Text der Zeile, from/to = Spalten): von der letzten Satzgrenze (. ! ? : ;
 * gefolgt von Leerraum) davor bis einschließlich der nächsten danach, höchstens ~MAX_CONTEXT Zeichen.
 */
export function sentenceAround(line, from, to) {
  let start = 0;
  for (const m of line.slice(0, from).matchAll(/[.!?:;]\s+/g)) start = m.index + m[0].length;
  const rest = line.slice(to).search(/[.!?:;](\s|$)/);
  const end = rest < 0 ? line.length : to + rest + 1;
  return line.slice(Math.max(start, from - MAX_CONTEXT / 2), Math.min(end, to + MAX_CONTEXT / 2)).trim();
}

/** Vorschläge aus der Modellantwort: nur Strings, ohne Leer-/Doppelte und ohne das Wort selbst. */
export function parseSuggestions(text, word) {
  const arr = extractJSON(text);
  if (!Array.isArray(arr)) return null;
  const seen = new Set([word]);
  const out = [];
  for (const s of arr) {
    if (typeof s !== 'string') continue;
    const t = s.trim();
    if (!t || t.length > 80 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, COUNT);
}

export const aiCorrect = {
  available: llmAvailable,
  warmUp,

  /** → Promise<[Vorschläge]>; Fehler: AbortError, TimeoutError, sonst „nicht verfügbar“. */
  async suggest(word, sentence, signal) {
    const key = word + '\0' + sentence;
    if (cache.has(key)) return cache.get(key);
    const text = await chat({
      system: SYSTEM,
      user: `Kontext: ${sentence}\nMarkiertes Wort: ${word}`,
      maxTokens: 60,
      temperature: 0.2,
      timeout: TIMEOUT,
      signal,
    });
    const list = parseSuggestions(text, word);
    if (!list) throw new Error('Antwort ist kein JSON-Array');
    cache.set(key, list);
    return list;
  },
};
