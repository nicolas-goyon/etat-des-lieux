/* Service worker : rend l'application utilisable hors connexion (dans l'appartement sans réseau).
   Stratégie : réseau d'abord, cache en secours. Incrémentez CACHE à chaque mise à jour. */
const CACHE = 'edl-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/style.css',
  './js/display.js',
  './js/sha256.js',
  './js/util.js',
  './js/templates.js',
  './js/store.js',
  './js/github.js',
  './js/pdf.js',
  './js/remote.js',
  './js/app.js',
  './vendor/jspdf.umd.min.js',
  './vendor/peerjs.min.js',
  './vendor/qrcode.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(ASSETS.map(a => cache.add(a).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // l'API GitHub n'est jamais mise en cache
  event.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && !url.search.includes('t=')) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
