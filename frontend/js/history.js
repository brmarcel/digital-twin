/**
 * @file history.js
 * Langfristige Datenspeicherung (6+ Monate) und Auswertung von Bodenfeuchte,
 * Wasserfüllstand und Bewässerungsereignissen über Supabase.
 */
import { createClient } from '@supabase/supabase-js';
import { WATER_CAPACITY_ML } from './waterLevel.js';

// HIER DEINE WERTE AUS SUPABASE EINFÜGEN:
const SUPABASE_URL = 'https://lnvqvdixfjxhazacxcxk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tkv9VpTyWRaPnyY4ei3lgQ_pHN4Wp09';

const DEVICE_ID = 'plantpot/01';
const MIN_SAVE_INTERVAL_MS = 30_000;

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
   * Speichert einen Sensorwert gedrosselt in Supabase.
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
   * Verdichtet große Messreihen gleichmäßig auf maxPoints Punkte für flüssige Darstellung.
   */
  function downsample(rows, maxPoints = 240) {
    if (rows.length <= maxPoints) return rows;
    const step = rows.length / maxPoints;
    const sampled = [];
    for (let i = 0; i < maxPoints; i++) {
      sampled.push(rows[Math.floor(i * step)]);
    }
    if (sampled.at(-1) !== rows.at(-1)) sampled.push(rows.at(-1));
    return sampled;
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

    const [readingsRes, eventsRes] = await Promise.all([
      supabase
        .from('sensor_readings')
        .select('created_at, metric, value')
        .eq('device_id', DEVICE_ID)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(10000),
      supabase
        .from('watering_events')
        .select('id, started_at, mode, duration_ms')
        .eq('device_id', DEVICE_ID)
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(500)
    ]);

    if (readingsRes.error) {
      console.warn('Sensorhistorie Fehler:', readingsRes.error.message);
    }
    if (eventsRes.error) {
      console.warn('Bewässerungshistorie Fehler:', eventsRes.error.message);
    }

    const rows = readingsRes.data ?? [];
    const moistureRaw = rows.filter(r => r.metric === 'moisture');
    const waterRaw = rows.filter(r => r.metric === 'water_level').map(r => ({
      created_at: r.created_at,
      volumeMl: r.value,
      value: Math.max(0, Math.min(100, (r.value / WATER_CAPACITY_ML) * 100))
    }));

    return {
      moisture: downsample(moistureRaw),
      waterLevel: downsample(waterRaw),
      wateringEvents: eventsRes.data ?? []
    };
  }

  return { isConfigured, saveReading, saveWateringEvent, loadHistory };
}