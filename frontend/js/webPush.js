/**
 * Web Push auf diesem Gerät ohne Passwort aktivieren/testen/deaktivieren.
 * KEINE Änderung am MQTT-Lesepfad; Freigabe nur per bewusstem Klick.
 */
const DEVICE_TOKEN_KEY = 'plant-twin-push-device-token-v1';
const API = './api/push';

function keyBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function api(action, data = {}, secretHeader = {}) {
  const response = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...secretHeader },
    body: JSON.stringify({ action, ...data }), cache: 'no-store'
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function getToken() {
  try { return localStorage.getItem(DEVICE_TOKEN_KEY); }
  catch { return null; }
}
function saveToken(token) {
  try { localStorage.setItem(DEVICE_TOKEN_KEY, token); }
  catch { throw new Error('Browser-Speicher nicht verfügbar. Push kann nicht aktiviert werden.'); }
}
function clearToken() {
  try { localStorage.removeItem(DEVICE_TOKEN_KEY); } catch { /* optional */ }
}

export async function initWebPush(registration) {
  const enable = document.getElementById('push-enable');
  const test = document.getElementById('push-test');
  const disable = document.getElementById('push-disable');
  const diagnostics = document.getElementById('push-diagnostics');
  const status = document.getElementById('push-status');
  if (!enable || !test || !disable || !status) return;

  let publicKey = null;
  let busy = false;
  const supported = window.isSecureContext && 'Notification' in window && Boolean(registration?.pushManager);
  function message(text) { status.textContent = text; }
  function buttons(active) {
    enable.hidden = active;
    disable.hidden = !active;
    if (diagnostics) diagnostics.hidden = !active;
    enable.disabled = busy; test.disabled = busy; disable.disabled = busy;
  }
  async function refresh(note = null) {
    const subscription = supported ? await registration.pushManager.getSubscription() : null;
    const active = Boolean(subscription && getToken());
    buttons(active);
    if (note) message(note);
    else if (active) message('Push ist auf diesem Gerät aktiviert.');
    else if (subscription) message('Abonnement vorhanden. Mit „Push aktivieren“ erneut registrieren.');
    else message('Push ist auf diesem Gerät noch nicht aktiviert.');
  }
  if (!supported) {
    buttons(false);
    enable.disabled = true;
    message('Web Push wird hier nicht unterstützt. Auf dem iPhone die installierte PWA öffnen.');
    return;
  }
  try {
    const response = await fetch(API, { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok || !config.enabled || !config.vapidPublicKey) {
      buttons(false); enable.disabled = true;
      message('Push-Server noch nicht eingerichtet (Vercel-Variablen prüfen).');
      return;
    }
    publicKey = config.vapidPublicKey;
    await refresh();
  } catch {
    buttons(false); enable.disabled = true;
    message('Push-Server nicht erreichbar. Vercel-Deployment prüfen.');
    return;
  }

  enable.addEventListener('click', async () => {
    if (busy) return;
    // iOS verlangt die Berechtigungsabfrage unmittelbar nach einer Benutzeraktion.
    busy = true; buttons(false);
    let resultMessage = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: keyBytes(publicKey)
        });
      }
      const result = await api('subscribe', { subscription: subscription.toJSON() });
      saveToken(result.deviceToken);
      resultMessage = 'Push auf diesem Gerät erfolgreich aktiviert.';
    } catch (error) {
      resultMessage = `Aktivierung fehlgeschlagen: ${error.message}`;
    } finally { busy = false; await refresh(resultMessage); }
  });

  test.addEventListener('click', async () => {
    if (busy) return;
    busy = true; buttons(true);
    let resultMessage = null;
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription || !getToken()) throw new Error('Kein gültiges Abonnement.');
      await api('test', { endpoint: subscription.endpoint }, { 'X-Push-Device-Token': getToken() });
      resultMessage = 'Test-Push versendet. Prüfe deine Gerätebenachrichtigungen.';
    } catch (error) {
      if (/nicht autorisiert|abgelaufen/i.test(error.message)) {
        clearToken();
        // Ein nicht mehr gültiges Abo muss vor erneuter Anmeldung entfernt werden.
        const stale = await registration.pushManager.getSubscription().catch(() => null);
        if (stale) await stale.unsubscribe().catch(() => {});
      }
      resultMessage = `Push-Test fehlgeschlagen: ${error.message}`;
    } finally { busy = false; await refresh(resultMessage); }
  });

  disable.addEventListener('click', async () => {
    if (busy) return;
    busy = true; buttons(true);
    let resultMessage = null;
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && getToken()) {
        await api('unsubscribe', { endpoint: subscription.endpoint },
          { 'X-Push-Device-Token': getToken() });
      }
      if (subscription) await subscription.unsubscribe();
      clearToken();
      resultMessage = 'Push auf diesem Gerät deaktiviert.';
    } catch (error) {
      resultMessage = `Deaktivierung fehlgeschlagen: ${error.message}`;
    } finally { busy = false; await refresh(resultMessage); }
  });
}
