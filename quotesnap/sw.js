/*
 * QuoteSnap offline support.
 * Network first (so updates show up straight away), falling back to the saved copy when offline.
 * Bump VERSION when you deploy big changes to clear old caches.
 */
const VERSION = 'qs-2026-10-19-1';
const CORE = [
  './', './index.html', './app.html', './privacy.html', './terms.html', './404.html', './manifest.webmanifest',
  './css/styles.css',
  './js/config.js', './js/regions.js', './js/engine.js', './js/samples.js', './js/team.js', './js/store.js', './js/app.js', './js/landing.js', './js/legal.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./app.html') : undefined)))
  );
});
