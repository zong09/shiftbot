import React, { useState, useEffect, useCallback, useRef } from 'react';
import StatusCard   from './components/StatusCard.jsx';
import Positions    from './components/Positions.jsx';
import TradeHistory from './components/TradeHistory.jsx';
import PriceChart   from './components/PriceChart.jsx';
import Settings      from './components/Settings.jsx';
import { fetchStatus, fetchTrades, fetchCandles, fetchSettings, updateSettings, addPair, removePair } from './api.js';

const REFRESH_INTERVAL = 30_000;

const TAB_STYLE = (active) => ({
  padding: '7px 20px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  background: active ? '#3b82f6' : 'transparent',
  color: active ? '#fff' : '#64748b',
  transition: 'background 0.15s',
});

export default function App() {
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
    } catch {
      setError('เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่า Bot กำลังรันอยู่ที่ localhost:3000');
    } finally {
      setLoading(false);
    }
  }, []);

  // reload when mode or chartTimeframe or chartSymbol changes
  useEffect(() => {
    setLoading(true);
    loadData(mode, chartTimeframe, chartSymbol);
    const timer = setInterval(() => loadData(mode, chartTimeframe, chartSymbol), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [mode, chartTimeframe, chartSymbol, loadData]);

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

  return (
    <div style={{ minHeight: '100vh', padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(135deg,#22c55e,#3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ShiftBot
          </h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Binance Futures · {chartSymbol.replace(':USDT', '')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastFetch && (
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'right' }}>
              <div>อัพเดตล่าสุด: {lastFetch.toLocaleTimeString('th-TH')}</div>
              <div>refresh ใน {countdown}s</div>
            </div>
          )}
          <button
            onClick={() => loadData(mode, chartTimeframe, chartSymbol)}
            disabled={loading}
            style={{
              background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            {loading ? '...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div style={{
        display: 'inline-flex', alignItems: 'center',
        background: '#1e293b', borderRadius: 10, padding: 4,
        marginBottom: 20,
      }}>
        <button style={TAB_STYLE(mode === 'live')} onClick={() => setMode('live')}>
          🟢 Live
        </button>
        <button style={TAB_STYLE(mode === 'sandbox')} onClick={() => setMode('sandbox')}>
          🧪 Sandbox
        </button>
        <span style={{ width: 1, height: 20, background: '#334155', margin: '0 4px', flexShrink: 0 }} />
        <button style={TAB_STYLE(activeTab === 'chart')} onClick={() => setActiveTab('chart')}>
          Chart
        </button>
        <button style={TAB_STYLE(activeTab === 'settings')} onClick={() => setActiveTab('settings')}>
          Settings
        </button>
      </div>

      {/* Sandbox Banner */}
      {isSandbox && (
        <div style={{
          background: '#1e3a1e', border: '1px solid #166534', borderRadius: 10,
          padding: '10px 16px', marginBottom: 16,
          color: '#86efac', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          🧪 <strong>Sandbox Mode</strong> — Paper trading, ไม่มีการส่ง order จริง
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div style={{
          background: '#7f1d1d', borderRadius: 10, padding: '14px 18px',
          marginBottom: 16, color: '#fca5a5', fontSize: 13,
        }}>
          ⚠️ {error}
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
            botStatus={firstPairStatus}
            onStatusChange={async (newStatus) => {
              const pairs = settings?.[mode] ?? [];
              await Promise.all(pairs.map(p => updateSettings(mode, { symbol: p.symbol, status: newStatus })));
              await loadData(mode, chartTimeframe, chartSymbol);
            }}
          />
          {(settings?.[mode]?.length ?? 0) > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {settings[mode].map(p => (
                <button
                  key={p.symbol}
                  onClick={() => setChartSymbol(p.symbol)}
                  style={{
                    padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                    fontSize: 12, fontWeight: 700,
                    background: chartSymbol === p.symbol ? '#3b82f6' : '#1e293b',
                    color: chartSymbol === p.symbol ? '#fff' : '#64748b',
                  }}
                >
                  {p.symbol.replace(':USDT', '')}
                </button>
              ))}
            </div>
          )}
          <PriceChart
            candles={candles}
            indicators={indicators}
            positions={status?.openPositions ?? []}
            symbol={chartSymbol}
            chartTimeframe={chartTimeframe}
            onTimeframeChange={setChartTimeframe}
          />
          <Positions  positions={status?.openPositions ?? []} />
          <TradeHistory trades={trades} />
        </>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', color: '#334155', fontSize: 11, paddingTop: 12 }}>
        ⚠️ ทดสอบบน Testnet ก่อนใช้เงินจริงเสมอ
      </div>
    </div>
  );
}
