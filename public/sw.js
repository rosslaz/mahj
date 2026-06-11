/* Pungctual service worker
 *
 * Strategy:
 *   - Static assets (icons, manifest, background): cache-first.
 *   - App routes (HTML): network-first with cache fallback. We never
 *     want to serve stale HTML for authenticated pages.
 *   - Auth + API: network-only. Magic-link callbacks have one-shot codes
 *     that can't be served from cache. Supabase responses also must hit
 *     the network for live data.
 *   - Offline: if the network fails and there's no cache, we fall back to
 *     a tiny inline offline page so users get *something* rather than a
 *     browser error.
 *
 * Cache version is injected at build time by a string-replace pass.
 * The CACHE_VERSION literal below ("__BUILD_ID__" before deploy, or a
 * timestamp the build script substitutes) ensures every deploy rolls a
 * fresh cache so users don't get pinned to old HTML forever.
 */

const CACHE_VERSION = 'v2.10.3';     // bump on every deploy
const STATIC_CACHE = `pungctual-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pungctual-runtime-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/pungctual-logo.png',
  '/pungctual-bg.webp',
];

// Pre-cache the small set of always-needed assets on install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => { /* allow install to succeed even if pre-cache fails */ })
  );
  self.skipWaiting();
});

// Clean out old caches on activate. Anything not starting with our current
// CACHE_VERSION suffix gets dropped so old deploys can't pin users.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // Never cache auth callbacks or Supabase API responses.
  // Magic-link codes are one-shot and Supabase data must be live.
  if (
    !isSameOrigin ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/api/')
  ) {
    // Network-only. Let the browser handle failure (it'll show its own
    // error page, which is appropriate for an auth flow.)
    return;
  }

  // Static assets: cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon') ||
    url.pathname === '/pungctual-bg.webp' ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (HTML pages, _next/data): network-first.
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return cached || new Response('', { status: 504 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last-resort offline page for navigations.
    if (request.mode === 'navigate') {
      return new Response(OFFLINE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      });
    }
    return new Response('', { status: 504 });
  }
}

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Offline — Pungctual</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f5efe6; color:#1a1410;
         font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  main { text-align:center; padding: 3rem 1.5rem; max-width: 28rem; }
  h1 { font-family: Georgia, 'Cormorant Garamond', serif; font-weight: 500;
       font-size: 3rem; margin: 0 0 .5rem; letter-spacing: -0.02em; }
  p { color: rgba(26,20,16,.6); line-height: 1.6; }
  .glyph { font-size: 4rem; margin-bottom: 1rem; color: #3d6b4f; }
  .note { font-size: .8rem; letter-spacing: .2em; text-transform: uppercase; color: rgba(26,20,16,.4); margin-top: 2rem; }
</style>
</head>
<body>
  <main>
    <div class="glyph">發</div>
    <h1>Offline</h1>
    <p>No connection right now. We'll be back as soon as you're online again.</p>
    <p class="note">Pungctual</p>
  </main>
</body>
</html>`;

// ============================================================
// Push notifications
//
// The server sends a push to the user's subscription endpoint with an
// encrypted JSON payload. The push service wakes the SW and fires the
// 'push' event, where we extract the payload and call showNotification().
//
// Payload shape (we control this from our server):
//   {
//     title: "Sarah signed up",
//     body: "Tuesday Night League — Night 4",
//     url: "/c/test-club/a/tuesday/events/<uuid>",
//     tag: "signup-<eventId>",   // groups related notifications
//     silent: false              // honors user's sound prefs server-side
//   }
//
// 'notificationclick' opens (or focuses) the app at the URL.
// ============================================================

self.addEventListener('push', (event) => {
  // No payload = nothing to show. Some browsers send empty pushes as a
  // background-sync ping; we just ignore them.
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Fallback if the server somehow sent plain text
    payload = { title: 'Pungctual', body: event.data.text() };
  }

  const title = payload.title || 'Pungctual';
  const options = {
    body: payload.body || '',
    // The icon shown in the notification. /icon-192.png is our PWA icon.
    icon: '/icon-192.png',
    // Small monochrome badge for Android status bar. We don't have a
    // dedicated monochrome icon yet; reuse icon-192 (Android will tint it).
    badge: '/icon-192.png',
    // tag = stacking key. Notifications with the same tag replace each other
    // instead of accumulating. Server sets this to group e.g. signup-<eventId>
    // so "5 people signed up" doesn't produce 5 separate alerts.
    tag: payload.tag,
    data: { url: payload.url || '/' },
    // Default to whatever the OS says. If the server flags silent: true
    // (because the user disabled sound in prefs), we suppress the alert tone.
    silent: payload.silent === true,
    // requireInteraction would keep the notification until clicked. We don't
    // want that — even reminders should auto-dismiss.
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  // Try to focus an existing tab on our origin. If one is open, navigate it
  // to the target URL and focus. Otherwise open a new window.
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      // Find a client that's already on our origin
      try {
        const clientUrl = new URL(client.url);
        const target = new URL(targetUrl, self.location.origin);
        if (clientUrl.origin === target.origin) {
          await client.focus();
          // Navigate to the target URL (in case they're on a different page)
          if ('navigate' in client) {
            try { await client.navigate(target.href); } catch { /* navigation blocked, ignore */ }
          }
          return;
        }
      } catch { /* ignore malformed URLs */ }
    }
    // No existing window — open a fresh one
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

// Handle subscription expirations. The browser may rotate the user's push
// subscription (e.g. Chrome does this periodically). We re-subscribe and
// the client will pick up the new sub on next page load.
self.addEventListener('pushsubscriptionchange', (event) => {
  // No-op for now — full re-subscribe flow happens client-side. We'd want
  // to call back into our server with the new sub here for full robustness,
  // but pushsubscriptionchange has limited browser support. Easier to detect
  // stale subs server-side (failed push → mark sub for cleanup).
});
