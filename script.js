// PENGATURAN TEMA GELAP / TERANG
const themeToggle = document.getElementById('themeToggle');
const themeColorMeta = document.getElementById('themeColorMeta');

if (themeToggle && themeColorMeta) {
  const themeToggleIcon = themeToggle.querySelector('.theme-toggle-icon');
  const themeToggleLabel = themeToggle.querySelector('.theme-toggle-label');

  function applyTheme(theme, persist = true) {
    const isLight = theme === 'light';
    document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
    themeToggle.setAttribute('aria-pressed', String(isLight));
    themeToggle.setAttribute('aria-label', isLight ? 'Ganti ke mode gelap' : 'Ganti ke mode terang');
    if (themeToggleIcon) {
      themeToggleIcon.textContent =
        isLight ? '☾' : '☼';
    }
    if (themeToggleLabel) {
      themeToggleLabel.textContent =
        isLight ? 'Mode gelap' : 'Mode terang';
    }
    themeColorMeta.setAttribute('content', isLight ? '#f4f7fc' : '#090f1f');
    if (persist) {
      try {
        localStorage.setItem('si-projectspace-theme', isLight ? 'light' : 'dark');
      } catch (error) {
        // Tetap menggunakan tema untuk sesi saat ini.
      }
    }
  }

  // Terapkan tema awal.
  applyTheme(document.documentElement.dataset.theme || 'dark', false);

  // Tombol pergantian tema.
  themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark'
        ? 'light'
        : 'dark';
    applyTheme(nextTheme);
  });
}

// TAHUN OTOMATIS PADA FOOTER
const currentYear = document.getElementById('currentYear');
if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}