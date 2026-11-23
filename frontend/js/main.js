/**
 * @file main.js
 * Startet 3D-Szene, Feuchtemodell, Dashboard, Vollbild-Langzeithistorie und MQTT-Steuerung.
 */
import { createScene } from './scene.js';
import { createPlantPot } from './plantPot.js';
import { createPlantState } from './data.js';
import { createDashboard } from './dashboard.js';
import { createMqtt } from './mqtt.js';
import { setupTheme } from './theme.js';
import { createHistoryStore } from './history.js';
import { WATER_CAPACITY_ML } from './waterLevel.js';

const { scene, frameModel, setTheme: setSceneTheme } = createScene();
setupTheme(setSceneTheme);
let plantPot = null;
let lastMoisture = null;

const history = createHistoryStore();
let selectedHours = 24;
let selectedMetric = 'all';
let historyData = { moisture: [], waterLevel: [], wateringEvents: [] };
let previousPumpRunning = false;
let activeWateringStartMs = null;
let activeWateringEventId = null;

const PLOT = { left: 72, right: 848, top: 30, bottom: 370 };

function formatAxisTime(isoString, hours) {
  const date = new Date(isoString);
  if (hours <= 24) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  if (hours <= 168) {
    return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  }
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
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

function openHistoryFullscreen(metric = 'all') {
  const modal = document.getElementById('history-fullscreen');
  if (!modal) return;
  selectedMetric = metric;
  document.querySelectorAll('.fs-metric-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.metric === metric);
  });
  modal.hidden = false;
  refreshHistory(selectedHours);
}

function closeHistoryFullscreen() {
  const modal = document.getElementById('history-fullscreen');
  if (modal) modal.hidden = true;
}

document.querySelectorAll('[data-open-history]').forEach(card => {
  const metric = card.dataset.openHistory || 'all';
  card.addEventListener('click', () => openHistoryFullscreen(metric));
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openHistoryFullscreen(metric);
    }
  });
});

document.getElementById('fs-close-btn')?.addEventListener('click', closeHistoryFullscreen);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeHistoryFullscreen();
});

document.querySelectorAll('.fs-metric-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedMetric = btn.dataset.metric;
    document.querySelectorAll('.fs-metric-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderHistory();
  });
});

