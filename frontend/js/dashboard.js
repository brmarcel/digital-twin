/**
 * @file dashboard.js
 * Verwaltet Sensordaten, MQTT-Anmeldung und die Bedienung der Pumpe.
 * Angezeigte Ist-Zustände kommen vom ESP32, nicht aus Klick-Ereignissen.
 */
import { DEFAULT_PUMP_CONFIG } from './pump.js';

/**
 * Erstellt das Dashboard und registriert die Benutzeraktionen.
 * @param {Object} callbacks - Aktionen der Anwendung.
 * @param {(credentials: {host: string, username: string, password: string}) => void} callbacks.onConnect - MQTT-Anmeldung.
 * @param {() => void} callbacks.onDisconnect - MQTT-Trennung.
 * @param {(durationMs: number) => void} callbacks.onStartPump - Startet eine begrenzte Bewässerung.
 * @param {() => void} callbacks.onStopPump - Fordert einen Pumpenstopp an.
 * @param {(mode: 'manual'|'auto') => void} callbacks.onSetPumpMode - Wechselt die Betriebsart.
 * @param {(config: object) => void} callbacks.onSavePumpConfig - Überträgt Automatikwerte.
 * @returns {Object} Methoden zum Anzeigen der Geräte- und MQTT-Rückmeldungen.
 */
