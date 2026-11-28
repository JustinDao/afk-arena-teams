const IMAGE_CACHE = 'afk-cdn-images-v1';
const META_CACHE = 'afk-cdn-meta-v1';
const ALLOWED_CACHES = new Set([IMAGE_CACHE, META_CACHE]);
const CDN_PREFIX = 'https://raw.githubusercontent.com/afk-mine/cdn/';
const MAX_IMAGE_ENTRIES = 2500;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('afk-cdn-') && !ALLOWED_CACHES.has(key))
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  await Promise.all(keys.slice(0, excess).map((req) => cache.delete(req)));
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone()).then(() => trimCache(IMAGE_CACHE, MAX_IMAGE_ENTRIES));
  }
  return response;
}

async function staleWhileRevalidateMeta(request) {
  const cache = await caches.open(META_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }
  const fresh = await networkPromise;
  return fresh || new Response('Offline', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(CDN_PREFIX)) return;

  if (request.url.endsWith('/unit.json')) {
    event.respondWith(staleWhileRevalidateMeta(request));
    return;
  }

  if (/\.(webp|png|jpe?g|svg)(\?.*)?$/i.test(request.url)) {
    event.respondWith(cacheFirstImage(request));
  }
});