function renderHistory() {
  const moistureLine = document.getElementById('history-line-moisture');
  const waterLine = document.getElementById('history-line-water');
  const eventsLayer = document.getElementById('history-events-layer');
  const status = document.getElementById('history-status');
  const wateringCount = document.getElementById('watering-count');
  const wateringList = document.getElementById('watering-list');

  if (!moistureLine || !waterLine || !status) return;

  const showMoisture = selectedMetric === 'all' || selectedMetric === 'moisture';
  const showWater = selectedMetric === 'all' || selectedMetric === 'water';

  moistureLine.style.display = showMoisture ? '' : 'none';
  waterLine.style.display = showWater ? '' : 'none';

  const events = historyData.wateringEvents;
  if (wateringCount) wateringCount.textContent = `${events.length}×`;
  if (wateringList) {
    if (!events.length) {
      wateringList.innerHTML = '<li class="watering-empty">Keine Bewässerungen im Zeitraum</li>';
    } else {
      wateringList.innerHTML = events.slice(0, 40).map(ev => {
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
    ...(showMoisture ? historyData.moisture.map(d => new Date(d.created_at).getTime()) : []),
    ...(showWater ? historyData.waterLevel.map(d => new Date(d.created_at).getTime()) : [])
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

  const plotWidth = PLOT.right - PLOT.left;
  const plotHeight = PLOT.bottom - PLOT.top;
  const minTime = Math.min(...allTimestamps);
  const maxTime = Math.max(...allTimestamps);
  const timeSpan = Math.max(1, maxTime - minTime);

  const toX = iso => PLOT.left + ((new Date(iso).getTime() - minTime) / timeSpan) * plotWidth;
  const toY = pct => PLOT.bottom - (Math.max(0, Math.min(100, pct)) / 100) * plotHeight;

  const buildPoints = series =>
    series.map(d => `${toX(d.created_at).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ');

  moistureLine.setAttribute('points', showMoisture ? buildPoints(historyData.moisture) : '');
  waterLine.setAttribute('points', showWater ? buildPoints(historyData.waterLevel) : '');

  if (eventsLayer) {
    eventsLayer.innerHTML = events
      .filter(ev => {
        const t = new Date(ev.started_at).getTime();
        return t >= minTime && t <= maxTime;
      })
      .map(ev => {
        const x = toX(ev.started_at).toFixed(1);
        return `<line x1="${x}" y1="${PLOT.top}" x2="${x}" y2="${PLOT.bottom}" class="chart-event-marker" />`;
      })
      .join('');
  }

  for (let i = 0; i < 5; i++) {
    const label = document.getElementById(`chart-x-${i}`);
    if (label) {
      const ts = minTime + (i / 4) * (maxTime - minTime);
      label.textContent = formatAxisTime(new Date(ts).toISOString(), selectedHours);
    }
  }

  status.textContent = `${historyData.moisture.length} Feuchte- & ${historyData.waterLevel.length} Wasser-Messpunkte`;
}

async function refreshHistory(hours = selectedHours) {
  selectedHours = hours;
  const status = document.getElementById('history-status');
  if (status) status.textContent = 'Lade Verlaufsdaten …';
  historyData = await history.loadHistory(hours);
  renderHistory();
}

document.querySelectorAll('.range-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    refreshHistory(Number(btn.dataset.hours));
  });
});

const chartWrap = document.getElementById('history-chart-wrap');
const chartSvg = document.getElementById('history-chart');
const tooltip = document.getElementById('history-tooltip');
const hoverLine = document.getElementById('chart-hover-line');
const hoverMoisture = document.getElementById('chart-hover-moisture');
const hoverWater = document.getElementById('chart-hover-water');

if (chartWrap && chartSvg && tooltip) {
  chartWrap.addEventListener('pointermove', event => {
    const showMoisture = selectedMetric === 'all' || selectedMetric === 'moisture';
    const showWater = selectedMetric === 'all' || selectedMetric === 'water';

    const allTimestamps = [
      ...(showMoisture ? historyData.moisture.map(d => new Date(d.created_at).getTime()) : []),
      ...(showWater ? historyData.waterLevel.map(d => new Date(d.created_at).getTime()) : [])
    ];
    if (allTimestamps.length < 2) return;

    const rect = chartSvg.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * 920;
    const clampedX = Math.max(PLOT.left, Math.min(PLOT.right, svgX));
    const ratio = (clampedX - PLOT.left) / (PLOT.right - PLOT.left);

    const minTime = Math.min(...allTimestamps);
    const maxTime = Math.max(...allTimestamps);
    const targetMs = minTime + ratio * (maxTime - minTime);

    const nearM = showMoisture ? findNearestPoint(historyData.moisture, targetMs) : null;
    const nearW = showWater ? findNearestPoint(historyData.waterLevel, targetMs) : null;

    hoverLine.setAttribute('x1', clampedX.toFixed(1));
    hoverLine.setAttribute('x2', clampedX.toFixed(1));
    hoverLine.hidden = false;

    const plotHeight = PLOT.bottom - PLOT.top;
    const lines = [`<strong>${formatFullDateTime(new Date(targetMs).toISOString())}</strong>`];

    if (nearM) {
      const mY = PLOT.bottom - (Math.max(0, Math.min(100, nearM.value)) / 100) * plotHeight;
      hoverMoisture.setAttribute('cx', clampedX.toFixed(1));
      hoverMoisture.setAttribute('cy', mY.toFixed(1));
      hoverMoisture.hidden = false;
      lines.push(`Bodenfeuchte: <strong>${Math.round(nearM.value)} %</strong>`);
    } else {
      hoverMoisture.hidden = true;
    }

    if (nearW) {
      const wY = PLOT.bottom - (Math.max(0, Math.min(100, nearW.value)) / 100) * plotHeight;
      hoverWater.setAttribute('cx', clampedX.toFixed(1));
      hoverWater.setAttribute('cy', wY.toFixed(1));
      hoverWater.hidden = false;
      const ml = Math.round(nearW.volumeMl ?? (nearW.value / 100) * WATER_CAPACITY_ML);
      lines.push(`Wasservorrat: <strong>${Math.round(nearW.value)} % (${ml} ml)</strong>`);
    } else {
      hoverWater.hidden = true;
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
  onStartPump: async durationMs => {
    await sendPumpRequest(() => connection.startPump(durationMs));
    const nowIso = new Date().toISOString();
    activeWateringStartMs = Date.now();
    activeWateringEventId = await history.saveWateringEvent('manual', durationMs);

    historyData.wateringEvents.unshift({
      id: activeWateringEventId,
      started_at: nowIso,
      mode: 'manual',
      duration_ms: durationMs
    });
    renderHistory();
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
  onConnectionChange: connected => dashboard.showConnected(connected),
  onPumpAvailability: availability => dashboard.showPumpAvailability(availability),
  onPumpState: async pumpState => {
    dashboard.showPumpState(pumpState);
    const isRunning = Boolean(pumpState?.running);

    if (isRunning && !previousPumpRunning) {
      const mode = pumpState.mode === 'manual' ? 'manual' : 'auto';
      const eventId = await history.saveWateringEvent(mode, null);

      if (eventId !== null) {
        activeWateringStartMs = Date.now();
        activeWateringEventId = eventId;
        historyData.wateringEvents.unshift({
          id: eventId,
          started_at: new Date().toISOString(),
          mode,
          duration_ms: null
        });
        renderHistory();
      }
    }

    if (!isRunning && previousPumpRunning && activeWateringStartMs !== null) {
      const measuredDurationMs = Date.now() - activeWateringStartMs;
      if (activeWateringEventId) {
        history.updateWateringDuration(activeWateringEventId, measuredDurationMs);
        const entry = historyData.wateringEvents.find(ev => ev.id === activeWateringEventId);
        if (entry && !entry.duration_ms) {
          entry.duration_ms = measuredDurationMs;
          renderHistory();
        }
      }
      activeWateringStartMs = null;
      activeWateringEventId = null;
    }

    previousPumpRunning = isRunning;
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