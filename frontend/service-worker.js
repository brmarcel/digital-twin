/**
 * PWA Service Worker. Kein Offline-Cache: MQTT und Steuerung bleiben live.
 * Verarbeitet ausschließlich Web-Push-Ereignisse und den Klick darauf.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* Fallback */ }
  const title = typeof data.title === 'string' ? data.title : 'Plant Twin';
  const body = typeof data.body === 'string' ? data.body : 'Neue Meldung vom digitalen Zwilling.';
  const tag = typeof data.tag === 'string' ? data.tag : 'plant-twin-notification';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag,
    data: { url: './' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('./', self.registration.scope).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
