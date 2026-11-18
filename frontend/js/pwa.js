import { initWebPush } from './webPush.js';

/**
 * PWA-Registrierung (Schritt 3).
 * Absichtlich unabhängig von der bestehenden MQTT-/Pumpen-/3D-Logik.
 * Keine Offline-Caches. Push-Berechtigung nur nach Klick auf die Schaltfläche.
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    try {
      // URL relativ zu dieser Datei, unabhängig vom Vercel Root Directory.
      const workerURL = new URL('../service-worker.js', import.meta.url);
      const registration = await navigator.serviceWorker.register(workerURL);
      await initWebPush(registration);
      console.info('Plant Twin: PWA-Service-Worker registriert.');
    } catch (error) {
      // Das Dashboard funktioniert weiterhin ganz normal.
      console.warn('Plant Twin: PWA konnte nicht registriert werden:', error);
    }
  });
}
