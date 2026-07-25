import React, { useState, useEffect, useCallback, useRef } from 'react';
import StatusCard   from './components/StatusCard.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import Positions    from './components/Positions.jsx';
import TradeHistory from './components/TradeHistory.jsx';
import PriceChart   from './components/PriceChart.jsx';
import Settings     from './components/Settings.jsx';
import Login        from './components/Login.jsx';
import { LogoTile, Refresh, Sun, Moon, Logout } from './components/icons.jsx';
import { useTheme } from './ThemeContext.jsx';
import { fetchStatus, fetchTrades, fetchCandles, fetchSettings, updateSettings, addPair, removePair, closePosition } from './api.js';

const REFRESH_INTERVAL = 30_000;

const MODES = [
  { key: 'live',    label: 'Live',    dot: '#3f9e6b' },
  { key: 'sandbox', label: 'Sandbox', dot: '#b5883f' },
];

const BANNER = {
  live:    { title: 'Live Mode',    msg: 'ส่ง order จริงด้วยเงินจริงบน Binance Futures' },
  sandbox: { title: 'Sandbox Mode', msg: 'ส่ง order จำลองไปที่ Binance Demo Trade' },
};

const segClass = (active) =>
  `inline-flex items-center gap-[7px] px-[15px] py-[7px] rounded-[9px] text-[13px] font-semibold leading-none cursor-pointer transition-all duration-150 ${
    active ? 'bg-accent text-white shadow-[0_2px_8px_-2px_color-mix(in_srgb,var(--accent)_60%,transparent)]' : 'text-secondary hover:text-primary'
  }`;

const chipClass = (active) =>
  `px-4 py-[7px] rounded-lg text-[12.5px] font-semibold leading-none cursor-pointer transition-all duration-150 ${
    active ? 'bg-surface text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'text-secondary hover:text-primary'
  }`;

