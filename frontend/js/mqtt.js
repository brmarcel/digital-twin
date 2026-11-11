/**
 * @file mqtt.js
 * Stellt eine MQTT-WebSocket-Verbindung zu EMQX her, liest Sensordaten und
 * überträgt Pumpenbefehle. Eine MQTT-Publish-Bestätigung bedeutet nur, dass
 * der Broker die Nachricht erhalten hat (nicht, dass die Pumpe geschaltet hat).
 */
import mqtt from 'mqtt';
import { PUMP_TOPICS, parsePumpState, validatePumpConfig } from './pump.js';
import { WATER_LEVEL_TOPIC, parseWaterLevel } from './waterLevel.js';

const MOISTURE_TOPIC = 'plantpot/01/moisture';
const MQTT_PORT = 8084;
const RECONNECT_INTERVAL_MS = 3000;
const CONNECT_TIMEOUT_MS = 10000;
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;
const SUBSCRIPTION_TOPICS = [
  MOISTURE_TOPIC,
  WATER_LEVEL_TOPIC,
  PUMP_TOPICS.availability,
  PUMP_TOPICS.state,
  PUMP_TOPICS.configState
];

/**
 * Erstellt eine MQTT-Schnittstelle mit Callbacks für die Weboberfläche.
 *
 * @param {Object} callbacks - Rückmeldungen an die Anwendung.
 * @param {(value: number) => void} callbacks.onMoisture - Empfangener Feuchtigkeitswert.
 * @param {(level: object) => void} callbacks.onWaterLevel - Validierter Wasservorrat oder Fehlerzustand.
 * @param {(message: string, connected?: boolean) => void} callbacks.onStatus - Verbindungsstatus.
 * @param {(connected: boolean) => void} callbacks.onConnectionChange - MQTT-Verbindungswechsel.
 * @param {(status: 'online'|'offline'|'unknown') => void} callbacks.onPumpAvailability - Gerätestatus.
 * @param {(state: {running: boolean, mode: 'manual'|'auto'} | null) => void} callbacks.onPumpState - Pumpenstatus.
 * @param {(config: object | null) => void} callbacks.onPumpConfig - ESP32-Konfigurationsbestätigung.
 * @returns {{connect: Function, disconnect: Function, startPump: Function,
 *            stopPump: Function, setPumpMode: Function, setPumpConfig: Function}}
 */
