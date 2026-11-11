/**
 * @file scene.js
 * Verwaltet die Three.js-Szene, Beleuchtung, Kamera und Maussteuerung.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BACKGROUND_COLOR = 0x171f29;
const GRID_SIZE = 10;
const GRID_DIVISIONS = 20;
const GRID_HEIGHT = -1.0;
const BOTTOM_LIGHT_INTENSITY = 1.0;

/**
 * Erstellt die 3D-Szene und startet die Render-Schleife.
 *
 * @returns {{scene: THREE.Scene, frameModel: (size: THREE.Vector3) => void}}
 *   Die Szene und eine Funktion zum Ausrichten der Kamera auf das Modell.
 */
export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  const stage = document.getElementById('scene-stage');
  if (!stage) throw new Error('3D-Container #scene-stage fehlt.');

  const width = () => Math.max(1, stage.clientWidth);
  const height = () => Math.max(1, stage.clientHeight);
  const camera = new THREE.PerspectiveCamera(45, width() / height(), 0.01, 10000);
  camera.position.set(3, 2, 4);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width(), height());
  stage.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x596273, 2.5));

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 5);
  scene.add(sun);

  const bottomLight = new THREE.DirectionalLight(0xffffff, BOTTOM_LIGHT_INTENSITY);
  bottomLight.position.set(0, -5, 0);
  scene.add(bottomLight);

  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x555555, 0x333333);
  grid.position.y = GRID_HEIGHT;
  scene.add(grid);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  /**
   * Passt die Kamera an die bereits zentrierte, skalierte Modellgröße an.
   *
   * @param {THREE.Vector3} size - Modellabmessungen in Three.js-Einheiten.
   * @returns {void}
   */
  function frameModel(size) {
    const radius = size.length() * 0.5;
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 1.45;

    camera.position.set(distance * 0.75, distance * 0.55, distance);
    camera.near = 0.01;
    camera.far = distance * 20;
    camera.updateProjectionMatrix();

    controls.target.set(0, 0, 0);
    controls.minDistance = radius * 0.7;
    controls.maxDistance = distance * 6;
    controls.update();
  }

  // Die 3D-Bühne ist nicht mehr das komplette Browserfenster.
  // ResizeObserver berücksichtigt auch responsive Dashboard-Layoutwechsel.
  const resizeObserver = new ResizeObserver(() => {
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    renderer.setSize(width(), height());
  });
  resizeObserver.observe(stage);

  /** Zeichnet die Szene und aktualisiert die gedämpfte Kamerasteuerung. */
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  animate();
  return { scene, frameModel };
}
