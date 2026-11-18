/**
 * PWA-Registrierung (Schritt 1).
 * Absichtlich unabhängig von der bestehenden MQTT-/Pumpen-/3D-Logik.
 * Keine Offline-Caches, Push-Anmeldungen oder Berechtigungsabfragen.
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', async () => {
    try {
      // URL relativ zu dieser Datei, unabhängig vom Vercel Root Directory.
      const workerURL = new URL('../service-worker.js', import.meta.url);
      await navigator.serviceWorker.register(workerURL);
      console.info('Plant Twin: PWA-Service-Worker registriert.');
    } catch (error) {
      // Das Dashboard funktioniert weiterhin ganz normal.
      console.warn('Plant Twin: PWA konnte nicht registriert werden:', error);
    }
  });
}
