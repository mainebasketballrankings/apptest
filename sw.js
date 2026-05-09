// Maine Basketball Rankings Baseball Scorer — Service Worker
const CACHE = 'mbr-scorer-v13';
const PRECACHE = [
  './baseball_scorer.html',
  './index.html',
  './boxscore-import.html',
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

// Fetch: network-first for HTML pages, cache-first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go to network for Supabase (live data + inserts)
  if(url.hostname.includes('supabase.co')) return;
  // Always go to network for Cloudinary (logos)
  if(url.hostname.includes('cloudinary.com')) return;
  // Always go to network for Anthropic proxy calls
  if(url.hostname.includes('anthropic.com')) return;

  // Network-first for ALL HTML navigations — never serve a stale page
  if(e.request.mode === 'navigate' || url.pathname.endsWith('.html')){
    e.respondWith(
      fetch(e.request).then(res => {
        if(res.ok){
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

  // Cache-first for static assets (fonts, jsPDF, etc.) — these never change
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(e.request.method === 'GET' && res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
