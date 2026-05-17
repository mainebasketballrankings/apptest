// Maine Basketball Rankings — Service Worker
// Sole purpose: cache Cloudinary logos for 24h to reduce CDN quota usage.
// HTML pages are never cached — always fetched fresh from network.
const CACHE = 'mbr-logos-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only intercept Cloudinary requests — everything else goes straight to network
  if (!e.request.url.includes('cloudinary.com')) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request);
      if (cached) {
        const age = Date.now() - new Date(cached.headers.get('date') || 0).getTime();
        if (age < 86_400_000) return cached; // under 24h — serve from cache
      }
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return cached || new Response('', { status: 503 });
      }
    })
  );
});