export function createDashboard({
  onConnect, onDisconnect, onStartPump, onStopPump, onSetPumpMode, onSavePumpConfig
}) {
  const get = id => document.getElementById(id);
  const moistureElement = get('moisture');
  const statusElement = get('connection-status');
  const indicatorElement = get('connection-indicator');
  const modelStatusElement = get('model-status');
  const connectionPanel = get('connection-panel');
  const loginForm = get('login');
  const disconnectButton = get('disconnect');
  const passwordInput = get('password');

  const availabilityElement = get('pump-availability');
  const stateElement = get('pump-state');
  const modeElement = get('pump-current-mode');
  const messageElement = get('pump-message');
  const thresholdInput = get('pump-threshold');
  const thresholdValue = get('pump-threshold-value');
  const manualDuration = get('pump-manual-duration');
  const autoDuration = get('pump-auto-duration');
  const pauseInput = get('pump-pause');
  const cyclesInput = get('pump-max-cycles');
  const manualModeButton = get('pump-mode-manual');
  const autoModeButton = get('pump-mode-auto');
  const startButton = get('pump-start');
  const stopButton = get('pump-stop');
  const saveConfigButton = get('pump-save-config');

  let mqttConnected = false;
  let pumpAvailable = false;
  let pumpState = null;
  let confirmedConfig = null;
  let configDirty = true;
  let expectedConfig = null;

  /** @returns {{thresholdPct: number, durationMs: number, pauseMs: number, maxCycles: number}} Eingestellte Automatikwerte. */
  function readConfig() {
    return {
      thresholdPct: Number(thresholdInput.value),
      durationMs: Number(autoDuration.value),
      pauseMs: Number(pauseInput.value),
      maxCycles: Number(cyclesInput.value)
    };
  }

  /** @param {Object} config - Bestätigte Einstellungen vom ESP32. */
  function applyConfig(config) {
    thresholdInput.value = config.thresholdPct;
    thresholdValue.textContent = `${config.thresholdPct} %`;
    autoDuration.value = String(config.durationMs);
    pauseInput.value = String(config.pauseMs);
    cyclesInput.value = String(config.maxCycles);
  }

  /** @param {Object} a - Erste Konfiguration. @param {Object} b - Zweite Konfiguration. @returns {boolean} */
  function sameConfig(a, b) {
    return Boolean(a && b) && ['thresholdPct', 'durationMs', 'pauseMs', 'maxCycles']
      .every(key => a[key] === b[key]);
  }

  /** Schaltet Bedienbuttons anhand von Verbindung, Ist-Modus und Konfigurationsstatus. */
  function updateControls() {
    const deviceReady = mqttConnected && pumpAvailable && pumpState !== null;
    const isManual = deviceReady && pumpState.mode === 'manual';

    manualModeButton.disabled = !deviceReady || isManual;
    autoModeButton.disabled = !deviceReady || pumpState.mode === 'auto' ||
      configDirty || !confirmedConfig;
    startButton.disabled = !isManual || pumpState.running;
    // Stopp auch bei unklarem Gerätestatus ermöglichen, solange der Broker verbunden ist.
    stopButton.disabled = !mqttConnected;
    saveConfigButton.disabled = !deviceReady;
    manualModeButton.classList.toggle('selected', isManual);
    autoModeButton.classList.toggle('selected', deviceReady && pumpState.mode === 'auto');

    const deviceHint = !mqttConnected ? 'Zuerst MQTT verbinden.' :
      !pumpAvailable ? 'Warte auf Online-Meldung des ESP32.' :
      !pumpState ? 'Warte auf Pumpenstatus des ESP32.' :
      configDirty ? 'Automatikwerte vor dem Aktivieren übertragen.' : '';
    get('pump-hint').textContent = deviceHint;
  }

  loginForm.addEventListener('submit', event => {
    event.preventDefault();
    onConnect({
      host: get('host').value.trim(),
      username: get('username').value,
      password: passwordInput.value
    });
  });
  disconnectButton.addEventListener('click', onDisconnect);

  startButton.addEventListener('click', () => onStartPump(Number(manualDuration.value)));
  stopButton.addEventListener('click', onStopPump);
  manualModeButton.addEventListener('click', () => onSetPumpMode('manual'));
  autoModeButton.addEventListener('click', () => onSetPumpMode('auto'));
  saveConfigButton.addEventListener('click', () => {
    const config = readConfig();
    expectedConfig = config;
    onSavePumpConfig(config);
  });

  thresholdInput.addEventListener('input', () => {
    thresholdValue.textContent = `${thresholdInput.value} %`;
  });

  [thresholdInput, autoDuration, pauseInput, cyclesInput].forEach(input => {
    input.addEventListener('input', () => {
      configDirty = !sameConfig(readConfig(), confirmedConfig);
      expectedConfig = null;
      updateControls();
    });
  });

  applyConfig(DEFAULT_PUMP_CONFIG);
  connectionPanel.open = true; // Beim ersten Besuch sind keine Zugangsdaten vorhanden.
  updateControls();

  return {
    /** @param {number} value - Bodenfeuchtigkeit in Prozent. */
    showMoisture(value) {
      moistureElement.textContent = `${Math.round(value)} %`;
    },

    /**
     * @param {string} message - Beschreibung der MQTT-Verbindung.
     * @param {boolean} [connected=false] - Ist die Verbindung aktiv?
     */
    showStatus(message, connected = false) {
      statusElement.textContent = message;
      indicatorElement.classList.toggle('connected', connected);
    },

    /** @param {string} message - Meldung zum 3D-Modell. */
    showModelStatus(message) {
      modelStatusElement.textContent = message;
    },

    /** @param {boolean} connected - Aktueller Verbindungszustand des MQTT-Browsers. */
    showConnected(connected) {
      mqttConnected = connected;
      loginForm.hidden = connected;
      disconnectButton.hidden = !connected;
      connectionPanel.open = !connected;
      if (!connected) passwordInput.value = '';
      updateControls();
    },

    /** @param {'online'|'offline'|'unknown'} availability - Vom ESP32 gemeldeter Online-Status. */
    showPumpAvailability(availability) {
      pumpAvailable = availability === 'online';
      availabilityElement.textContent = availability === 'online' ? 'ESP32 online' :
        availability === 'offline' ? 'ESP32 offline' : 'Status unbekannt';
      availabilityElement.classList.toggle('online', pumpAvailable);
      if (!pumpAvailable) {
        pumpState = null;
        stateElement.textContent = 'Unbekannt';
        modeElement.textContent = '–';
        confirmedConfig = null;
        expectedConfig = null;
        configDirty = true;
      }
      updateControls();
    },

    /** @param {{running: boolean, mode: 'manual'|'auto'} | null} state - Gemeldeter Ist-Zustand der Pumpe. */
    showPumpState(state) {
      pumpState = state;
      stateElement.textContent = !state ? 'Unbekannt' : state.running ? 'Läuft' : 'Aus';
      stateElement.classList.toggle('running', Boolean(state?.running));
      modeElement.textContent = !state ? '–' : state.mode === 'auto' ? 'Automatisch' : 'Manuell';
      updateControls();
    },

    /** @param {Object | null} config - Gemeldete Automatikwerte oder null bei Verbindungsverlust. */
    showPumpConfig(config) {
      if (!config) {
        confirmedConfig = null;
        expectedConfig = null;
        configDirty = true;
        updateControls();
        return;
      }

      const wasUnconfirmed = confirmedConfig === null;
      confirmedConfig = config;
      if (expectedConfig) {
        if (sameConfig(expectedConfig, config)) {
          messageElement.textContent = 'Einstellungen vom ESP32 bestätigt.';
          expectedConfig = null;
          applyConfig(config);
          configDirty = false;
        } else {
          // Möglicherweise noch eine ältere Retained-Nachricht: die vom Benutzer
          // gewählte Konfiguration bis zur echten Bestätigung beibehalten.
          configDirty = !sameConfig(readConfig(), config);
        }
      } else if (wasUnconfirmed || !configDirty) {
        applyConfig(config);
        configDirty = false;
      } else {
        configDirty = !sameConfig(readConfig(), config);
      }
      updateControls();
    },

    /** @param {string} message - Sende-, Fehler- oder Bestätigungsmeldung. */
    showPumpMessage(message) {
      messageElement.textContent = message;
    }
  };
}
