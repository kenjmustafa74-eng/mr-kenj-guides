/*
 * Service worker: keeps the app shell for a fast start and offline use.
 * Works at any address (the site root on the Node server, or /mr-kenj-guides/year-five/ on GitHub Pages):
 * every path is relative to this worker's scope, and the cache name includes the scope so that two guides
 * on the same website (Year Five and Year Six) never clear each other's files.
 * Answers, teacher data and Firebase traffic are never cached.
 */
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;
const PREFIX = `kenj:${SCOPE_PATH}:`;
const VERSION = `${PREFIX}v2`;
const SHELL = ['./', 'css/app.css', 'js/app.js', 'js/game.js', 'js/icons.js', 'js/progress-core.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']
  .map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => (k.startsWith(PREFIX) && k !== VERSION) || k === 'kenj-v1').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const save = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  const rel = url.pathname.slice(SCOPE_PATH.length);
  if (rel.startsWith('api/')) {
    // Node server: content and config are network first with an offline copy; everything else is never cached.
    if (rel === 'api/content' || rel === 'api/config') e.respondWith(fetch(e.request).then((r) => save(e.request, r)).catch(() => caches.match(e.request)));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => save(SCOPE, r)).catch(() => caches.match(SCOPE)));
    return;
  }
  // Static files (and content.json in the static build): network first so updates show at once; cache when offline.
  e.respondWith(fetch(e.request).then((r) => save(e.request, r)).catch(() => caches.match(e.request)));
});
