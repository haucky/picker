// KI-Diagramme mit Auswahl: Das Sprachmodell (Stufe „gut“) schlägt mehrere Mermaid-Diagramme vor; sie erscheinen
// gerendert (mermaid.js), sobald jedes fertig gestreamt ist. Lässt sich eines nicht rendern, wird es einmal mit der
// Fehlermeldung zur Korrektur zurückgegeben (Stufe „schnell“). Antippen übernimmt einen Vorschlag. Optional: eigene
// Wünsche. Zwei Anwendungen über denselben Dialog (openPicker):
//   openDiagramDialog  – eine Frage als erklärendes Diagramm (drei Vorschläge, ans Ende der Frage)
//   openTimelineDialog – Zeitstrahl aus allen Fragen einer VL (grob/fein, als eigene Frage „Was ist der Zeitstrahl von …?“)
import { h } from './dom.js';
import { chat } from './llm.js';
import { mermaidError, mermaidElement, mermaidBlock } from './mermaid.js';

const TIMEOUT = 150000;
const COUNT = 3;

const SYSTEM_DIAGRAM = `Du erstellst Mermaid-Diagramme, die beim Verstehen einer Lernfrage helfen.
Regeln:
- Genau ${COUNT} Vorschläge, möglichst mit verschiedenen Diagrammtypen bzw. Blickwinkeln (z. B. flowchart, mindmap, \
sequenceDiagram, stateDiagram-v2, timeline, classDiagram, erDiagram, quadrantChart) – nimm, was zum Inhalt passt.
- Das Diagramm muss nicht alles abdecken: lieber einen Kernzusammenhang klar zeigen (Ablauf, Ursache → Wirkung, \
Aufbau, Vergleich, Einordnung). Höchstens etwa 12 Knoten, kurze Beschriftungen in der Sprache der Frage.
- Eher breit als hoch, damit es sich in den Lesefluss eines Textes einfügt (etwa 2:1 bis 3:1): flowchart LR statt \
TD/TB, wenige Ebenen hintereinander statt langer senkrechter Ketten; mindmap und timeline sind ohnehin breit. \
sequenceDiagram nur mit wenigen Teilnehmern.
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

/** Text ohne schon vorhandene Diagramme. */
export const withoutDiagrams = (text) => text.replace(/^```mermaid[ \t]*\n[\s\S]*?\n```[ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

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

/* ---------- Zeitstrahl einer VL ---------- */

/** Ist das der Titel der Zeitstrahl-Frage einer VL? */
export const isTimelineTitle = (title) => /^was ist der zeitstrahl\b/i.test(title.trim());

const SYSTEM_TIMELINE = `Du erstellst aus den Lernfragen einer Vorlesung einen Zeitstrahl als Mermaid-Diagramm (timeline).
Regeln:
- Verwende nur Jahreszahlen, Zeiträume, Personen und Ereignisse, die im Text der Fragen stehen. Ergänze keine Daten \
aus eigenem Wissen und rate nichts.
- Stehen im Text keine Zeitangaben, antworte nur mit: KEINE
- Zuerst eine Zeile „FRAGE: Was ist der Zeitstrahl von <Thema>“: das Thema beschreibt knapp den Inhalt der Vorlesung \
(z. B. „der Entstehung der Sozialen Arbeit in Deutschland 1850–1933“), ohne Fragezeichen und ohne : / \\ * " < > |.
- Dann genau 2 Vorschläge: „grob“ (Epochen/Abschnitte mit section, wenige Einträge) und „fein“ (einzelne Ereignisse).
- Syntax: timeline, dann Zeilen „Zeitpunkt : Ereignis“ (mehrere Ereignisse: „Zeitpunkt : A : B“), optional \
„section Name“. Kein title, kein Styling, keine Doppelpunkte innerhalb eines Ereignisses. Kurze Einträge in der \
Sprache des Textes.
- Ausgabe genau in diesem Format, ohne weiteren Text:
FRAGE: Was ist der Zeitstrahl von <Thema>
### grob
\`\`\`mermaid
timeline
  ...
\`\`\`
### fein
\`\`\`mermaid
timeline
  ...
\`\`\``;

