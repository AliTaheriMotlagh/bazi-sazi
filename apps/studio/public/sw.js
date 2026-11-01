/* Bazi-Sazi service worker: makes the studio and games installable and fast.
 * - Immutable files (hashed bundles, Starter Content, uploads) → cache-first.
 * - Pages → network-first, falling back to the cached copy when offline.
 * - API and WebSocket traffic is never cached. */
const VERSION = 'bz-v5';
/* Thumbnails from free-resource sites: cached on first sight so the browser opens instantly the next time. */
const IMAGES = 'bz-remote-images-v1';
const IMAGE_HOSTS = /^(cdn\.polyhaven\.com|dl\.polyhaven\.org|upload\.wikimedia\.org|media\.sketchfab\.com)$/;
const MAX_REMOTE_IMAGES = 400;
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== IMAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.destination === 'image' && IMAGE_HOSTS.test(url.hostname)) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        // Opaque (no-cors) responses can't be inspected but are fine to replay for <img>.
        if (res.ok || res.type === 'opaque') {
          cache.put(req, res.clone());
          cache.keys().then((keys) => keys.length > MAX_REMOTE_IMAGES && cache.delete(keys[0]));
        }
        return res;
      }),
    );
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        // Never trust a cached HTML page standing in for a script/asset (a failed deploy can produce one).
        if (hit && !(hit.headers.get('content-type') ?? '').includes('text/html')) return hit;
        const res = await fetch(req);
        const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
        if (res.ok && res.type === 'basic' && !isHtml) cache.put(req, res.clone());
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
