'use strict';

// Version erhöhen, wenn sich die App-Shell ändert.
const CACHE = 'vault-picker-v25';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core.js',
  './features/dom.js',
  './features/search.js',
  './features/tagging.js',
  './features/study.js',
  './features/studydoc.js',
  './features/review.js',
  './features/srs.js',
  './features/markdown.js',
  './features/sync.js',
  './features/theme.js',
  './features/editor.js',
  './features/spell.js',
  './features/image.js',
  './features/export.js',
  './features/llm.js',
  './features/aicorrect.js',
  './features/prompts.js',
  './features/tags.js',
  './vendor/fonts/lmroman10-regular.woff2',
  './vendor/fonts/lmroman10-bold.woff2',
  './vendor/fonts/lmroman10-italic.woff2',
  './vendor/fonts/lmroman10-bolditalic.woff2',
  './vendor/fonts/lmmono10-regular.woff2',
  './vendor/codemirror.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' – am HTTP-Cache des Browsers vorbei (GitHub Pages erlaubt 10 Min.), sonst landen alte Dateien
  // im neuen Cache.
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: sofort aus dem Cache (offline-fähig), im Hintergrund aktualisieren.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const lookup = req.mode === 'navigate' ? './index.html' : req;
    const cached = await cache.match(lookup, { ignoreSearch: true });
    const network = fetch(req, { cache: 'no-cache' }) // beim Server nachfragen (ETag), nicht den HTTP-Cache nehmen
      .then((res) => {
        if (res.ok) cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
        return res;
      })
      .catch(() => cached);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || Response.error();
  })());
});
