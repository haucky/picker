// Bilder: Größenangaben wie in Obsidian (![[bild.png|100]], ![[bild.png|100x145]], ![alt|100](pfad)) plus
// small / normal / big, und Großansicht als Overlay beim Antippen – mit Blättern durch die Bilder derselben Zeile.

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
    if (!img.src) return;
    const row = rowOf(img);
    openLightbox(row, row.indexOf(img));
  });
  return img;
}

/** Bilder derselben Zeile: im Editor die .cm-line, sonst der Abschnitt zwischen zwei <br> im selben Absatz. */
function rowOf(img) {
  const loaded = (list) => list.filter((i) => i.src);
  const line = img.closest('.cm-line');
  if (line) return loaded([...line.querySelectorAll('img.img-sized')]);
  const self = img.closest('.md-img-wrap') || img;
  const parent = self.parentElement;
  if (!parent) return [img];
  let seg = [];
  for (const node of parent.childNodes) {
    if (node.nodeName === 'BR') { if (seg.includes(self)) break; seg = []; continue; }
    seg.push(node);
  }
  const imgs = seg.flatMap((n) => (n.nodeName === 'IMG' ? [n] : n.querySelectorAll ? [...n.querySelectorAll('img.img-sized')] : []));
  return loaded(imgs.filter((i) => i.classList.contains('img-sized')));
}

/* ---------- Großansicht ---------- */

let box = null;

function close() {
  if (!box) return;
  box.remove();
  box = null;
  gallery = null;
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e) {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (e.key === 'Escape') leave();
  else if (step) gallery?.show(gallery.index + step);
  else return;
  e.preventDefault();
  e.stopPropagation();
}

// Schließen über die Zurück-Geste: eigener Verlaufseintrag; X/Esc/Hintergrund gehen darüber zurück.
function leave() {
  if (history.state && history.state.lightbox) history.back(); else close();
}

window.addEventListener('popstate', () => { if (box && !(history.state && history.state.lightbox)) close(); });

let gallery = null; // { images: [<img>], index, show(i) }

function button(cls, label, text, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.setAttribute('aria-label', label);
  b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

/**
 * Großansicht für `images[index]`: eingepasst; Antippen wechselt zur Originalgröße (dann scrollbar).
 * Mehrere Bilder: Pfeile, Pfeiltasten ←/→ und Wischen blättern (ohne Umlauf). Hintergrund/×/Esc/Zurück schließt.
 */
export function openLightbox(images, index = 0) {
  close();
  const img = document.createElement('img');
  img.className = 'lightbox-img';
  img.addEventListener('click', (e) => { e.stopPropagation(); box.classList.toggle('zoomed'); });
  const count = document.createElement('div');
  count.className = 'lightbox-count';
  const prev = button('lightbox-nav prev', 'Vorheriges Bild', '‹', () => gallery.show(gallery.index - 1));
  const next = button('lightbox-nav next', 'Nächstes Bild', '›', () => gallery.show(gallery.index + 1));
  const many = images.length > 1;
  gallery = {
    images,
    index,
    show(i) {
      if (i < 0 || i >= images.length) return;
      this.index = i;
      img.src = images[i].src;
      img.alt = images[i].alt;
      box.classList.remove('zoomed');
      box.scrollTo(0, 0);
      count.textContent = `${i + 1} / ${images.length}`;
      // nicht `disabled`: ein Klick darauf würde sonst zum Hintergrund durchgehen und schließen
      prev.classList.toggle('off', i === 0);
      next.classList.toggle('off', i === images.length - 1);
    },
  };
  box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.append(img, button('lightbox-close', 'Schließen', '×', leave));
  if (many) box.append(prev, next, count);
  box.addEventListener('click', leave);

  // Wischen (nur eingepasst, nicht in der Originalgröße – dort wird gescrollt)
  let start = null;
  box.addEventListener('touchstart', (e) => { start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (!start || !many || box.classList.contains('zoomed')) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) gallery.show(gallery.index + (dx < 0 ? 1 : -1));
  });

  document.body.append(box);
  gallery.show(index);
  document.addEventListener('keydown', onKey, true);
  history.pushState({ ...(history.state || {}), lightbox: true }, '');
}
