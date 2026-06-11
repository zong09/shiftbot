// Design tokens — keep hex values in sync with the CSS variables in src/index.css
export const TOKENS = {
  dark: {
    bg: '#0b0d12',
    surface: '#11141b',
    surfaceAlt: '#161a23',
    border: '#232836',
    textPrimary: '#e6e9ef',
    textSecondary: '#8a93a5',
    accent: '#3b82f6',
    bull: '#0ecb81',
    bear: '#f6465d',
    warn: '#f59e0b',
    chart: {
      grid: '#1c212c',
      crosshair: '#4a5568',
      crosshairLabel: '#2d3748',
      volBull: 'rgba(14,203,129,0.35)',
      volBear: 'rgba(246,70,93,0.35)',
      emaFast: '#f5ac37',
      emaSlow: '#c084fc',
    },
  },
  light: {
    bg: '#f7f8fa',
    surface: '#ffffff',
    surfaceAlt: '#f1f3f6',
    border: '#e3e6ec',
    textPrimary: '#1a202c',
    textSecondary: '#64748b',
    accent: '#2563eb',
    bull: '#059669',
    bear: '#dc2626',
    warn: '#d97706',
    chart: {
      grid: '#eceff3',
      crosshair: '#94a3b8',
      crosshairLabel: '#cbd5e1',
      volBull: 'rgba(5,150,105,0.30)',
      volBear: 'rgba(220,38,38,0.30)',
      emaFast: '#d97706',
      emaSlow: '#9333ea',
    },
  },
};

// Single source of truth for CDC zone colors (ZoneBar, PriceChart candles, StatusCard badge)
export const ZONES = [
  { zone: 1, name: 'Strong Bull',     color: '#0ecb81', up: '#0ecb81', down: '#06a659' },
  { zone: 2, name: 'Bull',            color: '#00b894', up: '#00b894', down: '#009174' },
  { zone: 3, name: 'Weak Bull',       color: '#26d9b0', up: '#26d9b0', down: '#1aaa87' },
  { zone: 4, name: 'Caution Bull',    color: '#2ecc71', up: '#2ecc71', down: '#27ae60' },
  { zone: 5, name: 'Weak Bear',       color: '#f39c12', up: '#f39c12', down: '#d68910' },
  { zone: 6, name: 'Bear',            color: '#e67e22', up: '#e67e22', down: '#ca6f1e' },
  { zone: 7, name: 'Strong Bear (w)', color: '#f6465d', up: '#f6465d', down: '#d63031' },
  { zone: 8, name: 'Strong Bear',     color: '#c0392b', up: '#c0392b', down: '#a93226' },
];

export const zoneByNumber = (n) => ZONES.find(z => z.zone === Number(n)) ?? null;
