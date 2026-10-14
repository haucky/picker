// Bilder: Größenangaben wie in Obsidian (![[bild.png|100]], ![[bild.png|100x145]], ![alt|100](pfad)) plus
// small / normal / big, und Großansicht als Overlay beim Antippen.

const KEYWORDS = new Set(['small', 'normal', 'big']);

/** Größe aus dem Text hinter '|' (bzw. dem Alt-Text): { keyword } | { width, height? } | null. */
export function parseSize(text) {
  const t = (text || '').trim().toLowerCase();
  if (KEYWORDS.has(t)) return { keyword: t };
  const m = /^(\d+)(?:\s*x\s*(\d+))?$/.exec(t);
  return m ? { width: +m[1], height: m[2] ? +m[2] : null } : null;
}

/**
 * Alt-Text eines Markdown-Bilds in Text und Größe zerlegen: „Folie|small“, „Folie|100“, „100x200“ → { alt, size }.
 */
export function splitAlt(alt) {
  const i = (alt || '').lastIndexOf('|');
  if (i >= 0) {
    const size = parseSize(alt.slice(i + 1));
    if (size) return { alt: alt.slice(0, i), size };
  }
  const size = parseSize(alt);
  return size ? { alt: '', size } : { alt: alt || '', size: null };
}

/** Setzt Klasse/Maße am <img> (ohne Angabe: normal) und öffnet beim Antippen die Großansicht. */
export function sizeImage(img, size) {
  img.classList.add('img-sized');
  if (size && size.width) {
    img.style.width = size.width + 'px';
    if (size.height) { img.style.height = size.height + 'px'; img.style.objectFit = 'contain'; }
  } else {
    img.classList.add('img-' + (size?.keyword || 'normal'));
  }
  img.addEventListener('mousedown', (e) => e.preventDefault());
  img.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (img.src) openLightbox(img.src, img.alt);
  });
  return img;
}

/* ---------- Großansicht ---------- */

let box = null;

function close() {
  if (!box) return;
  box.remove();
  box = null;
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leave(); }
}

// Schließen über die Zurück-Geste: eigener Verlaufseintrag; X/Esc/Hintergrund gehen darüber zurück.
function leave() {
  if (history.state && history.state.lightbox) history.back(); else close();
}

window.addEventListener('popstate', () => { if (box && !(history.state && history.state.lightbox)) close(); });

/** Bild groß anzeigen: eingepasst; Antippen wechselt zur Originalgröße (dann scrollbar), Hintergrund/X/Esc schließt. */
export function openLightbox(src, alt = '') {
  close();
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.className = 'lightbox-img';
  img.addEventListener('click', (e) => { e.stopPropagation(); box.classList.toggle('zoomed'); });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lightbox-close';
  btn.setAttribute('aria-label', 'Schließen');
  btn.textContent = '×';
  btn.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
  box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.append(img, btn);
  box.addEventListener('click', leave);
  document.body.append(box);
  document.addEventListener('keydown', onKey, true);
  history.pushState({ ...(history.state || {}), lightbox: true }, '');
}
