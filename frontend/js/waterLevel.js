/**
 * @file waterLevel.js
 * Gemeinsamer Vertrag für den Füllstand des 1,8-Liter-Vorratsbehälters.
 * Kalibrierung und Pumpenschutz finden auf dem ESP32 statt.
 */
export const WATER_LEVEL_TOPIC = 'plantpot/01/water/level';
export const WATER_CAPACITY_ML = 1800;
export const WATER_STALE_AFTER_MS = 90_000;

/**
 * Prüft die vom ESP32 empfangene JSON-Nachricht.
 * Bei Sensorfehlern sendet der ESP32 {"valid":false}.
 *
 * @param {unknown} payload - JSON-Objekt vom MQTT-Broker.
 * @returns {{valid: true, volumeMl: number, percent: number} | {valid: false, reason: string}}
 */
export function parseWaterLevel(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'invalid' };
  }
  if (payload.valid === false) return { valid: false, reason: 'sensor' };
  if (payload.valid !== true || typeof payload.volumeMl !== 'number' ||
      !Number.isFinite(payload.volumeMl) || payload.volumeMl < 0 ||
      payload.volumeMl > WATER_CAPACITY_ML) {
    return { valid: false, reason: 'invalid' };
  }

  return {
    valid: true,
    volumeMl: payload.volumeMl,
    percent: payload.volumeMl / WATER_CAPACITY_ML * 100
  };
}