/** Titel der Zeitstrahl-Frage aus der Antwort („FRAGE: …“), als gültiger Dateiname; sonst null. */
export function timelineTitle(text) {
  const m = /^FRAGE:[ \t]*(.+)$/m.exec(String(text));
  if (!m) return null;
  const t = m[1].replace(/[\\/:*"<>|?]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180).trim();
  return isTimelineTitle(t) ? t : null;
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
 * Auswahl-Dialog: optionale Wünsche, „Erzeugen“, dann `count` Vorschläge zum Auswählen.
 * cfg: { label, placeholder, count, request(wish) → { system, user, maxTokens },
 *        empty(text) → Hinweis, wenn die Antwort absichtlich keine Diagramme enthält (oder null),
 *        pick(code, text) – Vorschlag übernommen (text = ganze Antwort), pickHint, focusBack() }
 */
function openPicker(cfg) {
  closeDialog();
  const { count, focusBack = () => {} } = cfg;
  const close = () => { closeDialog(); focusBack(); };
  const status = h('span', { class: 'ai-dialog-status' });
  const grid = h('div', { class: 'diagram-grid' });
  const wish = h('input', {
    type: 'text', class: 'qmenu-input', placeholder: cfg.placeholder, enterkeyhint: 'go', 'aria-label': 'Wünsche ans Diagramm',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } },
  });
  const go = h('button', { type: 'button', class: 'btn small', onclick: () => run() }, 'Erzeugen');
  const el = h('div', { class: 'ai-dialog diagram-dialog', role: 'dialog', 'aria-label': cfg.label },
    h('div', { class: 'ai-dialog-head' }, h('span', { class: 'ai-dialog-label' }, cfg.label),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Schließen', onclick: close }, '×')),
    h('div', { class: 'diagram-ask' }, wish, go),
    h('div', { class: 'ai-dialog-body' }, grid),
    h('div', { class: 'ai-dialog-foot' }, status, h('button', { type: 'button', class: 'btn small', onclick: close }, 'Schließen')));
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  dialog = { el, onKey, ctrl: null };
  setTimeout(() => wish.focus());

  let answer = ''; // bisherige Antwort (für pick)
  const pick = (code) => { cfg.pick(code, answer); close(); };

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
    const err = await mermaidError(code);
    if (err) {
      c.replaceChildren(h('span', { class: 'ai-dialog-note loading' }, (d.title || 'Vorschlag ' + (i + 1)) + ': wird korrigiert …'));
      try { code = await repair(code, err, signal); } catch { if (signal.aborted) return; code = null; }
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
      h('button', { type: 'button', class: 'btn small diagram-use', onclick: () => pick(code) }, 'Übernehmen'));
    c.onclick = (e) => { if (!e.target.closest('button')) pick(code); };
    c.title = cfg.pickHint;
  };

  async function run() {
    dialog.ctrl?.abort();
    const ctrl = new AbortController();
    dialog.ctrl = ctrl;
    cards.length = 0;
    grid.replaceChildren();
    go.textContent = 'Neu erzeugen';
    status.textContent = 'Erstellt Vorschläge …';
    for (let i = 0; i < count; i++) card(i);
    let shown = 0;
    const jobs = [];
    const take = (text) => {
      answer = text;
      const ds = parseDiagrams(text);
      while (shown < Math.min(ds.length, count)) { jobs.push(show(shown, ds[shown], ctrl.signal)); shown++; }
    };
    try {
      const req = cfg.request(wish.value.trim());
      const text = await chat({
        tier: 'good', system: req.system, user: req.user, maxTokens: req.maxTokens || 3000,
        timeout: TIMEOUT, signal: ctrl.signal, onDelta: (_d, all) => take(all),
      });
      take(text);
      for (let i = shown; i < cards.length; i++) cards[i].remove(); // weniger geliefert
      await Promise.all(jobs);
      if (ctrl.signal.aborted) return;
      status.textContent = shown ? 'Antippen zum Übernehmen' : '';
      if (!shown) {
        grid.replaceChildren(h('span', { class: 'ai-dialog-note err' },
          cfg.empty?.(text) || 'Keine Diagramme in der Antwort – nochmal versuchen?'));
      }
    } catch (err) {
      if (ctrl.signal.aborted && dialog?.ctrl !== ctrl) return; // durch „Neu erzeugen“ oder Schließen abgebrochen
      status.textContent = '';
      for (let i = shown; i < cards.length; i++) cards[i].remove();
      grid.append(h('span', { class: 'ai-dialog-note err' },
        err.name === 'TimeoutError' ? 'Keine Antwort (Zeitlimit)' : 'Fehler: ' + (err.message || err.name)));
    }
  }
}

/**
 * Diagramm zu einer Frage: drei Vorschläge.
 * question: Text der Frage (Titel? + Antwort); insert(block): ```mermaid-Block ans Ende der Frage; focusBack() optional.
 */
export function openDiagramDialog({ question, title, insert, focusBack }) {
  openPicker({
    label: '◇ Diagramm: ' + title + '?', count: COUNT, focusBack,
    placeholder: 'Wünsche ans Diagramm (optional), z. B. „als Ablauf“, „nur Ursachen“',
    request: (wish) => ({
      system: SYSTEM_DIAGRAM,
      user: `Lernfrage mit Antwort:\n"""\n${withoutDiagrams(question)}\n"""` + (wish ? `\n\nWünsche ans Diagramm: ${wish}` : ''),
    }),
    pick: (code) => insert(mermaidBlock(code)),
    pickHint: 'Antippen: am Ende der Frage einfügen',
  });
}

/**
 * Zeitstrahl einer VL: zwei Vorschläge (grob, fein).
 * questions: [{ title, body }] der VL (ohne die Zeitstrahl-Frage); fallbackTitle: Fragetitel, falls die KI keinen
 * liefert; apply(title, block): Zeitstrahl-Frage anlegen bzw. ihr Diagramm ersetzen.
 */
export function openTimelineDialog({ questions, label, fallbackTitle, apply, focusBack }) {
  openPicker({
    label: '◇ Zeitstrahl: ' + label, count: 2, focusBack,
    placeholder: 'Wünsche (optional), z. B. „nur Personen“, „nach Epochen“',
    request: (wish) => ({
      system: SYSTEM_TIMELINE, maxTokens: 4000,
      user: 'Lernfragen der Vorlesung mit Antworten:\n"""\n' +
        questions.map((q) => `${q.title}?\n${withoutDiagrams(q.body)}`.trim()).join('\n\n') + '\n"""' +
        (wish ? `\n\nWünsche an den Zeitstrahl: ${wish}` : ''),
    }),
    empty: (text) => (/^\s*KEINE\b/.test(text) ? 'In den Fragen dieser VL stehen keine Zeitangaben.' : null),
    pick: (code, text) => apply(timelineTitle(text) || fallbackTitle, mermaidBlock(code)),
    pickHint: 'Antippen: als Zeitstrahl-Frage oben in die VL',
  });
}
