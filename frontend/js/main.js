/**
 * @file main.js
 * Startet 3D-Szene, Feuchtemodell, Dashboard, Langzeit-Historie und MQTT-Steuerung.
 */
import { createScene } from './scene.js';
import { createPlantPot } from './plantPot.js';
import { createPlantState } from './data.js';
import { createDashboard } from './dashboard.js';
import { createMqtt } from './mqtt.js';
import { setupTheme } from './theme.js';
import { createHistoryStore } from './history.js';
import { WATER_CAPACITY_ML } from './waterLevel.js';
import { createNotifications } from './notifications.js';

const { scene, frameModel, setTheme: setSceneTheme } = createScene();
setupTheme(setSceneTheme);
let plantPot = null;
let lastMoisture = null;

const notifications = createNotifications();
const history = createHistoryStore();
let selectedHours = 24;
let historyData = { moisture: [], waterLevel: [], wateringEvents: [] };
let previousPumpRunning = false;
let lastRequestedDurationMs = null;

/** Formatiert Zeitstempel passend zum gewählten Zeitraum. */
function formatAxisTime(isoString, hours) {
  const date = new Date(isoString);
  if (hours <= 24) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function formatFullDateTime(isoString) {
  return new Date(isoString).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** Findet den zeitlich nächstgelegenen Messpunkt zu einem Zeitstempel. */
function findNearestPoint(series, targetMs) {
  if (!series.length) return null;
  let best = series[0];
  let bestDiff = Math.abs(new Date(best.created_at).getTime() - targetMs);
  for (const item of series) {
    const diff = Math.abs(new Date(item.created_at).getTime() - targetMs);
    if (diff < bestDiff) {
      best = item;
      bestDiff = diff;
    }
  }
  return best;
}

/** Zeichnet Bodenfeuchte, Wasserfüllstand und Bewässerungsereignisse im SVG. */
function renderHistory() {
  const moistureLine = document.getElementById('history-line-moisture');
  const waterLine = document.getElementById('history-line-water');
  const eventsLayer = document.getElementById('history-events-layer');
  const status = document.getElementById('history-status');
  const xStartLabel = document.getElementById('chart-x-start');
  const xEndLabel = document.getElementById('chart-x-end');
  const wateringCount = document.getElementById('watering-count');
  const wateringList = document.getElementById('watering-list');

  if (!moistureLine || !waterLine || !status) return;

  // Bewässerungsliste aktualisieren
  const events = historyData.wateringEvents;
  if (wateringCount) wateringCount.textContent = `${events.length}×`;
  if (wateringList) {
    if (!events.length) {
      wateringList.innerHTML = '<li class="watering-empty">Keine Bewässerungen im Zeitraum</li>';
    } else {
      wateringList.innerHTML = events.slice(0, 15).map(ev => {
        const modeLabel = ev.mode === 'auto' ? 'Auto' : 'Manuell';
        const durLabel = ev.duration_ms ? ` · ${(ev.duration_ms / 1000).toFixed(0)}s` : '';
        return `<li>
          <span>${formatFullDateTime(ev.started_at)}</span>
          <span class="watering-tag">${modeLabel}${durLabel}</span>
        </li>`;
      }).join('');
    }
  }

  const allTimestamps = [
    ...historyData.moisture.map(d => new Date(d.created_at).getTime()),
    ...historyData.waterLevel.map(d => new Date(d.created_at).getTime())
  ];

  if (allTimestamps.length < 2) {
    moistureLine.setAttribute('points', '');
    waterLine.setAttribute('points', '');
    if (eventsLayer) eventsLayer.innerHTML = '';
    status.textContent = history.isConfigured
      ? 'Noch zu wenige Datenpunkte im Zeitraum'
      : 'Supabase in js/history.js konfigurieren';
    return;
  }

  const plotLeft = 30;
  const plotRight = 294;
  const plotTop = 12;
  const plotBottom = 100;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const minTime = Math.min(...allTimestamps);
  const maxTime = Math.max(...allTimestamps);
  const timeSpan = Math.max(1, maxTime - minTime);

  const toX = iso => plotLeft + ((new Date(iso).getTime() - minTime) / timeSpan) * plotWidth;
  const toY = pct => plotBottom - (Math.max(0, Math.min(100, pct)) / 100) * plotHeight;

  const buildPoints = series =>
    series.map(d => `${toX(d.created_at).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ');

  moistureLine.setAttribute('points', buildPoints(historyData.moisture));
  waterLine.setAttribute('points', buildPoints(historyData.waterLevel));

  // Bewässerungsereignisse als vertikale Linien einzeichnen
  if (eventsLayer) {
    eventsLayer.innerHTML = events
      .filter(ev => {
        const t = new Date(ev.started_at).getTime();
        return t >= minTime && t <= maxTime;
      })
      .map(ev => {
        const x = toX(ev.started_at).toFixed(1);
        return `<line x1="${x}" y1="${plotTop}" x2="${x}" y2="${plotBottom}" class="chart-event-marker" />`;
      })
      .join('');
  }

  if (xStartLabel) xStartLabel.textContent = formatAxisTime(new Date(minTime).toISOString(), selectedHours);
  if (xEndLabel) xEndLabel.textContent = formatAxisTime(new Date(maxTime).toISOString(), selectedHours);

  status.textContent = `${historyData.moisture.length} Feuchte- & ${historyData.waterLevel.length} Wasser-Messpunkte`;
}

/** Lädt Daten für den gewählten Zeitraum aus Supabase. */
async function refreshHistory(hours = selectedHours) {
  selectedHours = hours;
  const status = document.getElementById('history-status');
  if (status) status.textContent = 'Lade Verlaufsdaten …';
  historyData = await history.loadHistory(hours);
  renderHistory();
}

// Zeitraum-Buttons verdrahten
document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    refreshHistory(Number(btn.dataset.hours));
  });
});

// Interaktiver Hover-Tooltip für exakte Werte
const chartWrap = document.getElementById('history-chart-wrap');
const chartSvg = document.getElementById('history-chart');
const tooltip = document.getElementById('history-tooltip');
const hoverLine = document.getElementById('chart-hover-line');
const hoverMoisture = document.getElementById('chart-hover-moisture');
const hoverWater = document.getElementById('chart-hover-water');

if (chartWrap && chartSvg && tooltip) {
  chartWrap.addEventListener('pointermove', event => {
    const allTimestamps = [
      ...historyData.moisture.map(d => new Date(d.created_at).getTime()),
      ...historyData.waterLevel.map(d => new Date(d.created_at).getTime())
    ];
    if (allTimestamps.length < 2) return;

    const rect = chartSvg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * 300;
    const clampedX = Math.max(30, Math.min(294, svgX));
    const ratio = (clampedX - 30) / (294 - 30);

    const minTime = Math.min(...allTimestamps);
    const maxTime = Math.max(...allTimestamps);
    const targetMs = minTime + ratio * (maxTime - minTime);

    const nearM = findNearestPoint(historyData.moisture, targetMs);
    const nearW = findNearestPoint(historyData.waterLevel, targetMs);

    hoverLine.setAttribute('x1', clampedX.toFixed(1));
    hoverLine.setAttribute('x2', clampedX.toFixed(1));
    hoverLine.hidden = false;

    const lines = [`<strong>${formatFullDateTime(new Date(targetMs).toISOString())}</strong>`];

    if (nearM) {
      const mY = 100 - (Math.max(0, Math.min(100, nearM.value)) / 100) * 88;
      hoverMoisture.setAttribute('cx', clampedX.toFixed(1));
      hoverMoisture.setAttribute('cy', mY.toFixed(1));
      hoverMoisture.hidden = false;
      lines.push(`Bodenfeuchte: <strong>${Math.round(nearM.value)} %</strong>`);
    }
    if (nearW) {
      const wY = 100 - (Math.max(0, Math.min(100, nearW.value)) / 100) * 88;
      hoverWater.setAttribute('cx', clampedX.toFixed(1));
      hoverWater.setAttribute('cy', wY.toFixed(1));
      hoverWater.hidden = false;
      const ml = Math.round(nearW.volumeMl ?? (nearW.value / 100) * WATER_CAPACITY_ML);
      lines.push(`Wasservorrat: <strong>${Math.round(nearW.value)} % (${ml} ml)</strong>`);
    }

    tooltip.innerHTML = lines.join('<br>');
    tooltip.hidden = false;
  });

  chartWrap.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
    hoverLine.hidden = true;
    hoverMoisture.hidden = true;
    hoverWater.hidden = true;
  });
}

// Initiale Historie laden
refreshHistory(24);

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
  onStartPump: durationMs => {
    lastRequestedDurationMs = durationMs;
    return sendPumpRequest(() => connection.startPump(durationMs));
  },
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
  onMoisture: value => {
    state.updateMoisture(value);
    history.saveReading('moisture', value);
    historyData.moisture.push({ created_at: new Date().toISOString(), value });
    renderHistory();
  },
  onWaterLevel: level => {
    dashboard.showWaterLevel(level);
    notifications.onWaterLevel(level);
    if (level?.valid) {
      history.saveReading('water_level', level.volumeMl);
      historyData.waterLevel.push({
        created_at: new Date().toISOString(),
        volumeMl: level.volumeMl,
        value: level.percent
      });
      renderHistory();
    }
  },
  onStatus: (message, connected) => dashboard.showStatus(message, connected),
  onConnectionChange: connected => {
    dashboard.showConnected(connected);
    notifications.onConnectionChange(connected);
  },
  onPumpAvailability: availability => dashboard.showPumpAvailability(availability),
  onPumpState: pumpState => {
    dashboard.showPumpState(pumpState);
    // Wenn die Pumpe neu anläuft (Flanke false -> true), Bewässerungsereignis speichern
    if (pumpState?.running && !previousPumpRunning) {
      const nowIso = new Date().toISOString();
      history.saveWateringEvent(pumpState.mode, lastRequestedDurationMs);
      historyData.wateringEvents.unshift({
        started_at: nowIso,
        mode: pumpState.mode,
        duration_ms: lastRequestedDurationMs
      });
      lastRequestedDurationMs = null;
      renderHistory();
    }
    previousPumpRunning = Boolean(pumpState?.running);
  },
  onPumpConfig: config => dashboard.showPumpConfig(config)
});

try {
  plantPot = await createPlantPot(scene);
  frameModel(plantPot.size);
  if (lastMoisture !== null) plantPot.updateMoisture(lastMoisture);
  dashboard.showModelStatus(`3D-Modell geladen (${plantPot.meshCount} Mesh${plantPot.meshCount === 1 ? '' : 'es'}).`);
} catch (error) {
  console.error('3D-Modell konnte nicht geladen werden:', error);
  dashboard.showModelStatus('3D-Modell konnte nicht geladen werden. Prüfe models/plant-pot-model.obj.');
}