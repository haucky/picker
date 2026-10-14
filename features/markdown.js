// Einfaches Markdown (Obsidian-Dialekt) → DOM, ohne innerHTML. Überschriften, Listen (verschachtelt, Checkboxen),
// Zitate/Callouts, Code, Tabellen, Trennlinien, fett/kursiv/durchgestrichen/==markiert==, Links, [[Wikilinks]], Bilder.
import { h } from './dom.js';
import { parseSize, splitAlt, sizeImage } from './image.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * ctx: {
 *   openNote(target)          – [[Wikilink]] angetippt (Ziel ohne #Abschnitt)
 *   resolveImage(link)        – Promise<URL|null> für ![[bild.png]] / ![](pfad)
 * }
 */
export function renderMarkdown(text, ctx = {}) {
  const root = h('div', { class: 'md' });
  blocks(text.replace(/\r\n?/g, '\n').split('\n'), root, ctx);
  return root;
}

const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length;
const isBlank = (s) => !s.trim();

function blocks(lines, parent, ctx) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      parent.append(h('pre', {}, h('code', {}, code.join('\n'))));
      continue;
    }

    const hm = HEADING_RE.exec(line);
    if (hm) {
      parent.append(h('h' + Math.min(6, hm[1].length + 2), {}, inline(hm[2], ctx)));
      i++;
      continue;
    }

    if (HR_RE.test(line)) { parent.append(h('hr')); i++; continue; }

    if (/^\s*>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*> ?/, ''));
      const quote = h('blockquote', {});
      const callout = /^\[!([^\]]+)\][+-]?\s*(.*)$/.exec(inner[0] || '');
      if (callout) {
        inner.shift();
        quote.classList.add('callout');
        quote.append(h('div', { class: 'callout-title' }, inline(callout[2] || callout[1], ctx)));
      }
      blocks(inner, quote, ctx);
      parent.append(quote);
      continue;
    }

    if (LIST_RE.test(line)) { i = list(lines, i, parent, ctx); continue; }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      i = table(lines, i, parent, ctx);
      continue;
    }

    // Absatz: bis Leerzeile oder Beginn eines anderen Blocks
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]); // Sicherheitsnetz gegen Endlosschleife
    const p = h('p', {});
    para.forEach((l, k) => { if (k) p.append(h('br')); p.append(inline(l.trim(), ctx)); });
    parent.append(p);
  }
}

function startsBlock(line) {
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || /^\s*>/.test(line) || LIST_RE.test(line);
}

/** Liste ab Zeile i (inkl. Verschachtelung über die Einrückung). Gibt die nächste Zeilennummer zurück. */
function list(lines, i, parent, ctx) {
  const stack = []; // { indent, el, last }
  let lastLi = null;
  while (i < lines.length) {
    const line = lines[i];
    const m = LIST_RE.exec(line);
    if (!m) {
      if (isBlank(line)) {
        // Leerzeile: Liste geht weiter, wenn danach ein Listenpunkt oder eingerückter Text kommt
        const next = lines.slice(i + 1).find((l) => !isBlank(l));
        if (next !== undefined && (LIST_RE.test(next) || indentOf(next) > 0)) { i++; continue; }
        break;
      }
      if (indentOf(line) > 0 && lastLi && !startsBlock(line)) {
        lastLi.append(h('br'), inline(line.trim(), ctx));
        i++;
        continue;
      }
      break;
    }
    const indent = indentOf(m[1]);
    const ordered = /\d/.test(m[2]);
    while (stack.length && stack.at(-1).indent > indent) stack.pop();
    let top = stack.at(-1);
    if (!top || indent > top.indent) {
      const el = h(ordered ? 'ol' : 'ul', {});
      if (ordered && parseInt(m[2], 10) !== 1) el.setAttribute('start', parseInt(m[2], 10));
      (top && top.last ? top.last : parent).append(el);
      top = { indent, el, last: null };
      stack.push(top);
    }
    const li = h('li', {});
    let content = m[3];
    const task = /^\[( |x|X)\]\s+(.*)$/.exec(content);
    if (task) {
      li.classList.add('task');
      li.append(h('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' }), ' ');
      content = task[2];
    }
    li.append(inline(content, ctx));
    top.el.append(li);
    top.last = li;
    lastLi = li;
    i++;
  }
  return i;
}

function table(lines, i, parent, ctx) {
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const head = cells(lines[i]);
  i += 2;
  const body = [];
  while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) body.push(cells(lines[i++]));
  parent.append(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...head.map((c) => h('th', {}, inline(c, ctx))))),
    h('tbody', {}, ...body.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, inline(c, ctx)))))))));
  return i;
}

/* ---------- Inline ---------- */

