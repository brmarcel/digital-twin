/**
 * @file history.js
 * Langfristige Datenspeicherung (6+ Monate) und Auswertung von Bodenfeuchte,
 * Wasserfüllstand und Bewässerungsereignissen über Supabase.
 */
import { createClient } from '@supabase/supabase-js';
import { WATER_CAPACITY_ML } from './waterLevel.js';

// HIER DEINE WERTE AUS SUPABASE EINFÜGEN:
const RAW_SUPABASE_URL = 'https://lnvqvdixfjxhazacxcxk.supabase.co';
const SUPABASE_URL = RAW_SUPABASE_URL.trim().replace(/\/(rest\/v1)?\/?$/, '');
const SUPABASE_ANON_KEY = 'sb_publishable_tkv9VpTyWRaPnyY4ei3lgQ_pHN4Wp09';

const DEVICE_ID = 'plantpot/01';
const MIN_SAVE_INTERVAL_MS = 5 * 60 * 1000; // Regulär alle 5 Minuten speichern
const CHANGE_THRESHOLD = {
  moisture: 2,     // Sofort speichern bei >= 2 % Änderung
  water_level: 25  // Sofort speichern bei >= 25 ml Änderung
};

export function createHistoryStore() {
  const isConfigured =
    SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('DEIN-PROJEKT');

  const supabase = isConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  const lastSaved = {
    moisture: { time: 0, value: null },
    water_level: { time: 0, value: null }
  };

  /**
   * Speichert einen Sensorwert alle 5 Minuten – oder sofort, wenn sich der Wert
   * spürbar geändert hat (z. B. während einer Bewässerung).
   * @param {'moisture'|'water_level'} metric
   * @param {number} value
   */
  async function saveReading(metric, value) {
    if (!supabase || typeof value !== 'number' || !Number.isFinite(value)) return;

    const now = Date.now();
    const prev = lastSaved[metric];
    const timeElapsed = now - prev.time >= MIN_SAVE_INTERVAL_MS;
    const significantChange =
      prev.value === null || Math.abs(value - prev.value) >= CHANGE_THRESHOLD[metric];

    if (!timeElapsed && !significantChange) return;

    lastSaved[metric] = { time: now, value };

    const { error } = await supabase
      .from('sensor_readings')
      .insert({ device_id: DEVICE_ID, metric, value });

    if (error) {
      console.warn(`Supabase-Speicherfehler (${metric}):`, error.message);
    }
  }

  /**
   * Speichert ein Bewässerungsereignis, wenn die Pumpe startet.
   * @param {'manual'|'auto'} mode
   * @param {number|null} [durationMs=null]
   */
  async function saveWateringEvent(mode, durationMs = null) {
    if (!supabase || (mode !== 'manual' && mode !== 'auto')) return;

    const { error } = await supabase
      .from('watering_events')
      .insert({
        device_id: DEVICE_ID,
        mode,
        duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : null
      });

    if (error) {
      console.warn('Bewässerungsereignis konnte nicht gespeichert werden:', error.message);
    }
  }

  /**
   * Lädt Sensorwerte (Bodenfeuchte & Wasserstand) sowie Bewässerungsereignisse
   * für den gewählten Zeitraum in Stunden.
   * @param {number} [hours=24]
   */
  async function loadHistory(hours = 24) {
    if (!supabase) {
      return { moisture: [], waterLevel: [], wateringEvents: [] };
    }

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const readingsPromise =
      hours <= 48
        ? supabase
            .from('sensor_readings')
            .select('created_at, metric, value')
            .eq('device_id', DEVICE_ID)
            .gte('created_at', since)
            .order('created_at', { ascending: true })
            .limit(2000)
        : supabase.rpc('get_aggregated_readings', {
            p_device_id: DEVICE_ID,
            p_hours: hours,
            p_buckets: 240
          });

    const eventsPromise = supabase
      .from('watering_events')
      .select('id, started_at, mode, duration_ms')
      .eq('device_id', DEVICE_ID)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(1000);

    const [readingsRes, eventsRes] = await Promise.all([readingsPromise, eventsPromise]);

    if (readingsRes.error) {
      console.warn('Sensorhistorie Fehler:', readingsRes.error.message);
    }
    if (eventsRes.error) {
      console.warn('Bewässerungshistorie Fehler:', eventsRes.error.message);
    }

    const rows = readingsRes.data ?? [];
    const moisture = rows.filter(r => r.metric === 'moisture');
    const waterLevel = rows
      .filter(r => r.metric === 'water_level')
      .map(r => ({
        created_at: r.created_at,
        volumeMl: r.value,
        value: Math.max(0, Math.min(100, (r.value / WATER_CAPACITY_ML) * 100))
      }));

    return {
      moisture,
      waterLevel,
      wateringEvents: eventsRes.data ?? []
    };
  }

  return { isConfigured, saveReading, saveWateringEvent, loadHistory };
}