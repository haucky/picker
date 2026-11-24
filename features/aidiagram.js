// KI: eine Frage (mit Antwort) als erklärendes Mermaid-Diagramm. Das Sprachmodell (Stufe „gut“) schlägt drei
// verschiedene Diagramme vor; sie erscheinen gerendert (mermaid.js), sobald jedes fertig gestreamt ist. Lässt sich
// eines nicht rendern, wird es einmal mit der Fehlermeldung zur Korrektur zurückgegeben (Stufe „schnell“). Antippen
// eines Vorschlags fügt es als ```mermaid-Block ein. Optional: eigene Wünsche ans Diagramm.
import { h } from './dom.js';
import { chat } from './llm.js';
import { mermaidError, mermaidElement, mermaidBlock } from './mermaid.js';

const TIMEOUT = 150000;
const COUNT = 3;

const SYSTEM = `Du erstellst Mermaid-Diagramme, die beim Verstehen einer Lernfrage helfen.
Regeln:
- Genau ${COUNT} Vorschläge, möglichst mit verschiedenen Diagrammtypen bzw. Blickwinkeln (z. B. flowchart, mindmap, \
sequenceDiagram, stateDiagram-v2, timeline, classDiagram, erDiagram, quadrantChart) – nimm, was zum Inhalt passt.
- Das Diagramm muss nicht alles abdecken: lieber einen Kernzusammenhang klar zeigen (Ablauf, Ursache → Wirkung, \
Aufbau, Vergleich, Einordnung). Höchstens etwa 12 Knoten, kurze Beschriftungen in der Sprache der Frage.
- Gültige Mermaid-Syntax (Version 12). Beschriftungen mit Sonderzeichen in Anführungszeichen, z. B. A["Text (x)"].
- Kein Styling: kein style, classDef, class, linkStyle, %%{init}%%, keine Farben, keine click-Links, keine Icons.
- Ausgabe genau in diesem Format, ohne weiteren Text:
### <kurzer Titel, was das Diagramm zeigt>
\`\`\`mermaid
<Diagramm>
\`\`\``;