export default function App() {
  const { theme, toggle, accentFor, layout, setLayout } = useTheme();
  const [token,          setToken]          = useState(() => localStorage.getItem('token'));
  const [mode,           setMode]           = useState('live');
  const [status,         setStatus]         = useState(null);
  const [trades,         setTrades]         = useState([]);
  const [candles,        setCandles]        = useState([]);
  const [indicators,     setIndicators]     = useState([]);
  const [chartTimeframe, setChartTimeframe] = useState('1h');
  const [chartSymbol,    setChartSymbol]    = useState('BTC/USDT:USDT');
  const [lastFetch,      setLastFetch]      = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [countdown,      setCountdown]      = useState(REFRESH_INTERVAL / 1000);
  const [settings,       setSettings]       = useState(null);
  const [page,           setPage]           = useState('dashboard');
  const prevModeRef   = useRef(null);
  const prevSymbolRef = useRef(null);
  const loadSeqRef    = useRef(0);

  // Listen to token expiration or 401 events from the axios interceptor
  useEffect(() => {
    const handleUnauthorized = () => setToken(null);
    window.addEventListener('unauthorized', handleUnauthorized);
    return () => window.removeEventListener('unauthorized', handleUnauthorized);
  }, []);

  const loadData = useCallback(async (activeMode, activeTf, activeSym) => {
    // Superseded responses (mode/symbol/timeframe changed mid-flight) must not
    // overwrite fresh state — otherwise Live data can render under the Sandbox tab.
    const seq = ++loadSeqRef.current;
    try {
      setError(null);
      const [s, t, c, cfg] = await Promise.all([
        fetchStatus(activeMode),
        fetchTrades(activeMode),
        fetchCandles(activeTf, activeSym),
        fetchSettings(),
      ]);
      if (seq !== loadSeqRef.current) return;
      setStatus(s);
      setTrades(t.trades ?? []);
      setCandles(c.candles ?? []);
      setIndicators(c.indicators ?? []);
      setSettings(cfg);
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL / 1000);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      // 401 is handled by the axios interceptor (logout + redirect to Login) —
      // don't overwrite it with a misleading "bot is down" banner
      if (err.response?.status !== 401) {
        setError('เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่า Bot กำลังรันอยู่');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // reload when mode / chartTimeframe / chartSymbol changes
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    // Clear the chart so stale candles from the previous symbol/timeframe are
    // never displayed as if they were current data
    setCandles([]);
    setIndicators([]);
    loadData(mode, chartTimeframe, chartSymbol);
    const timer = setInterval(() => loadData(mode, chartTimeframe, chartSymbol), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [mode, chartTimeframe, chartSymbol, loadData, token]);

  // countdown display
  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, [lastFetch]);

  // sync chart TF to the selected symbol's strategy timeframe on mode/symbol change
  useEffect(() => {
    const pairs = settings?.[mode];
    if (!Array.isArray(pairs) || pairs.length === 0) return;

    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      const firstPair = pairs[0];
      prevSymbolRef.current = firstPair.symbol;
      if (firstPair.symbol) setChartSymbol(firstPair.symbol);
      if (firstPair.timeframe) setChartTimeframe(firstPair.timeframe);
      return;
    }

    if (prevSymbolRef.current !== chartSymbol) {
      prevSymbolRef.current = chartSymbol;
      const pair = pairs.find(p => p.symbol === chartSymbol);
      if (pair?.timeframe) setChartTimeframe(pair.timeframe);
    }
  }, [mode, chartSymbol, settings]);

  if (!token) {
    return <Login onLoginSuccess={setToken} />;
  }

  const banner = BANNER[mode];
  const rootStyle = {
    '--accent': accentFor(mode),
    '--split-cols': layout === 'split' ? 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))' : '1fr',
  };

  return (
    <div style={rootStyle} className="min-h-dvh bg-bg text-primary">
      <div className="max-w-[1360px] mx-auto px-5 pt-4 pb-[60px]">

        {/* Top bar */}
        <header className="flex items-center gap-[18px] flex-wrap pb-4 mb-4 border-b border-border">
          <div className="flex items-center gap-[11px] mr-1">
            <LogoTile size={38} radius={11} iconSize={23} />
            <div>
              <div className="font-display font-bold text-[18px] leading-none tracking-[-0.02em]">ShiftBot</div>
              <div className="text-[11px] text-secondary mt-[3px]">Binance Futures · {chartSymbol.replace(':USDT', '')}</div>
            </div>
          </div>

          {/* Mode segmented control */}
          <div className="flex gap-[5px] p-1 bg-surface-alt border border-border rounded-xl">
            {MODES.map(m => (
              <button key={m.key} className={segClass(mode === m.key)} onClick={() => setMode(m.key)}>
                <span className="w-[7px] h-[7px] rounded-full" style={{ background: m.dot }} />
                {m.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2.5 flex-wrap">
            {lastFetch && (
              <div className="text-right leading-[1.4] mr-1">
                <div className="text-[11px] text-secondary">อัพเดทล่าสุด <span className="tabular-nums">{lastFetch.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}</span></div>
                <div className="text-[11px] text-secondary">refresh ใน <span className="tabular-nums">{countdown}s</span></div>
              </div>
            )}
            <button
              onClick={() => loadData(mode, chartTimeframe, chartSymbol)}
              disabled={loading}
              className="inline-flex items-center gap-[7px] px-[13px] py-[9px] border border-border rounded-[10px] bg-surface text-[13px] font-medium hover:border-accent transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              <Refresh /> {loading ? '...' : 'Refresh'}
            </button>
            <button
              onClick={toggle}
              title="Theme"
              className="w-[38px] h-[38px] flex items-center justify-center border border-border rounded-[10px] bg-surface hover:border-accent transition-colors duration-150 cursor-pointer"
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            <button
              onClick={() => { localStorage.removeItem('token'); setToken(null); }}
              className="inline-flex items-center gap-[7px] px-[13px] py-[9px] border border-border rounded-[10px] bg-surface text-[13px] font-medium hover:text-bear hover:border-bear transition-colors duration-150 cursor-pointer"
            >
              <Logout /> Logout
            </button>
          </div>
        </header>

        {/* Nav */}
        <nav className="flex gap-1.5 p-[5px] bg-surface border border-border rounded-[13px] mb-3.5">
          {[['dashboard', 'Dashboard'], ['settings', 'Settings']].map(([key, label]) => {
            const active = page === key;
            return (
              <button
                key={key}
                onClick={() => setPage(key)}
                className={`px-[18px] py-[9px] rounded-[10px] text-[13.5px] font-semibold leading-none cursor-pointer transition-all duration-150 ${active ? 'text-accent' : 'text-secondary hover:text-primary'}`}
                style={active
                  ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)' }
                  : { border: '1px solid transparent' }}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {/* Mode banner */}
        <div
          className="flex items-center gap-2.5 px-[15px] py-[11px] mb-4 rounded-xl text-[13px] font-medium"
          style={{
            border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
          }}
        >
          <span className="w-2 h-2 rounded-full animate-sbpulse" style={{ background: 'var(--accent)' }} />
          <span className="font-display font-bold">{banner.title}</span>
          <span className="opacity-85">— {banner.msg}</span>
        </div>

        {/* Error banner */}
        {error && (
          <div className="border border-bear/30 bg-bear/10 text-bear rounded-xl px-4 py-3 mb-4 text-[13px]">
            {error}
          </div>
        )}

        {page === 'settings' ? (
          <Settings
            settings={settings}
            activeMode={mode}
            onModeChange={setMode}
            onSave={async (m, symbol, data) => {
              await updateSettings(m, { symbol, ...data });
              if (m === mode && symbol === chartSymbol && data.timeframe) {
                setChartTimeframe(data.timeframe);
              }
              await loadData(mode, chartTimeframe, chartSymbol);
            }}
            onAddPair={async (m, symbol) => {
              await addPair(m, symbol);
              await loadData(mode, chartTimeframe, chartSymbol);
            }}
            onRemovePair={async (m, symbol) => {
              try {
                await removePair(m, symbol);
                if (m === mode && symbol === chartSymbol) {
                  const remaining = (settings?.[m] ?? []).filter(p => p.symbol !== symbol);
                  if (remaining[0]) setChartSymbol(remaining[0].symbol);
                }
                await loadData(mode, chartTimeframe, chartSymbol);
              } catch (err) {
                setError(`ลบ pair ไม่สำเร็จ: ${err.response?.data?.message ?? err.message}`);
              }
            }}
          />
        ) : (
          <div className="flex flex-col gap-4 animate-sbfade">
            {/* Layout toggle */}
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-semibold tracking-[0.08em] text-secondary uppercase">Layout</span>
              <div className="flex gap-1 p-1 bg-surface-alt border border-border rounded-[10px]">
                {[['split', 'Split'], ['stack', 'Stack']].map(([key, label]) => (
                  <button key={key} className={chipClass(layout === key)} onClick={() => setLayout(key)}>{label}</button>
                ))}
              </div>
            </div>

            <PortfolioSummary
              pairs={status?.pairs ?? []}
              trades={trades}
              balance={status?.balance}
              activeSymbol={chartSymbol}
              onSymbolChange={setChartSymbol}
            />

            {/* Chart + rail — grid columns follow the Split/Stack layout */}
            <div style={{ display: 'grid', gridTemplateColumns: 'var(--split-cols)', gap: 16, alignItems: 'start' }}>
              <div className="min-w-0">
                <PriceChart
                  candles={candles}
                  indicators={indicators}
                  positions={(status?.openPositions ?? []).filter(p => p.symbol === chartSymbol)}
                  trades={(trades ?? []).filter(t => t.symbol === chartSymbol)}
                  symbol={chartSymbol}
                  chartTimeframe={chartTimeframe}
                  onTimeframeChange={setChartTimeframe}
                />
              </div>
              <div className="min-w-0">
                <StatusCard
                  status={status}
                  pairs={settings?.[mode] ?? []}
                  activeSymbol={chartSymbol}
                  onSymbolChange={setChartSymbol}
                  onStatusChange={async (newStatus) => {
                    const activeSettings = settings?.[mode]?.find(p => p.symbol === chartSymbol);
                    if (activeSettings) {
                      await updateSettings(mode, { symbol: chartSymbol, status: newStatus });
                      await loadData(mode, chartTimeframe, chartSymbol);
                    }
                  }}
                />
                <Positions
                  positions={status?.openPositions ?? []}
                  pairs={status?.pairs ?? []}
                  onClose={async (id) => {
                    try {
                      await closePosition(id);
                      await loadData(mode, chartTimeframe, chartSymbol);
                    } catch (err) {
                      setError(`ปิด position ไม่สำเร็จ: ${err.response?.data?.message ?? err.message}`);
                    }
                  }}
                />
              </div>
            </div>

            <TradeHistory trades={trades} />
          </div>
        )}

        <div className="text-center text-secondary/60 text-[11px] pt-5">
          ระบบเชื่อมต่อ Testnet · กรุณาใช้ด้วยความระมัดระวัง
        </div>
      </div>
    </div>
  );
}
