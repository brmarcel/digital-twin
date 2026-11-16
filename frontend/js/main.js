/**
 * @file main.js
 * Startet 3D-Szene, Feuchtemodell, Dashboard, Historie und bidirektionale MQTT-Steuerung.
 */
import { createScene } from './scene.js';
import { createPlantPot } from './plantPot.js';
import { createPlantState } from './data.js';
import { createDashboard } from './dashboard.js';
import { createMqtt } from './mqtt.js';
import { setupTheme } from './theme.js';
import { createHistoryStore } from './history.js';

const { scene, frameModel, setTheme: setSceneTheme } = createScene();
setupTheme(setSceneTheme);
let plantPot = null;
let lastMoisture = null;

const history = createHistoryStore();
let moistureHistory = [];

/** Zeichnet die gespeicherten Feuchtigkeitswerte als SVG-Linie. */
function renderHistoryChart() {
  const line = document.getElementById('history-line-moisture');
  const status = document.getElementById('history-status');
  if (!line || !status) return;

  if (moistureHistory.length < 2) {
    line.setAttribute('points', '');
    status.textContent = history.isConfigured
      ? 'Noch zu wenige Datenpunkte für Verlauf'
      : 'Supabase in js/history.js konfigurieren';
    return;
  }

  const width = 260;
  const height = 90;
  const minTime = new Date(moistureHistory[0].created_at).getTime();
  const maxTime = new Date(moistureHistory.at(-1).created_at).getTime();
  const timeSpan = Math.max(1, maxTime - minTime);

  const points = moistureHistory.map(entry => {
    const t = new Date(entry.created_at).getTime();
    const x = ((t - minTime) / timeSpan) * width;
    const clampedVal = Math.max(0, Math.min(100, entry.value));
    const y = height - (clampedVal / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  line.setAttribute('points', points);
  status.textContent = `${moistureHistory.length} Messpunkte geladen`;
}

// Beim Start bestehende Historie aus Supabase abrufen
history.loadRecentReadings(24).then(data => {
  moistureHistory = data.moisture;
  renderHistoryChart();
});

/**
 * Überträgt einen Pumpenbefehl und unterscheidet Broker-Empfang von ESP32-Bestätigung.
 * @param {() => Promise<void>} send - Asynchrone MQTT-Sendeaktion.
 * @returns {Promise<void>}
 */
async function sendPumpRequest(send) {
  dashboard.showPumpMessage('Sende MQTT-Befehl …');
  try {
    await send();
    dashboard.showPumpMessage('An MQTT-Broker gesendet – ESP32-Rückmeldung abwarten.');
  } catch (error) {
    dashboard.showPumpMessage(`Senden fehlgeschlagen: ${error.message}`);
  }
}

const dashboard = createDashboard({
  onConnect: credentials => connection.connect(credentials),
  onDisconnect: () => connection.disconnect(),
  onStartPump: durationMs => sendPumpRequest(() => connection.startPump(durationMs)),
  onStopPump: () => sendPumpRequest(() => connection.stopPump()),
  onSetPumpMode: mode => sendPumpRequest(() => connection.setPumpMode(mode)),
  onSavePumpConfig: config => sendPumpRequest(() => connection.setPumpConfig(config))
});

const state = createPlantState(value => {
  lastMoisture = value;
  dashboard.showMoisture(value);
  plantPot?.updateMoisture(value);
});

const connection = createMqtt({
  onMoisture: value => {
    state.updateMoisture(value);
    history.saveReading('moisture', value);
    moistureHistory.push({ created_at: new Date().toISOString(), value });
    renderHistoryChart();
  },
  onWaterLevel: level => {
    dashboard.showWaterLevel(level);
    if (level?.valid) {
      history.saveReading('water_level', level.volumeMl);
    }
  },
  onStatus: (message, connected) => dashboard.showStatus(message, connected),
  onConnectionChange: connected => dashboard.showConnected(connected),
  onPumpAvailability: availability => dashboard.showPumpAvailability(availability),
  onPumpState: pumpState => dashboard.showPumpState(pumpState),
  onPumpConfig: config => dashboard.showPumpConfig(config)
});

// OBJ-Modell asynchron laden; zuvor empfangene Messwerte bleiben erhalten.
try {
  plantPot = await createPlantPot(scene);
  frameModel(plantPot.size);
  if (lastMoisture !== null) plantPot.updateMoisture(lastMoisture);
  dashboard.showModelStatus(`3D-Modell geladen (${plantPot.meshCount} Mesh${plantPot.meshCount === 1 ? '' : 'es'}).`);
} catch (error) {
  console.error('3D-Modell konnte nicht geladen werden:', error);
  dashboard.showModelStatus('3D-Modell konnte nicht geladen werden. Prüfe models/plant-pot-model.obj.');
}