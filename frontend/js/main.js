/**
 * @file main.js
 * Startet 3D-Szene, Feuchtemodell, Dashboard und bidirektionale MQTT-Steuerung.
 */
import { createScene } from './scene.js';
import { createPlantPot } from './plantPot.js';
import { createPlantState } from './data.js';
import { createDashboard } from './dashboard.js';
import { createMqtt } from './mqtt.js';
import { setupTheme } from './theme.js';

const { scene, frameModel, setTheme: setSceneTheme } = createScene();
setupTheme(setSceneTheme);
let plantPot = null;
let lastMoisture = null;

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
  onMoisture: value => state.updateMoisture(value),
  onWaterLevel: level => dashboard.showWaterLevel(level),
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
