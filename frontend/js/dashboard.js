/**
 * @file dashboard.js
 * Zeigt Feuchtigkeit und Status an und verarbeitet die MQTT-Anmeldung.
 */

/**
 * Bindet die Dashboard-Oberfläche an die Anwendungslogik.
 *
 * @param {Object} callbacks - Aktionen, die das Dashboard auslösen kann.
 * @param {(credentials: {host: string, username: string, password: string}) => void} callbacks.onConnect
 *   Startet den Verbindungsaufbau mit den eingegebenen Anmeldedaten.
 * @param {() => void} callbacks.onDisconnect - Trennt die MQTT-Verbindung.
 * @returns {{showMoisture: (value: number) => void, showStatus: (message: string, connected?: boolean) => void,
 *            showModelStatus: (message: string) => void, showConnected: (connected: boolean) => void}}
 *   Funktionen zur Aktualisierung des Dashboards.
 */
export function createDashboard({ onConnect, onDisconnect }) {
  const moistureElement = document.getElementById('moisture');
  const statusElement = document.getElementById('connection-status');
  const indicatorElement = document.getElementById('connection-indicator');
  const modelStatusElement = document.getElementById('model-status');
  const connectionPanel = document.getElementById('connection-panel');
  const loginForm = document.getElementById('login');
  const disconnectButton = document.getElementById('disconnect');
  const passwordInput = document.getElementById('password');

  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    onConnect({
      host: document.getElementById('host').value.trim(),
      username: document.getElementById('username').value,
      password: passwordInput.value
    });
  });

  disconnectButton.addEventListener('click', onDisconnect);

  return {
    /** @param {number} value - Bodenfeuchtigkeit in Prozent. */
    showMoisture(value) {
      moistureElement.textContent = `${Math.round(value)} %`;
    },

    /**
     * @param {string} message - Verbindungsstatus für die Anzeige.
     * @param {boolean} [connected=false] - Markiert die Verbindung als aktiv.
     */
    showStatus(message, connected = false) {
      statusElement.textContent = message;
      indicatorElement.classList.toggle('connected', connected);
    },

    /** @param {string} message - Meldung zum OBJ-Modell. */
    showModelStatus(message) {
      modelStatusElement.textContent = message;
    },

    /**
     * Wechselt zwischen Anmeldeformular und Trennen-Button.
     *
     * @param {boolean} connected - Gibt an, ob die MQTT-Verbindung besteht.
     */
    showConnected(connected) {
      loginForm.hidden = connected;
      disconnectButton.hidden = !connected;
      connectionPanel.open = !connected;
      if (!connected) passwordInput.value = '';
    }
  };
}
