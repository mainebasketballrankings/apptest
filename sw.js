// Maine Basketball Rankings — Service Worker
const CACHE = 'mbr-scorer-v14';
const PRECACHE = [
  './baseball_scorer.html',
  './index.html',
  './boxscore-import.html',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  // Google Fonts CSS intentionally excluded — dynamic, browser handles it well natively
];

// Install: cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//   Supabase / Anthropic → always network (live data)
//   Cloudinary           → cache-first, 24h TTL (logos don't change)
//   HTML navigations     → network-first with cache fallback
//   Everything else      → cache-first (fonts, jsPDF, static assets)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network for live data and API calls
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('anthropic.com')) return;

  // Cloudinary: cache-first with 24h TTL
  if (url.hostname.includes('cloudinary.com')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) {
          const age = Date.now() - new Date(cached.headers.get('date') || 0).getTime();
          if (age < 86_400_000) return cached; // under 24h — serve from cache
        }
        // Expired or missing — fetch and re-cache
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch {
          return cached || new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Network-first for HTML navigations
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(async () => {
        const cached = await caches.match(e.request);
        return cached || caches.match('./index.html');
      })
    );
    return;
  }

  // Cache-first for static assets (jsPDF, fonts, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (e.request.method === 'GET' && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
