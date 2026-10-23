/* Fretbored service worker: works offline and keeps itself up to date.
 *
 * Strategy (stale-while-revalidate): app files are answered from the cache — instant, and it works
 * offline — while a fresh copy is fetched in the background and stored. So each launch runs the
 * version downloaded during the previous one, and there is no version number to bump on deploy.
 * Keep FILES in step with index.html (tests/pwa.browser.js checks it).
 */
'use strict';
const CACHE = 'fretbored';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/theory.js',
  'js/tunings.js',
  'js/store.js',
  'js/audio.js',
  'js/fretboard.js',
  'js/fbcontrols.js',
  'js/nowbar.js',
  'js/scales.js',
  'js/chords.js',
  'js/arpeggios.js',
  'js/circle.js',
  'js/trainer.js',
  'js/metronome.js',
  'js/pitch.js',
  'js/tuner.js',
  'js/app.js',
  'assets/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
      const cached = await cache.match(key);
      // Always revalidate with the server (bypassing the HTTP cache) and keep the newest copy.
      const fresh = fetch(new Request(key, { cache: 'no-cache', credentials: 'same-origin' }))
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(fresh);
        return cached;
      }
      return (await fresh) || Response.error();
    })
  );
});
