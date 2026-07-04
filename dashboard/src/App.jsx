import React, { useState, useEffect, useCallback, useRef } from 'react';
import StatusCard   from './components/StatusCard.jsx';
import Positions    from './components/Positions.jsx';
import TradeHistory from './components/TradeHistory.jsx';
import PriceChart   from './components/PriceChart.jsx';
import Settings      from './components/Settings.jsx';
import Login         from './components/Login.jsx';
import { useTheme } from './ThemeContext.jsx';
import { fetchStatus, fetchTrades, fetchCandles, fetchSettings, updateSettings, addPair, removePair, closePosition } from './api.js';

const REFRESH_INTERVAL = 30_000;

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

const tabClass = (active) =>
  `px-5 py-1.5 rounded-md text-[13px] font-semibold cursor-pointer transition-colors duration-150 ${
    active ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'
  }`;

export default function App() {
  const { theme, toggle } = useTheme();
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
  const [activeTab,      setActiveTab]      = useState('chart');
  const prevModeRef = useRef(null);

  // Listen to token expiration or 401 events from Axios interceptor
  useEffect(() => {
    const handleUnauthorized = () => {
      setToken(null);
    };
    window.addEventListener('unauthorized', handleUnauthorized);
    return () => window.removeEventListener('unauthorized', handleUnauthorized);
  }, []);

  const loadData = useCallback(async (activeMode, activeTf, activeSym) => {
    try {
      setError(null);
      const [s, t, c, cfg] = await Promise.all([
        fetchStatus(activeMode),
        fetchTrades(activeMode),
        fetchCandles(activeTf, activeSym),
        fetchSettings(),
      ]);
      setStatus(s);
      setTrades(t.trades ?? []);
      setCandles(c.candles ?? []);
      setIndicators(c.indicators ?? []);
      setSettings(cfg);
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL / 1000);
    } catch (err) {
      // 401 is handled by the axios interceptor (logout + redirect to Login) —
      // don't overwrite it with a misleading "bot is down" banner
      if (err.response?.status !== 401) {
        setError('เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่า Bot กำลังรันอยู่');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // reload when mode or chartTimeframe or chartSymbol changes
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    loadData(mode, chartTimeframe, chartSymbol);
    const timer = setInterval(() => loadData(mode, chartTimeframe, chartSymbol), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [mode, chartTimeframe, chartSymbol, loadData, token]);

  // countdown display
  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, [lastFetch]);

  // sync chart TF + symbol to first pair on mode change
  useEffect(() => {
    const pairs = settings?.[mode];
    const firstPair = Array.isArray(pairs) ? pairs[0] : null;
    if (firstPair && prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      if (firstPair.timeframe) setChartTimeframe(firstPair.timeframe);
      if (firstPair.symbol)    setChartSymbol(firstPair.symbol);
    }
  }, [mode, settings]);

  const isSandbox = mode === 'sandbox';
  const firstPairStatus = settings?.[mode]?.[0]?.status ?? null;

  if (!token) {
    return <Login onLoginSuccess={setToken} />;
  }

  return (
    <div className="min-h-dvh max-w-[1100px] mx-auto px-6 py-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ShiftBot</h1>
          <div className="text-xs text-secondary mt-0.5">
            Binance Futures · {chartSymbol.replace(':USDT', '')}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <div className="text-[11px] text-secondary/80 text-right tabular-nums">
              <div>อัพเดตล่าสุด: {lastFetch.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}</div>
              <div>refresh ใน {countdown}s</div>
            </div>
          )}
          <button
            onClick={() => loadData(mode, chartTimeframe, chartSymbol)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium text-secondary hover:bg-surface-alt hover:text-primary transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshIcon />
            {loading ? '...' : 'Refresh'}
          </button>
          <button
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border text-secondary hover:bg-surface-alt hover:text-primary transition-colors duration-150 cursor-pointer"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('token');
              setToken(null);
            }}
            aria-label="Logout"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium text-secondary hover:bg-bear/10 hover:text-bear hover:border-bear/30 transition-colors duration-150 cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="inline-flex items-center bg-surface-alt rounded-lg p-1 mb-5">
        <button className={tabClass(mode === 'live')} onClick={() => setMode('live')}>
          Live
        </button>
        <button className={tabClass(mode === 'sandbox')} onClick={() => setMode('sandbox')}>
          Sandbox
        </button>
        <span className="w-px h-5 bg-border mx-1 shrink-0" />
        <button className={tabClass(activeTab === 'chart')} onClick={() => setActiveTab('chart')}>
          Chart
        </button>
        <button className={tabClass(activeTab === 'settings')} onClick={() => setActiveTab('settings')}>
          Settings
        </button>
      </div>

      {/* Sandbox Banner */}
      {isSandbox && (
        <div className="border border-bull/30 bg-bull/10 text-bull rounded-lg px-4 py-2.5 mb-4 text-[13px]">
          <strong>Sandbox Mode</strong> — ส่ง order จริงไปที่ Binance Demo Trade
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="border border-bear/30 bg-bear/10 text-bear rounded-lg px-4 py-3 mb-4 text-[13px]">
          {error}
        </div>
      )}

      {/* Cards */}
      {activeTab === 'settings' ? (
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
            await removePair(m, symbol);
            if (m === mode && symbol === chartSymbol) {
              const remaining = (settings?.[m] ?? []).filter(p => p.symbol !== symbol);
              if (remaining[0]) setChartSymbol(remaining[0].symbol);
            }
            await loadData(mode, chartTimeframe, chartSymbol);
          }}
        />
      ) : (
        <>
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
          <PriceChart
            candles={candles}
            indicators={indicators}
            positions={(status?.openPositions ?? []).filter(p => p.symbol === chartSymbol)}
            trades={(trades ?? []).filter(t => t.symbol === chartSymbol)}
            symbol={chartSymbol}
            chartTimeframe={chartTimeframe}
            onTimeframeChange={setChartTimeframe}
          />
          <Positions
            positions={status?.openPositions ?? []}
            onClose={async (id) => {
              try {
                await closePosition(id);
                await loadData(mode, chartTimeframe, chartSymbol);
              } catch (err) {
                setError(`ปิด position ไม่สำเร็จ: ${err.response?.data?.message ?? err.message}`);
              }
            }}
          />
          <TradeHistory trades={trades} />
        </>
      )}

      {/* Footer */}
      <div className="text-center text-secondary/60 text-[11px] pt-3">
        ทดสอบบน Testnet ก่อนใช้เงินจริงเสมอ
      </div>
    </div>
  );
}
