/**
 * @file pump.js
 * Definiert das MQTT-Protokoll und prüft Pumpenstatus und Einstellungen.
 * Die tatsächliche Regelung und Abschaltung erfolgen ausschließlich auf dem ESP32.
 */

export const PUMP_TOPICS = Object.freeze({
  command: 'plantpot/01/pump/command',
  state: 'plantpot/01/pump/state',
  availability: 'plantpot/01/pump/availability',
  modeSet: 'plantpot/01/pump/mode/set',
  configSet: 'plantpot/01/pump/config/set',
  configState: 'plantpot/01/pump/config/state'
});

export const DEFAULT_PUMP_CONFIG = Object.freeze({
  thresholdPct: 30,
  durationMs: 5000,
  pauseMs: 60000,
  maxCycles: 3
});

/**
 * Prüft eine vollständige Pumpenkonfiguration auf erlaubte Zahlenwerte.
 * @param {unknown} input - Zu prüfende Konfiguration.
 * @returns {{thresholdPct: number, durationMs: number, pauseMs: number, maxCycles: number}}
 * @throws {Error} Bei ungültigen oder fehlenden Angaben.
 */
export function validatePumpConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Pumpenkonfiguration fehlt.');
  const { thresholdPct, durationMs, pauseMs, maxCycles } = input;
  const integerInRange = (value, min, max) =>
    Number.isInteger(value) && value >= min && value <= max;

  if (!integerInRange(thresholdPct, 10, 60)) throw new Error('Grenzwert muss 10–60 % betragen.');
  if (!integerInRange(durationMs, 1000, 10000)) throw new Error('Pumpdauer muss 1–10 Sekunden betragen.');
  if (!integerInRange(pauseMs, 30000, 600000)) throw new Error('Wartezeit muss 30–600 Sekunden betragen.');
  if (!integerInRange(maxCycles, 1, 5)) throw new Error('Maximalzahl der Intervalle muss 1–5 betragen.');

  return { thresholdPct, durationMs, pauseMs, maxCycles };
}

/**
 * Interpretiert einen vom ESP32 bestätigten Pumpenstatus.
 * @param {unknown} input - Empfangene JSON-Daten.
 * @returns {{running: boolean, mode: 'manual'|'auto'} | null} Gültiger Status oder null.
 */
export function parsePumpState(input) {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.running !== 'boolean') return null;
  if (input.mode !== 'manual' && input.mode !== 'auto') return null;
  return { running: input.running, mode: input.mode };
}
