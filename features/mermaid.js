// Mermaid-Diagramme (```mermaid-Codeblöcke wie in Obsidian) mit Pele rendern – dem Mermaid-Renderer, den Obsidian für
// seine nächste Version gebaut hat (vendor/pele.js, MIT). Pele wird erst geladen, wenn ein Diagramm vorkommt, und
// rendert danach synchron. Farben kommen über CSS-Variablen aus dem Solarized-Theme (style.css, .mermaid-view), daher
// wechselt ein Diagramm mit hell/dunkel mit, ohne neu gerendert zu werden.
//
// Pele liefert fertiges SVG als Text; es maskiert Diagrammtext selbst, Links und Bilder sind hier ausgeschaltet.
import { h } from './dom.js';
import { openLightboxElement } from './image.js';

// Größe im Text wie ein Bild ohne Angabe („normal“, style.css img.img-normal): höchstens 480 × 320 px.
const SIZES = { normal: { w: 480, h: 320 }, card: { w: Infinity, h: 360 }, free: null };

let peleP = null;
let pele = null;
let seq = 0;

/** Pele laden (einmal). */
export function loadPele() {
  if (!peleP) {
    peleP = import('../vendor/pele.js').then((m) => { pele = m; return m; });
    peleP.catch(() => { peleP = null; });
  }
  return peleP;
}

/** Ist ```-Zeile der Anfang eines Mermaid-Blocks? (Info-String „mermaid“) */
export const isMermaidFence = (line) => /^\s*(`{3,}|~{3,})\s*mermaid\s*$/i.test(line);

/** Mermaid-Text → { svg, width, height }; wirft bei Fehlern (PeleError mit Zeile/Spalte). Nur nach loadPele(). */
function renderSvg(code) {
  return pele.render(code, { idPrefix: `mmd${++seq}-`, links: false, images: false });
}

/** Fehlermeldung zu einem Diagramm (null = lässt sich rendern). */
export async function mermaidError(code) {
  await loadPele();
  try { renderSvg(code); return null; } catch (err) { return err.message || String(err); }
}

/**
 * Element mit dem gerenderten Diagramm (sofort, wenn Pele schon geladen ist, sonst sobald es da ist). Bei
 * Syntaxfehlern: Meldung und der Code. Optionen:
 *   size: 'normal' (wie ein Bild, Standard) | 'card' (Auswahl-Dialog) | 'free' (Großansicht)
 *   zoom: Antippen öffnet die Großansicht wie bei Bildern (Standard bei 'normal')
 *   onError(meldung)
 * Gelungen: Klasse „ok“ am Element.
 */
export function mermaidElement(code, { size = 'normal', zoom = size === 'normal', onError } = {}) {
  const el = h('div', { class: 'mermaid-view' });
  const fail = (msg) => {
    el.replaceChildren(h('div', { class: 'mermaid-error' }, 'Diagramm: ' + msg), h('pre', {}, h('code', {}, code)));
    onError?.(msg);
  };
  const draw = () => {
    let r;
    try { r = renderSvg(code); } catch (err) { return fail(err.message || String(err)); }
    el.innerHTML = r.svg;
    el.classList.add('ok');
    el.style.setProperty('--ratio', r.width / r.height);
    const box = SIZES[size];
    // Breite so, dass das Diagramm in den Rahmen passt (Höhe folgt über viewBox)
    if (box) el.firstElementChild.style.width = Math.min(r.width, box.w, box.h * r.width / r.height) + 'px';
    if (zoom) {
      el.classList.add('zoomable');
      el.title = 'Antippen: groß anzeigen';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openLightboxElement(mermaidElement(code, { size: 'free', zoom: false }));
      });
    }
  };
  if (pele) draw();
  else {
    el.append(h('span', { class: 'mermaid-loading' }, 'Diagramm …'));
    loadPele().then(draw, () => fail('Renderer konnte nicht geladen werden'));
  }
  return el;
}

/** Codeblock für den Text einer Notiz. */
export const mermaidBlock = (code) => '```mermaid\n' + code.trim() + '\n```';
