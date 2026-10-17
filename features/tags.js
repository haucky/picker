// Tag-Vorschläge für den Editor: alle Tags des Vaults mit Häufigkeit. Gezählt wird erst bei Bedarf und nach jeder
// Änderung an Notizen neu (invalidate) – neue Tags tauchen also auf, sobald eine Notiz damit gespeichert ist, und
// Tags, die in keiner Notiz mehr stehen, verschwinden von selbst.

// Massenhaft vorhandene Tags nur zeigen, wenn ausdrücklich danach getippt wird (z. B. „#date/2026“).
const HIDDEN = ['date/', 'reviewed/'];

export function createTagIndex({ notes }) {
  let tags = null; // [{ tag, lower, count }]

  function build() {
    const byLower = new Map(); // klein → { tag (häufigste Schreibweise), lower, count, spellings }
    for (const n of notes()) {
      for (const t of new Set(n.tags)) {
        const lower = t.toLowerCase();
        let e = byLower.get(lower);
        if (!e) byLower.set(lower, (e = { tag: t, lower, count: 0, spellings: new Map() }));
        e.count++;
        e.spellings.set(t, (e.spellings.get(t) || 0) + 1);
      }
    }
    tags = [...byLower.values()].map((e) => {
      const [tag] = [...e.spellings].sort((a, b) => b[1] - a[1])[0];
      return { tag, lower: e.lower, count: e.count };
    });
  }

  return {
    invalidate() { tags = null; },

    /**
     * Bis zu `limit` Tags (ohne '#') zum Getippten (ohne '#'): erst solche, die damit anfangen, dann solche, bei denen
     * ein Teil nach '/' damit anfängt; jeweils häufigste zuerst. Der getippte Tag selbst wird nicht vorgeschlagen.
     */
    suggest(typed, limit = 6) {
      const q = typed.toLowerCase();
      if (!q) return [];
      if (!tags) build();
      const hits = [];
      for (const t of tags) {
        if (t.lower === q) continue;
        if (HIDDEN.some((h) => t.lower.startsWith(h) && !q.startsWith(h))) continue;
        const rank = t.lower.startsWith(q) ? 0 : t.lower.includes('/' + q) ? 1 : -1;
        if (rank >= 0) hits.push({ t, rank });
      }
      hits.sort((a, b) => a.rank - b.rank || b.t.count - a.t.count || a.t.lower.localeCompare(b.t.lower, 'de'));
      return hits.slice(0, limit).map((x) => x.t.tag);
    },
  };
}
