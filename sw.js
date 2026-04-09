// Maine Basketball Rankings Baseball Scorer — Service Worker
const CACHE = 'mbr-scorer-v1';
const PRECACHE = [
  './baseball_scorer.html',
  './index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600&family=Barlow+Condensed:wght@400;600;700;800;900&family=Playfair+Display:wght@700;900&display=swap',
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

// Fetch: cache-first for app shell, network-first for Supabase
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go to network for Supabase (live data + inserts)
  if(url.hostname.includes('supabase.co')) return;
  // Always go to network for Cloudinary (logos)
  if(url.hostname.includes('cloudinary.com')) return;

  // Cache-first for everything else (app shell, fonts, jspdf)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        // Cache successful GET responses
        if(e.request.method === 'GET' && res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for navigation requests
        if(e.request.mode === 'navigate'){
          return caches.match('./index.html') || caches.match('./baseball_scorer.html');
        }
      });
    })
  );
});
