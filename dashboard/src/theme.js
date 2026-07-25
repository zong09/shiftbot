// Design tokens — keep hex values in sync with the CSS variables in src/index.css.
// The canvas chart (PriceChart) can't read CSS vars, so it consumes this JS copy.

// The design writes the chart's axis/crosshair colors as color-mix() against --text-dim.
// SVG presentation attributes don't reliably parse color-mix()/var(), so the same values are
// resolved here in JS instead.
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// color-mix(in srgb, a pct%, b) — per-channel lerp.
export function mixHex(a, b, pct) {
  const [x, y] = [a, b].map(h => parseInt(h.slice(1), 16));
  const w = pct / 100;
  const ch = s => Math.round((((x >> s) & 255) * w) + (((y >> s) & 255) * (1 - w)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export const TOKENS = {
  dark: {
    bg: '#1b2026',
    surface: '#242b33',
    surfaceAlt: '#2c343d',
    border: '#333d47',
    textPrimary: '#e9ecef',
    textSecondary: '#98a2ae',
    accent: '#7895b2',
    bull: '#5cc48a',
    bear: '#e6806a',
    warn: '#b5883f',
    // Axis, grid and crosshair are tints of textSecondary; the tags invert text on surface.
    // EMA and trade-close colors are accent-derived, so PriceChart computes them per mode.
    chart: {
      grid:      withAlpha('#98a2ae', 0.24),
      gridV:     withAlpha('#98a2ae', 0.14),
      tick:      withAlpha('#98a2ae', 0.55),
      axisText:  '#98a2ae',
      crosshair: withAlpha('#98a2ae', 0.70),
      tagBg:     '#e9ecef',
      tagText:   '#242b33',
      up: '#5cc48a',
      dn: '#e6806a',
    },
  },
  light: {
    bg: '#f5efe6',
    surface: '#fffdf8',
    surfaceAlt: '#f8f3e9',
    border: '#e8dfca',
    textPrimary: '#28303a',
    textSecondary: '#78828f',
    accent: '#7895b2',
    bull: '#2f8f5f',
    bear: '#c65f49',
    warn: '#b5883f',
    chart: {
      grid:      withAlpha('#78828f', 0.24),
      gridV:     withAlpha('#78828f', 0.14),
      tick:      withAlpha('#78828f', 0.55),
      axisText:  '#78828f',
      crosshair: withAlpha('#78828f', 0.70),
      tagBg:     '#28303a',
      tagText:   '#fffdf8',
      up: '#2f8f5f',
      dn: '#c65f49',
    },
  },
};

// Default accent per trading mode (user-overridable, persisted in ThemeContext).
export const DEFAULT_ACCENT = { live: '#7895b2', sandbox: '#b5883f' };

// Accent swatch presets shown in Settings › Appearance.
export const ACCENT_PRESETS = ['#7895b2', '#5b9279', '#df7861', '#ecb390', '#c9a227', '#7d5fd6', '#4a90a4', '#b5883f'];

// Single source of truth for CDC zone colors (ZoneBar, zone badges) — design-handoff palette.
// `text` is the legible foreground for that cell's background.
export const ZONES = [
  { zone: 1, name: 'Strong Bull', color: '#3f9e6b', text: '#ffffff' },
  { zone: 2, name: 'Bull',        color: '#5aab7d', text: '#ffffff' },
  { zone: 3, name: 'Pre Bull',    color: '#84b98c', text: '#20321f' },
  { zone: 4, name: 'Neutral',     color: '#c9c48a', text: '#3a3616' },
  { zone: 5, name: 'Neutral',     color: '#dcbf82', text: '#3a2f14' },
  { zone: 6, name: 'Pre Bear',    color: '#d6a06a', text: '#ffffff' },
  { zone: 7, name: 'Bear',        color: '#cf8570', text: '#ffffff' },
  { zone: 8, name: 'Strong Bear', color: '#c1614e', text: '#ffffff' },
];

export const zoneByNumber = (n) => ZONES.find(z => z.zone === Number(n)) ?? null;

// Zone badge tint used wherever a zone is shown as a pill (chart badge, pair rows,
// the Bot Status "CDC Zone" tile) — design handoff: bg = zone@18%, fg = zone@82% + #151a20.
export function zoneBadgeStyle(n) {
  const zone = zoneByNumber(n);
  if (!zone) return undefined;
  return {
    background: `color-mix(in srgb, ${zone.color} 18%, transparent)`,
    color:      `color-mix(in srgb, ${zone.color} 82%, #151a20)`,
  };
}

// Foreground-only variant, for places that tint text but not a background
// (Bot Status "CDC Zone" tile value).
export const zoneTextColor = (n) => {
  const zone = zoneByNumber(n);
  return zone ? `color-mix(in srgb, ${zone.color} 82%, #151a20)` : undefined;
};
