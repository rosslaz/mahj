// Mahjong League service worker
const CACHE = 'mahjong-league-v1';
const ASSETS = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Network-first for Supabase API + Next data
  if (url.origin !== self.location.origin || url.pathname.startsWith('/_next/data')) {
    event.respondWith(fetch(request).catch(() => caches.match(request) as Promise<Response>));
    return;
  }

  // Stale-while-revalidate for app shell
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached as Response);
      return cached || fetchPromise;
    })
  );
});
