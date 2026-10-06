// Offline support: every file the app needs is stored on the device at install.
// VERSION and ASSETS are written by tools/stamp-sw.mjs. Do not edit by hand.
const VERSION = 'c85243febb48';
const ASSETS = ["./","./app.css","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./manifest.webmanifest","./src/config.js","./src/dom.js","./src/domain/csv.js","./src/domain/due.js","./src/domain/license.js","./src/domain/service.js","./src/main.js","./src/nav.js","./src/pdf.js","./src/sample.js","./src/store.js","./src/views/customers.js","./src/views/due.js","./src/views/jobs.js","./src/views/settings.js","./src/views/shared.js","./src/views/truck.js","./vendor/pdf-lib.esm.min.js"];

const CACHE = 'tankdue-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tankdue-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return fetch(req);
  })());
});
