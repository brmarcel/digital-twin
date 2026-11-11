/**
 * @file theme.js
 * Verwaltet Hell-/Dunkelmodus und speichert ausschließlich die Designauswahl.
 * MQTT-Zugangsdaten werden bewusst nicht im localStorage abgelegt.
 */
const THEME_STORAGE_KEY = 'plant-twin-theme';

/**
 * Initialisiert den Header-Button und synchronisiert CSS und Three.js.
 * @param {(theme: 'dark'|'light') => void} onThemeChange - Passt den 3D-Hintergrund an.
 * @returns {void}
 */
export function setupTheme(onThemeChange) {
  const toggle = document.getElementById('theme-toggle');
  const themeColor = document.querySelector('meta[name="theme-color"]');

  /** @param {'dark'|'light'} selectedTheme - Zu aktivierender Modus. */
  function applyTheme(selectedTheme) {
    const theme = selectedTheme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    const action = theme === 'dark' ? 'Light Mode aktivieren' : 'Dark Mode aktivieren';
    toggle.setAttribute('aria-label', action);
    toggle.title = action;
    themeColor?.setAttribute('content', theme === 'dark' ? '#101720' : '#f3f6fa');
    onThemeChange(theme);
  }

  applyTheme(document.documentElement.dataset.theme);

  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (error) {
      // Auch bei deaktiviertem localStorage bleibt das Umschalten nutzbar.
      console.debug('Designauswahl konnte nicht gespeichert werden:', error);
    }
  });
}
