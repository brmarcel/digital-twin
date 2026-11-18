/**
 * notifications.js – Lokale Ereignisliste mit Lesen und Löschen.
 * Nutzt ausschließlich die bereits validierten MQTT-Wasserstandsmesswerte.
 * Keine MQTT-Publishs, keine Pumpenbefehle und keine System-Pushes.
 */
const STORE_KEY = 'plant-twin-notifications-v1'; // Vorhandenen Verlauf weiterverwenden.
export const WATER_WARNING_THRESHOLD_PERCENT = 15;
export const WATER_EMPTY_THRESHOLD_PERCENT = 5;
export const WATER_RESET_THRESHOLD_PERCENT = 20;
const REQUIRED_CONSECUTIVE_READINGS = 2;
const MAX_MESSAGES = 30;

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const raw = Array.isArray(saved.messages) ? saved.messages : [];
    const messages = raw.filter(item =>
      item && typeof item.title === 'string' && typeof item.message === 'string' &&
      Number.isFinite(item.createdAt) && typeof item.read === 'boolean' &&
      item.kind !== 'test' // Frühere Demo-Testmeldungen nicht mehr anzeigen.
    ).slice(0, MAX_MESSAGES).map((item, index) => ({
      ...item,
      // Alte gespeicherte Meldungen hatten noch keine IDs.
      id: typeof item.id === 'string' && item.id ? item.id : `legacy-${item.createdAt}-${index}`
    }));
    return {
      messages,
      notifiedCritical: saved.notifiedCritical === true,
      notifiedEmpty: saved.notifiedEmpty === true
    };
  } catch {
    return { messages: [], notifiedCritical: false, notifiedEmpty: false };
  }
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createNotifications() {
  const menu = document.getElementById('notification-menu');
  const toggle = document.getElementById('notification-toggle');
  const panel = document.getElementById('notification-panel');
  const close = document.getElementById('notification-close');
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notification-list');
  const markRead = document.getElementById('notification-mark-read');
  const deleteRead = document.getElementById('notification-delete-read');
  const banner = document.getElementById('water-alert-banner');
  const bannerMessage = document.getElementById('water-alert-message');
  const toast = document.getElementById('notification-toast');

  const state = restore();
  let connected = false;
  let lastPercent = null;
  let candidate = null;
  let consecutive = 0;
  let toastTimer = null;

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { /* Auch ohne localStorage funktionieren Warnungen während der Sitzung. */ }
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('open', open);
  }

  function markOneRead(id) {
    const item = state.messages.find(m => m.id === id);
    if (item && !item.read) {
      item.read = true;
      persist();
      renderList();
    }
  }

  function markAllRead() {
    state.messages.forEach(item => { item.read = true; });
    persist();
    renderList();
  }

  function deleteAllEvents() {
    // Nur den sichtbaren Ereignisverlauf löschen, nicht den aktiven Alarmzustand.
    state.messages = [];
    persist();
    renderList();
  }

  function renderList() {
    list.replaceChildren();
    const unread = state.messages.filter(item => !item.read).length;
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    toggle.setAttribute('aria-label', unread
      ? `Benachrichtigungen öffnen, ${unread} ungelesen` : 'Benachrichtigungen öffnen');

    if (!state.messages.length) {
      const empty = document.createElement('li');
      empty.className = 'notification-empty';
      empty.textContent = 'Keine Benachrichtigungen vorhanden.';
      list.append(empty);
    } else {
      state.messages.forEach(item => {
        const li = document.createElement('li');
        li.className = 'notification-item' + (item.read ? '' : ' unread') +
          (item.kind === 'empty' ? ' is-urgent' : '');
        const eventButton = document.createElement('button');
        eventButton.type = 'button';
        eventButton.className = 'notification-item-content';
        eventButton.setAttribute('aria-label', item.read
          ? `${item.title}: gelesen` : `${item.title}: als gelesen markieren`);
        eventButton.addEventListener('click', () => markOneRead(item.id));
        const head = document.createElement('div');
        head.className = 'notification-item-head';
        const title = document.createElement('strong');
        title.textContent = item.title;
        head.append(title);
        if (!item.read) {
          const dot = document.createElement('span');
          dot.className = 'notification-unread-dot';
          dot.setAttribute('aria-label', 'Ungelesen');
          dot.title = 'Ungelesen';
          head.append(dot);
        }
        const content = document.createElement('p');
        content.textContent = item.message;
        const when = document.createElement('time');
        when.dateTime = new Date(item.createdAt).toISOString();
        when.textContent = new Date(item.createdAt).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        eventButton.append(head, content, when);
        li.append(eventButton);
        list.append(li);
      });
    }
    markRead.disabled = unread === 0;
    deleteRead.disabled = state.messages.length === 0;
  }

  function showToast(title, message, kind) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.classList.toggle('urgent', kind === 'empty');
    toast.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = title;
    const details = document.createElement('span');
    details.textContent = message;
    toast.append(heading, details);
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
  }

  function notify(kind, title, message) {
    state.messages.unshift({
      id: newId(), kind, title, message, createdAt: Date.now(), read: false
    });
    state.messages.splice(MAX_MESSAGES);
    persist();
    renderList();
    showToast(title, message, kind);
  }

  function updateBanner() {
    if (lastPercent === null || !connected) {
      banner.hidden = true;
      return;
    }
    if (lastPercent <= WATER_EMPTY_THRESHOLD_PERCENT) {
      banner.dataset.severity = 'empty';
      bannerMessage.textContent = `Wassertank leer (${Math.round(lastPercent)} %). Bitte Wasser nachfüllen.`;
    } else if (lastPercent < WATER_WARNING_THRESHOLD_PERCENT) {
      banner.dataset.severity = 'critical';
      bannerMessage.textContent = `Wasserstand kritisch (${Math.round(lastPercent)} %). Bitte Tank zeitnah auffüllen.`;
    } else if (lastPercent < WATER_RESET_THRESHOLD_PERCENT &&
               (state.notifiedCritical || state.notifiedEmpty)) {
      banner.dataset.severity = 'critical';
      bannerMessage.textContent = `Wasserstand bei ${Math.round(lastPercent)} %. Die Warnung wird ab 20 % zurückgesetzt.`;
    } else {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
  }

  function onWaterLevel(level) {
    if (!level?.valid || !Number.isFinite(level.percent)) {
      lastPercent = null;
      candidate = null;
      consecutive = 0;
      updateBanner();
      return;
    }
    const percent = level.percent;
    lastPercent = percent;
    const type = percent <= WATER_EMPTY_THRESHOLD_PERCENT ? 'empty'
      : percent < WATER_WARNING_THRESHOLD_PERCENT ? 'critical'
      : percent >= WATER_RESET_THRESHOLD_PERCENT ? 'reset' : 'intermediate';

    // Sensorrauschen: zwei aufeinanderfolgende Messwerte derselben Zone.
    if (type === candidate) consecutive += 1;
    else { candidate = type; consecutive = 1; }

    if (consecutive >= REQUIRED_CONSECUTIVE_READINGS) {
      if (type === 'reset') {
        if (state.notifiedCritical || state.notifiedEmpty) {
          state.notifiedCritical = false;
          state.notifiedEmpty = false;
          persist();
        }
      } else if (type === 'empty' && !state.notifiedEmpty) {
        state.notifiedEmpty = true;
        state.notifiedCritical = true;
        persist();
        notify('empty', 'Wassertank leer',
          `Der Füllstand beträgt nur noch ${Math.round(percent)} %. Bitte Wasser nachfüllen.`);
      } else if (type === 'critical' && !state.notifiedCritical) {
        state.notifiedCritical = true;
        persist();
        notify('critical', 'Wasserstand kritisch',
          `Der Füllstand beträgt ${Math.round(percent)} % und liegt unter 15 %.`);
      }
    }
    updateBanner();
  }

  function onConnectionChange(value) {
    connected = Boolean(value);
    if (!connected) {
      lastPercent = null;
      candidate = null;
      consecutive = 0;
    }
    updateBanner();
  }

  toggle?.addEventListener('click', () => setOpen(panel.hidden));
  close?.addEventListener('click', () => setOpen(false));
  markRead?.addEventListener('click', markAllRead);
  deleteRead?.addEventListener('click', deleteAllEvents);
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !menu.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
  persist(); // Migration: IDs ergänzen, alte Demo-Testmeldungen entfernen.
  renderList();
  return { onWaterLevel, onConnectionChange };
}
