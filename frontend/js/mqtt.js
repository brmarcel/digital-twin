/**
 * @file mqtt.js
 * Verbindet die Website mit EMQX und empfängt Feuchtigkeitswerte über MQTT.
 */
import mqtt from 'mqtt';

const MOISTURE_TOPIC = 'plantpot/01/moisture';
const MQTT_PORT = 8084;
const RECONNECT_INTERVAL_MS = 3000;
const CONNECT_TIMEOUT_MS = 10000;
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;

/**
 * Erstellt einen MQTT-Client und leitet Verbindungsereignisse an die Anwendung weiter.
 *
 * @param {Object} callbacks - Rückmeldungen an die Anwendung.
 * @param {(value: number) => void} callbacks.onMoisture - Empfangener Feuchtigkeitswert.
 * @param {(message: string, connected?: boolean) => void} callbacks.onStatus - Statustext und Verbindungsanzeige.
 * @param {(connected: boolean) => void} callbacks.onConnectionChange - Schaltet die Anmeldemaske um.
 * @returns {{connect: (credentials: {host: string, username: string, password: string}) => void,
 *            disconnect: (updateUi?: boolean) => void}} Funktionen zum Verbinden und Trennen.
 */
export function createMqtt({ onMoisture, onStatus, onConnectionChange }) {
  let client = null;

  /**
   * Baut eine Verbindung auf und abonniert das Feuchtigkeits-Topic.
   *
   * @param {{host: string, username: string, password: string}} credentials - EMQX-Zugangsdaten.
   * @returns {void}
   */
  function connect({ host, username, password }) {
    if (!HOSTNAME_PATTERN.test(host)) {
      onStatus('Ungültiger EMQX-Hostname.');
      return;
    }

    disconnect(false);
    onStatus('Verbinde …');

    const connection = mqtt.connect(`wss://${host}:${MQTT_PORT}/mqtt`, {
      username,
      password,
      clientId: `plant-twin-${crypto.randomUUID()}`,
      reconnectPeriod: RECONNECT_INTERVAL_MS,
      connectTimeout: CONNECT_TIMEOUT_MS
    });
    client = connection;

    connection.on('connect', () => {
      if (client !== connection) return;
      onConnectionChange(true);
      onStatus('● MQTT verbunden – warte auf Messwerte', true);
      connection.subscribe(MOISTURE_TOPIC, { qos: 0 }, error => {
        if (error && client === connection) {
          onStatus(`Abo fehlgeschlagen: ${error.message}`, true);
        }
      });
    });

    connection.on('message', (topic, message) => {
      if (client !== connection || topic !== MOISTURE_TOPIC) return;
      try {
        const data = JSON.parse(message.toString());
        if (typeof data.moisture !== 'number' || !Number.isFinite(data.moisture)) return;
        onMoisture(data.moisture);
        onStatus(`● MQTT verbunden · letzter Empfang ${new Date().toLocaleTimeString('de-DE')}`, true);
      } catch (error) {
        console.warn('Ungültige MQTT-Nachricht:', error);
      }
    });

    connection.on('reconnect', () => {
      if (client === connection) onStatus('Verbindung wird wiederhergestellt …');
    });
    connection.on('offline', () => {
      if (client === connection) onStatus('Offline – erneuter Versuch …');
    });
    connection.on('error', error => {
      if (client !== connection) return;
      onStatus(`MQTT-Fehler: ${error.message}`);
      console.error('MQTT:', error);
    });
  }

  /**
   * Beendet die aktuelle Verbindung.
   *
   * @param {boolean} [updateUi=true] - Aktualisiert die Anzeige nach manueller Trennung.
   * @returns {void}
   */
  function disconnect(updateUi = true) {
    const previousClient = client;
    client = null;
    if (previousClient) previousClient.end(true);

    if (updateUi) {
      onConnectionChange(false);
      onStatus('Nicht verbunden');
    }
  }

  return { connect, disconnect };
}
