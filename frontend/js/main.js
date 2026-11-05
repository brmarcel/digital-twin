/**
 * @file main.js
 * Startet die Anwendung und verbindet 3D-Darstellung, Dashboard und MQTT.
 */
import { createScene } from './scene.js';
import { createPlantPot } from './plantPot.js';
import { createPlantState } from './data.js';
import { createDashboard } from './dashboard.js';
import { createMqtt } from './mqtt.js';

const { scene, frameModel } = createScene();
let plantPot = null;
let lastMoisture = null;

const dashboard = createDashboard({
  onConnect: credentials => connection.connect(credentials),
  onDisconnect: () => connection.disconnect()
});

const state = createPlantState(value => {
  lastMoisture = value;
  dashboard.showMoisture(value);
  plantPot?.updateMoisture(value);
});

const connection = createMqtt({
  onMoisture: value => state.updateMoisture(value),
  onStatus: (message, connected) => dashboard.showStatus(message, connected),
  onConnectionChange: connected => dashboard.showConnected(connected)
});

// Das OBJ-Modell wird asynchron geladen; ein bereits empfangener Wert geht nicht verloren.
try {
  plantPot = await createPlantPot(scene);
  frameModel(plantPot.size);
  if (lastMoisture !== null) plantPot.updateMoisture(lastMoisture);
  dashboard.showModelStatus(`3D-Modell geladen (${plantPot.meshCount} Mesh${plantPot.meshCount === 1 ? '' : 'es'}).`);
} catch (error) {
  console.error('3D-Modell konnte nicht geladen werden:', error);
  dashboard.showModelStatus('3D-Modell konnte nicht geladen werden. Prüfe models/plant-pot-model.obj.');
}