const BLOCK_RE = /(?:^###[ \t]*(.+?)[ \t]*\n+)?^```mermaid[ \t]*\n([\s\S]*?)\n```/gm;

/** Fertige Vorschläge aus der (bisherigen) Antwort: [{ title, code }]. */
export function parseDiagrams(text) {
  return [...String(text).matchAll(BLOCK_RE)].map((m) => ({ title: (m[1] || '').trim(), code: m[2].trim() }))
    .filter((d) => d.code);
}

/** Text der Frage ohne schon vorhandene Diagramme. */
const withoutDiagrams = (text) => text.replace(/^```mermaid[ \t]*\n[\s\S]*?\n```[ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

function userPrompt(question, wish) {
  return `Lernfrage mit Antwort:\n"""\n${withoutDiagrams(question)}\n"""` +
    (wish ? `\n\nWünsche ans Diagramm: ${wish}` : '');
}

/** Einmal korrigieren lassen; → gültiger Code oder null. */
async function repair(code, error, signal) {
  const out = await chat({
    tier: 'fast', maxTokens: 1200, timeout: 60000, signal,
    system: 'Du korrigierst Mermaid-Diagramme. Antworte nur mit dem korrigierten Diagramm in einem ```mermaid-Block, ' +
      'ohne Styling und ohne weiteren Text.',
    user: `Dieses Diagramm lässt sich nicht rendern.\nFehler: ${error}\n\n\`\`\`mermaid\n${code}\n\`\`\``,
  });
  const fixed = parseDiagrams(out)[0]?.code;
  return fixed && !(await mermaidError(fixed)) ? fixed : null;
}

/* ---------- Dialog ---------- */

let dialog = null;

function closeDialog() {
  if (!dialog) return;
  dialog.ctrl?.abort();
  dialog.el.remove();
  document.removeEventListener('keydown', dialog.onKey, true);
  dialog = null;
}

/**
 * Dialog öffnen: optionale Wünsche, „Erzeugen“, dann die Vorschläge zum Auswählen.
 * question: Text der Frage (Titel? + Antwort); insert(block): ```mermaid-Block einfügen; focusBack() optional.
 */
export function openDiagramDialog({ question, title, insert, focusBack = () => {} }) {
  closeDialog();
  const close = () => { closeDialog(); focusBack(); };
  const status = h('span', { class: 'ai-dialog-status' });
  const grid = h('div', { class: 'diagram-grid' });
  const wish = h('input', {
    type: 'text', class: 'qmenu-input', placeholder: 'Wünsche ans Diagramm (optional), z. B. „als Ablauf“, „nur Ursachen“',
    enterkeyhint: 'go', 'aria-label': 'Wünsche ans Diagramm',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } },
  });
  const go = h('button', { type: 'button', class: 'btn small', onclick: () => run() }, 'Erzeugen');
  const el = h('div', { class: 'ai-dialog diagram-dialog', role: 'dialog', 'aria-label': 'Diagramm zur Frage' },
    h('div', { class: 'ai-dialog-head' }, h('span', { class: 'ai-dialog-label' }, '◇ Diagramm: ' + title + '?'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: close }, '×')),
    h('div', { class: 'diagram-ask' }, wish, go),
    h('div', { class: 'ai-dialog-body' }, grid),
    h('div', { class: 'ai-dialog-foot' }, status, h('button', { type: 'button', class: 'btn small', onclick: close }, 'Schließen')));
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  dialog = { el, onKey, ctrl: null };
  setTimeout(() => wish.focus());

  const pick = (code) => { insert(mermaidBlock(code)); close(); };

  /** Karte für Vorschlag i: zuerst „wird erstellt“, dann Diagramm (prüfen, ggf. korrigieren). */
  const cards = [];
  const card = (i) => {
    if (!cards[i]) {
      cards[i] = h('div', { class: 'diagram-card pending' }, h('span', { class: 'ai-dialog-note loading' }, 'Vorschlag ' + (i + 1) + ' …'));
      grid.append(cards[i]);
    }
    return cards[i];
  };
  const show = async (i, d, signal) => {
    const c = card(i);
    let code = d.code;
    let err = await mermaidError(code);
    if (err) {
      c.replaceChildren(h('span', { class: 'ai-dialog-note loading' }, (d.title || 'Vorschlag ' + (i + 1)) + ': wird korrigiert …'));
      try { code = await repair(code, err, signal); } catch (e) { if (signal.aborted) return; code = null; }
      if (signal.aborted) return;
      if (!code) {
        c.className = 'diagram-card failed';
        c.replaceChildren(h('div', { class: 'diagram-title' }, d.title || 'Vorschlag ' + (i + 1)),
          h('div', { class: 'mermaid-error' }, 'Ließ sich nicht rendern: ' + err));
        return;
      }
    }
    c.className = 'diagram-card';
    c.replaceChildren(
      h('div', { class: 'diagram-title' }, d.title || 'Vorschlag ' + (i + 1)),
      mermaidElement(code, { size: 'card' }),
      h('button', { type: 'button', class: 'btn small diagram-use', onclick: () => pick(code) }, 'Einfügen'));
    c.onclick = (e) => { if (!e.target.closest('button')) pick(code); };
    c.title = 'Antippen: am Ende der Frage einfügen';
  };

  async function run() {
    dialog.ctrl?.abort();
    const ctrl = new AbortController();
    dialog.ctrl = ctrl;
    cards.length = 0;
    grid.replaceChildren();
    go.textContent = 'Neu erzeugen';
    status.textContent = 'Erstellt Vorschläge …';
    for (let i = 0; i < COUNT; i++) card(i);
    let shown = 0;
    const jobs = [];
    const take = (text) => {
      const ds = parseDiagrams(text);
      while (shown < Math.min(ds.length, COUNT)) { jobs.push(show(shown, ds[shown], ctrl.signal)); shown++; }
    };
    try {
      const text = await chat({
        tier: 'good', system: SYSTEM, user: userPrompt(question, wish.value.trim()), maxTokens: 3000,
        timeout: TIMEOUT, signal: ctrl.signal, onDelta: (_d, all) => take(all),
      });
      take(text);
      for (let i = shown; i < cards.length; i++) cards[i].remove(); // weniger als drei geliefert
      await Promise.all(jobs);
      if (ctrl.signal.aborted) return;
      status.textContent = shown ? 'Antippen zum Einfügen' : '';
      if (!shown) grid.replaceChildren(h('span', { class: 'ai-dialog-note err' }, 'Keine Diagramme in der Antwort – nochmal versuchen?'));
    } catch (err) {
      if (ctrl.signal.aborted && dialog?.ctrl !== ctrl) return; // durch „Neu erzeugen“ oder Schließen abgebrochen
      status.textContent = '';
      for (let i = shown; i < cards.length; i++) cards[i].remove();
      grid.append(h('span', { class: 'ai-dialog-note err' },
        err.name === 'TimeoutError' ? 'Keine Antwort (Zeitlimit)' : 'Fehler: ' + (err.message || err.name)));
    }
  }
}
