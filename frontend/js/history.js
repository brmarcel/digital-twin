/**
 * @file history.js
 * Speichert Messwerte in Supabase und lädt historische Verläufe.
 */
import { createClient } from '@supabase/supabase-js';

// HIER DEINE WERTE AUS SUPABASE EINFÜGEN:
const SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
const SUPABASE_ANON_KEY = 'DEIN-ANON-PUBLIC-KEY';

const DEVICE_ID = 'plantpot/01';
const MIN_SAVE_INTERVAL_MS = 30_000; // Maximal alle 30 Sek. pro Messgröße speichern

export function createHistoryStore() {
  const isConfigured =
    SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('DEIN-PROJEKT');

  const supabase = isConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  const lastSavedAt = {
    moisture: 0,
    water_level: 0
  };

  /**
   * Speichert einen einzelnen Messwert gedrosselt in Supabase.
   * @param {'moisture'|'water_level'} metric
   * @param {number} value
   */
  async function saveReading(metric, value) {
    if (!supabase || typeof value !== 'number' || !Number.isFinite(value)) return;

    const now = Date.now();
    if (now - lastSavedAt[metric] < MIN_SAVE_INTERVAL_MS) return;
    lastSavedAt[metric] = now;

    const { error } = await supabase
      .from('sensor_readings')
      .insert({ device_id: DEVICE_ID, metric, value });

    if (error) {
      console.warn(`Supabase-Speicherfehler (${metric}):`, error.message);
    }
  }

  /**
   * Lädt die Messwerte der letzten Stunden chronologisch sortiert.
   * @param {number} [hours=24]
   * @returns {Promise<{moisture: Array, water_level: Array}>}
   */
  async function loadRecentReadings(hours = 24) {
    if (!supabase) return { moisture: [], water_level: [] };

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('sensor_readings')
      .select('created_at, metric, value')
      .eq('device_id', DEVICE_ID)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) {
      console.warn('Historie konnte nicht geladen werden:', error.message);
      return { moisture: [], water_level: [] };
    }

    return {
      moisture: data.filter(row => row.metric === 'moisture'),
      water_level: data.filter(row => row.metric === 'water_level')
    };
  }

  return { isConfigured, saveReading, loadRecentReadings };
}