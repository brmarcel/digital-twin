/**
 * @file plantPot.js
 * Lädt das CAD-Modell und ergänzt eine glatte, per Feuchtigkeitswert färbbare Erde.
 */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const MODEL_URL = './models/plant-pot-model.obj';
const DISPLAY_SIZE = 3;
const SOIL_SEGMENTS = 64;
const SOIL_HEIGHT_RATIO = 0.55;
const DRY_COLOR = new THREE.Color(0xa17b51);
const WET_COLOR = new THREE.Color(0x24180f);

// Proportionen aus dem ursprünglichen CAD-Modell (in mm).
// Durch relative Werte bleibt die Platzierung unabhängig von OBJ-Exporteinheiten.
const CAD = Object.freeze({
  width: 254.887296,
  height: 170,
  centerOffsetX: 35,
  soilRadius: 87,
  soilRimOffset: 7
});

/**
 * Lädt, zentriert und skaliert den Topf. Positioniert die Erde in der Öffnung.
 *
 * @param {THREE.Scene} scene - Szene, in der Topf und Erde angezeigt werden.
 * @returns {Promise<{size: THREE.Vector3, meshCount: number, updateMoisture: (value: number) => void}>}
 *   Modellinformationen und eine Funktion zum Aktualisieren der Erdfarbe.
 * @throws {Error} Falls die OBJ-Datei nicht geladen werden kann oder leer ist.
 */
export async function createPlantPot(scene) {
  const object = await new OBJLoader().loadAsync(MODEL_URL);

  // Fusion verwendet Z als Höhenachse, Three.js hingegen Y.
  object.rotation.x = -Math.PI / 2;
  object.updateMatrixWorld(true);

  const potMaterial = new THREE.MeshStandardMaterial({
    color: 0x292c30,
    roughness: 0.76,
    side: THREE.DoubleSide
  });

  let meshCount = 0;
  object.traverse(child => {
    if (!child.isMesh) return;
    child.material = potMaterial;
    meshCount++;
  });

  if (meshCount === 0) throw new Error('Das OBJ-Modell enthält keine Meshes.');

  const modelBox = new THREE.Box3().setFromObject(object);
  if (modelBox.isEmpty()) throw new Error('Das OBJ-Modell hat keine gültige Bounding Box.');

  const center = modelBox.getCenter(new THREE.Vector3());
  const size = modelBox.getSize(new THREE.Vector3());
  const longestSide = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longestSide) || longestSide <= 0) {
    throw new Error('Das OBJ-Modell hat keine gültigen Abmessungen.');
  }

  // Die Verschiebung muss denselben Skalierungsfaktor wie das Modell nutzen.
  const scale = DISPLAY_SIZE / longestSide;
  object.scale.setScalar(scale);
  object.position.copy(center).multiplyScalar(-scale);
  object.updateMatrixWorld(true);
  scene.add(object);

  const worldBox = new THREE.Box3().setFromObject(object);
  const worldSize = worldBox.getSize(new THREE.Vector3());
  const worldCenter = worldBox.getCenter(new THREE.Vector3());

  const soilRadius = worldSize.x * CAD.soilRadius / CAD.width;
  const soilX = worldCenter.x - worldSize.x * CAD.centerOffsetX / CAD.width;
  const soilY = worldBox.max.y - worldSize.y * CAD.soilRimOffset / CAD.height;
  const soilZ = worldCenter.z;
  const soilHeight = worldSize.y * SOIL_HEIGHT_RATIO;

  // Ober- und Seitenfläche teilen das Material, damit beide gleich eingefärbt werden.
  const soilMaterial = new THREE.MeshStandardMaterial({
    color: DRY_COLOR,
    roughness: 1,
    side: THREE.DoubleSide
  });

  const soilSurface = new THREE.Mesh(
    new THREE.CircleGeometry(soilRadius, SOIL_SEGMENTS),
    soilMaterial
  );
  soilSurface.rotation.x = -Math.PI / 2;
  soilSurface.position.set(soilX, soilY, soilZ);
  scene.add(soilSurface);

  const soilBody = new THREE.Mesh(
    new THREE.CylinderGeometry(soilRadius, soilRadius * 0.92, soilHeight, SOIL_SEGMENTS),
    soilMaterial
  );
  soilBody.position.set(soilX, soilY - soilHeight / 2 - 0.002, soilZ);
  scene.add(soilBody);

  /**
   * Mischt die Erdfarbe stufenlos zwischen trocken (0 %) und feucht (100 %).
   *
   * @param {number} moisture - Bodenfeuchtigkeit in Prozent.
   * @returns {void}
   */
  function updateMoisture(moisture) {
    const amount = THREE.MathUtils.clamp(moisture, 0, 100) / 100;
    soilMaterial.color.copy(DRY_COLOR).lerp(WET_COLOR, amount);
  }

  return {
    size: size.multiplyScalar(scale),
    meshCount,
    updateMoisture
  };
}
