// Service worker disabled — unregisters itself
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    self.registration.unregister().then(() => self.clients.matchAll()).then(clients => {
      clients.forEach(client => client.navigate(client.url));
    })
  );
});
