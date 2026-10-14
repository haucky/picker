// Korrekturvorschläge für einzelne Wörter (Idee wie SymSpell: Editierabstand, dann Häufigkeit), ohne
// vorberechneten Index: pro Anfrage werden die Wortlisten direkt durchsucht – für ein Wort reicht das.
// Quellen: Häufigkeitslisten Deutsch/Englisch (vendor/dict, OpenSubtitles) und die Wörter des eigenen Vaults.

const LISTS = ['vendor/dict/de.txt', 'vendor/dict/en.txt'];
const WORD_RE = /[\p{L}](?:[\p{L}]|['’-](?=\p{L}))*/gu;
const MAX_DIST = 2;
const MIN_LEN = 3;
const VAULT_MIN = 2;        // Wörter aus dem Vault zählen erst ab 2 Vorkommen (einmalige Tippfehler nicht übernehmen)
const VAULT_WEIGHT = 50;    // ein Vorkommen im Vault zählt wie Rang ~20.000 in einer allgemeinen Liste

/**
 * Damerau-Levenshtein (benachbarte Vertauschung zählt 1), abgebrochen sobald > max. Gibt max + 1 zurück,
 * wenn der Abstand größer ist. Drei wiederverwendete Zeilen-Puffer, damit pro Vergleich nichts angelegt wird.
 */
let rows = [new Int32Array(64), new Int32Array(64), new Int32Array(64)];
export function distance(a, b, max = MAX_DIST) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (rows[0].length <= lb) rows = [0, 1, 2].map(() => new Int32Array(lb * 2 + 1));
  let [prev2, prev, cur] = rows;
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ca === cb ? 0 : 1);
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb];
}

/** Schreibweise des getippten Worts übernehmen (Großbuchstabe am Anfang bzw. alles groß). */
function matchCase(word, typed) {
  if (typed.length > 1 && typed === typed.toUpperCase()) return word.toUpperCase();
  if (typed[0] !== typed[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

export function createSpell({ notes, base = './' }) {
  const general = new Map();   // wort (klein) → Punkte aus den allgemeinen Listen
  const byLength = [];         // Länge → [Wörter], damit nur Kandidaten passender Länge geprüft werden
  let vault = null;            // wort (klein) → Vorkommen im Vault
  let vaultStale = true;
  let loading = null;

  function load() {
    loading ??= Promise.all(LISTS.map(async (url) => {
      const res = await fetch(base + url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const words = (await res.text()).split('\n');
      words.forEach((w, rank) => {
        if (!w) return;
        const score = 1e6 / (rank + 10);
        if ((general.get(w) || 0) < score) general.set(w, score);
      });
    })).then(() => {
      for (const w of general.keys()) (byLength[w.length] ??= []).push(w);
    });
    return loading;
  }

  function vaultWords() {
    if (vault && !vaultStale) return vault;
    vault = new Map();
    for (const n of notes()) {
      for (const m of n.text.matchAll(WORD_RE)) {
        const w = m[0].toLowerCase();
        vault.set(w, (vault.get(w) || 0) + 1);
      }
    }
    vaultStale = false;
    return vault;
  }

  const score = (w) => (general.get(w) || 0) + ((vault?.get(w) || 0) >= VAULT_MIN ? vault.get(w) * VAULT_WEIGHT : 0);

  return {
    ready: () => load().then(() => true),
    /** Nach Änderungen an Notizen aufrufen; die Vault-Wörter werden bei der nächsten Anfrage neu gezählt. */
    invalidate() { vaultStale = true; },

    /** Bekanntes Wort (oder zu kurz / mit Ziffern)? Erst nach ready() aussagekräftig. */
    isKnown(word) {
      const w = word.toLowerCase();
      if (w.length < MIN_LEN || /\d/.test(w)) return true;
      return general.has(w) || (vaultWords().get(w) || 0) >= VAULT_MIN;
    },

    /** Bis zu `limit` Vorschläge: kleinster Abstand zuerst, dann häufigstes Wort. */
    suggest(word, limit = 4) {
      const w = word.toLowerCase();
      const v = vaultWords();
      const hits = [];
      const consider = (cand) => {
        if (cand === w) return;
        const d = distance(w, cand);
        if (d <= MAX_DIST) hits.push({ cand, d, s: score(cand) });
      };
      for (let len = w.length - MAX_DIST; len <= w.length + MAX_DIST; len++) for (const cand of byLength[len] || []) consider(cand);
      for (const [cand, n] of v) if (n >= VAULT_MIN && !general.has(cand)) consider(cand);
      hits.sort((a, b) => a.d - b.d || b.s - a.s);
      return hits.slice(0, limit).map((h) => matchCase(h.cand, word));
    },
  };
}
