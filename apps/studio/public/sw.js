/* Bazi-Sazi service worker: makes the studio and games installable and fast.
 * - Immutable files (hashed bundles, Starter Content, uploads) → cache-first.
 * - Pages → network-first, falling back to the cached copy when offline.
 * - API and WebSocket traffic is never cached. */
const VERSION = 'bz-v2';
const CORE = ['/', '/player.html', '/favicon.svg', '/manifest.webmanifest'];
const IMMUTABLE = /^\/(assets|samples|templates|icons|files)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) ?? (await caches.match('/'))),
    );
  }
});
