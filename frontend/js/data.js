/**
 * @file data.js
 * Validiert empfangene Messwerte und begrenzt die Feuchtigkeit auf 0–100 %.
 */

/**
 * Stellt die Verarbeitung gültiger Bodenfeuchtigkeitswerte bereit.
 *
 * @param {(value: number) => void} onChange - Empfängt den validierten Prozentwert.
 * @returns {{updateMoisture: (value: number) => void}} Schnittstelle für neue Messwerte.
 */
export function createPlantState(onChange) {
  /**
   * Prüft einen neuen Messwert und gibt ihn gegebenenfalls weiter.
   *
   * @param {number} value - Ungeprüfter Feuchtigkeitswert.
   * @returns {void}
   */
  function updateMoisture(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    onChange(Math.max(0, Math.min(100, value)));
  }

  return { updateMoisture };
}
