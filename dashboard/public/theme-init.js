// Pre-paint theme to avoid flash; must match initialTheme() in src/ThemeContext.jsx (default = light)
try {
  var t = localStorage.getItem('shiftbot-theme');
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
  }
} catch (e) { /* default light */ }
