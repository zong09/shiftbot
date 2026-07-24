import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { TOKENS, DEFAULT_ACCENT } from './theme.js';

const K_THEME  = 'shiftbot-theme';
const K_LIVE   = 'shiftbot-accent-live';
const K_SANDBX = 'shiftbot-accent-sandbox';
const K_LAYOUT = 'shiftbot-layout';

// Must match the pre-paint script in index.html (default = light)
function initialTheme() {
  try {
    const saved = localStorage.getItem(K_THEME);
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { /* ignore */ }
  return 'light';
}

function readAccent(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  } catch { /* ignore */ }
  return fallback;
}

function initialLayout() {
  try {
    const v = localStorage.getItem(K_LAYOUT);
    if (v === 'split' || v === 'stack') return v;
  } catch { /* ignore */ }
  return 'split';
}

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme]                 = useState(initialTheme);
  const [accentLive, setAccentLive]       = useState(() => readAccent(K_LIVE, DEFAULT_ACCENT.live));
  const [accentSandbox, setAccentSandbox] = useState(() => readAccent(K_SANDBX, DEFAULT_ACCENT.sandbox));
  const [layout, setLayoutState]          = useState(initialLayout);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem(K_THEME, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => { try { localStorage.setItem(K_LIVE, accentLive); } catch { /* ignore */ } }, [accentLive]);
  useEffect(() => { try { localStorage.setItem(K_SANDBX, accentSandbox); } catch { /* ignore */ } }, [accentSandbox]);
  useEffect(() => { try { localStorage.setItem(K_LAYOUT, layout); } catch { /* ignore */ } }, [layout]);

  const setAccent = useCallback((mode, hex) => {
    if (mode === 'sandbox') setAccentSandbox(hex); else setAccentLive(hex);
  }, []);

  const accentFor = useCallback(
    (mode) => (mode === 'sandbox' ? accentSandbox : accentLive),
    [accentLive, accentSandbox],
  );

  const resetAppearance = useCallback(() => {
    setTheme('light');
    setAccentLive(DEFAULT_ACCENT.live);
    setAccentSandbox(DEFAULT_ACCENT.sandbox);
  }, []);

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),
    accentLive,
    accentSandbox,
    setAccent,
    accentFor,
    layout,
    setLayout: setLayoutState,
    resetAppearance,
    colors: TOKENS[theme],
  }), [theme, accentLive, accentSandbox, layout, setAccent, accentFor, resetAppearance]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