export function createMqtt({
  onMoisture, onWaterLevel, onStatus, onConnectionChange,
  onPumpAvailability, onPumpState, onPumpConfig
}) {
  let client = null;

  /** Setzt den Gerätestatus zurück, ohne daraus einen ausgeschalteten Pumpenzustand abzuleiten. */
  function resetPumpStatus() {
    onPumpAvailability('unknown');
    onPumpState(null);
    onPumpConfig(null);
  }

  /**
   * Verarbeitet Nachrichten der abonnierten MQTT-Topics.
   * @param {string} topic - MQTT-Topic.
   * @param {Uint8Array} message - Nutzdaten.
   * @returns {void}
   */
  function handleMessage(topic, message) {
    const content = message.toString();

    if (topic === PUMP_TOPICS.availability) {
      onPumpAvailability(content === 'online' || content === 'offline' ? content : 'unknown');
      return;
    }

    try {
      const data = JSON.parse(content);

      if (topic === MOISTURE_TOPIC) {
        if (typeof data?.moisture !== 'number' || !Number.isFinite(data.moisture)) return;
        onMoisture(data.moisture);
        onStatus(`● MQTT verbunden · letzter Empfang ${new Date().toLocaleTimeString('de-DE')}`, true);
      } else if (topic === WATER_LEVEL_TOPIC) {
        onWaterLevel(parseWaterLevel(data));
        onStatus(`● MQTT verbunden · letzter Empfang ${new Date().toLocaleTimeString('de-DE')}`, true);
      } else if (topic === PUMP_TOPICS.state) {
        const state = parsePumpState(data);
        if (state) onPumpState(state);
      } else if (topic === PUMP_TOPICS.configState) {
        try {
          onPumpConfig(validatePumpConfig(data));
        } catch (error) {
          console.warn('Ungültige ESP32-Pumpenkonfiguration:', error);
        }
      }
    } catch (error) {
      if (topic === WATER_LEVEL_TOPIC) onWaterLevel({ valid: false, reason: 'invalid' });
      console.warn(`Ungültige MQTT-Nachricht auf ${topic}:`, error);
    }
  }

  /**
   * Verbindet sich über WSS und abonniert Sensor- und Pumpenmeldungen.
   * @param {{host: string, username: string, password: string}} credentials - EMQX-Zugangsdaten.
   * @returns {void}
   */
  function connect({ host, username, password }) {
    if (!HOSTNAME_PATTERN.test(host)) {
      onStatus('Ungültiger EMQX-Hostname.');
      return;
    }

    disconnect(false);
    onConnectionChange(false);
    onStatus('Verbinde …');

    const connection = mqtt.connect(`wss://${host}:${MQTT_PORT}/mqtt`, {
      username,
      password,
      clientId: `plant-twin-${crypto.randomUUID()}`,
      clean: true,
      reconnectPeriod: RECONNECT_INTERVAL_MS,
      connectTimeout: CONNECT_TIMEOUT_MS
    });
    client = connection;

    connection.on('connect', () => {
      if (client !== connection) return;
      resetPumpStatus();
      onConnectionChange(true);
      onStatus('● MQTT verbunden – warte auf Messwerte', true);
      connection.subscribe(SUBSCRIPTION_TOPICS, { qos: 1 }, error => {
        if (error && client === connection) {
          onStatus(`MQTT-Abonnement fehlgeschlagen: ${error.message}`, true);
        }
      });
    });

    connection.on('message', (topic, message) => {
      if (client !== connection) return;
      handleMessage(topic, message);
    });

    connection.on('reconnect', () => {
      if (client !== connection) return;
      resetPumpStatus();
      onConnectionChange(false);
      onStatus('Verbindung wird wiederhergestellt …');
    });

    connection.on('offline', () => {
      if (client !== connection) return;
      resetPumpStatus();
      onConnectionChange(false);
      onStatus('Offline – erneuter Versuch …');
    });

    connection.on('error', error => {
      if (client !== connection) return;
      onStatus(`MQTT-Fehler: ${error.message}`);
      console.error('MQTT:', error);
    });
  }

  /**
   * Sendet einen einmaligen MQTT-Befehl ohne Retain-Flag.
   * @param {string} topic - Ziel-Topic.
   * @param {Object} payload - Befehl oder Konfiguration.
   * @returns {Promise<void>} Löst nach Bestätigung des MQTT-Brokers auf.
   */
  function publish(topic, payload) {
    const connection = client;
    if (!connection?.connected) return Promise.reject(new Error('Keine MQTT-Verbindung.'));

    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      connection.publish(
        topic,
        JSON.stringify({ ...payload, requestId }),
        { qos: 1, retain: false },
        error => {
          if (error || client !== connection || !connection.connected) {
            reject(error ?? new Error('Verbindung während des Sendens unterbrochen.'));
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Fordert eine zeitlich begrenzte manuelle Bewässerung an.
   * @param {number} durationMs - Laufzeit von 1 bis maximal 10 Sekunden.
   * @returns {Promise<void>} Broker-Bestätigung.
   */
  function startPump(durationMs) {
    if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 10000) {
      return Promise.reject(new Error('Manuelle Pumpdauer muss 1–10 Sekunden betragen.'));
    }
    return publish(PUMP_TOPICS.command, { action: 'start', durationMs });
  }

  /**
   * Fordert einen sofortigen Pumpenstopp an. ESP32 muss dabei auch die Automatik
   * deaktivieren, damit er nicht unmittelbar danach erneut bewässert.
   * @returns {Promise<void>} Broker-Bestätigung.
   */
  function stopPump() {
    return publish(PUMP_TOPICS.command, { action: 'stop' });
  }

  /**
   * Fordert einen Betriebsartwechsel an (der ESP32 meldet den Ist-Zustand zurück).
   * @param {'manual'|'auto'} mode - Gewünschter Betriebsmodus.
   * @returns {Promise<void>} Broker-Bestätigung.
   */
  function setPumpMode(mode) {
    if (mode !== 'manual' && mode !== 'auto') {
      return Promise.reject(new Error('Ungültige Betriebsart.'));
    }
    return publish(PUMP_TOPICS.modeSet, { mode });
  }

  /**
   * Sendet eine geprüfte Automatik-Konfiguration an den ESP32.
   * @param {Object} config - Vollständige Konfiguration.
   * @returns {Promise<void>} Broker-Bestätigung.
   */
  function setPumpConfig(config) {
    try {
      return publish(PUMP_TOPICS.configSet, validatePumpConfig(config));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Trennt den Client und entfernt veraltete Geräteinformationen aus der UI.
   * @param {boolean} [updateUi=true] - Bei manueller Trennung auch MQTT-UI zurücksetzen.
   * @returns {void}
   */
  function disconnect(updateUi = true) {
    const previousClient = client;
    client = null;
    if (previousClient) previousClient.end(true);
    resetPumpStatus();

    if (updateUi) {
      onConnectionChange(false);
      onStatus('Nicht verbunden');
    }
  }

  return { connect, disconnect, startPump, stopPump, setPumpMode, setPumpConfig };
}
