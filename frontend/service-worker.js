/**
 * Service Worker – PWA Schritt 1.
 * Verwendet absichtlich keinen Fetch-Handler und kein Offline-Caching.
 * Somit bleiben MQTT-Messwerte, Steuerbefehle und die CDN-Module unverändert
 * und werden niemals aus einem veralteten Service-Worker-Cache geladen.
 * Push-Events koennen in einem spaeteren Schritt hier ergaenzt werden.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