const INLINE_RE = new RegExp([
  /(?<code>`+)(?<codeText>[\s\S]+?)\k<code>/.source,
  /!\[\[(?<embed>[^\]]+)\]\]/.source,
  /!\[(?<imgAlt>[^\]]*)\]\((?<imgSrc>[^)\s]+)(?:\s+"[^"]*")?\)/.source,
  /\[\[(?<wiki>[^\]]+)\]\]/.source,
  /\[(?<linkText>[^\]]+)\]\((?<linkHref>[^)\s]+)(?:\s+"[^"]*")?\)/.source,
  /(?<url>https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/.source,
  /\*\*(?<bold>[^*]+?)\*\*/.source,
  /(?<![\p{L}\p{N}])__(?<bold2>[^_]+?)__(?![\p{L}\p{N}])/.source,
  /~~(?<strike>.+?)~~/.source,
  /==(?<mark>.+?)==/.source,
  /\*(?<em>[^*\s](?:[^*]*[^*\s])?)\*/.source,
  /(?<![\p{L}\p{N}])_(?<em2>[^_\s](?:[^_]*[^_\s])?)_(?![\p{L}\p{N}])/.source,
  /(?<=^|[\s(])(?<tag>#[\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/.source,
].join('|'), 'gu');

function inline(text, ctx) {
  const frag = document.createDocumentFragment();
  let last = 0;
  const re = new RegExp(INLINE_RE.source, 'gu'); // eigene Instanz, weil rekursiv aufgerufen
  for (let m; (m = re.exec(text)); ) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    const g = m.groups;
    if (g.codeText != null) frag.append(h('code', {}, g.codeText.trim()));
    else if (g.embed != null) frag.append(embed(g.embed, ctx));
    else if (g.imgSrc != null) frag.append(imageOrLink(decode(g.imgSrc), g.imgAlt, ctx));
    else if (g.wiki != null) frag.append(wikilink(g.wiki, ctx));
    else if (g.linkHref != null) frag.append(link(g.linkHref, g.linkText, ctx));
    else if (g.url != null) frag.append(external(g.url, g.url));
    else if (g.bold != null || g.bold2 != null) frag.append(h('strong', {}, inline(g.bold ?? g.bold2, ctx)));
    else if (g.strike != null) frag.append(h('del', {}, inline(g.strike, ctx)));
    else if (g.mark != null) frag.append(h('mark', {}, inline(g.mark, ctx)));
    else if (g.em != null || g.em2 != null) frag.append(h('em', {}, inline(g.em ?? g.em2, ctx)));
    else if (g.tag != null) frag.append(h('span', { class: 'md-tag' }, g.tag));
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function external(href, label) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function wikilink(raw, ctx) {
  const [target, alias] = raw.split('|');
  const name = target.split('#')[0].trim();
  const label = (alias ?? target).trim();
  if (!name || !ctx.openNote) return h('span', { class: 'wikilink' }, label);
  return h('a', { href: '#', class: 'wikilink', onclick: (e) => { e.preventDefault(); ctx.openNote(name); } }, label);
}

function link(href, label, ctx) {
  if (/^(https?:|mailto:)/i.test(href)) return external(href, inline(label, ctx));
  if (/^[a-z][\w+.-]*:/i.test(href)) return document.createTextNode(label);
  return wikilink(decode(href).replace(/\.md$/i, '') + '|' + label, ctx);
}

function embed(raw, ctx) {
  const [target, size] = raw.split('|');
  if (IMAGE_EXT.test(target.split('#')[0].trim())) return image(target.trim(), target.trim(), size, ctx);
  return wikilink(raw, ctx); // Notiz-Einbettung: als Link anzeigen
}

function imageOrLink(src, rawAlt, ctx) {
  const { alt, size } = splitAlt(rawAlt);
  if (/^https?:/i.test(src)) return sizeImage(h('img', { src, alt, loading: 'lazy', class: 'md-img' }), size);
  return image(src, alt || src, size, ctx);
}

function image(link, alt, size, ctx) {
  const img = sizeImage(h('img', { alt, class: 'md-img', hidden: true }), typeof size === 'string' ? parseSize(size) : size);
  const ph = h('span', { class: 'md-img-ph' }, '🖼 ' + alt);
  const wrap = h('span', { class: 'md-img-wrap' }, ph, img);
  if (ctx.resolveImage) {
    ctx.resolveImage(link).then((url) => {
      if (!url) { ph.textContent = '🖼 nicht gefunden: ' + alt; return; }
      img.src = url;
      img.hidden = false;
      ph.remove();
    }).catch(() => { ph.textContent = '🖼 ' + alt + ' (kein Zugriff)'; });
  }
  return wrap;
}
