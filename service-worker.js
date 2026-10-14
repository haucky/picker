'use strict';

// Version erhöhen, wenn sich die App-Shell ändert.
const CACHE = 'vault-picker-v13';
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
  './vendor/codemirror.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
    const network = fetch(req)
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
