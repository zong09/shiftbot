import React, { useState, useEffect, useCallback, useRef } from 'react';
import StatusCard   from './components/StatusCard.jsx';
import Positions    from './components/Positions.jsx';
import TradeHistory from './components/TradeHistory.jsx';
import PriceChart   from './components/PriceChart.jsx';
import Settings      from './components/Settings.jsx';
import { fetchStatus, fetchTrades, fetchCandles, fetchSettings, updateSettings } from './api.js';

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
  const [lastFetch,      setLastFetch]      = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [countdown,      setCountdown]      = useState(REFRESH_INTERVAL / 1000);
  const [settings,       setSettings]       = useState(null);
  const [activeTab,      setActiveTab]      = useState('chart');
  const prevModeRef = useRef(null);

  const loadData = useCallback(async (activeMode, activeTf) => {
    try {
      setError(null);
      const [s, t, c, cfg] = await Promise.all([
        fetchStatus(activeMode),
        fetchTrades(activeMode),
        fetchCandles(activeTf),
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

  // reload when mode or chartTimeframe changes
  useEffect(() => {
    setLoading(true);
    loadData(mode, chartTimeframe);
    const timer = setInterval(() => loadData(mode, chartTimeframe), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [mode, chartTimeframe, loadData]);

  // countdown display
  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, [lastFetch]);

  // sync chart TF to settings TF on first load and on mode change
  useEffect(() => {
    const tf = settings?.[mode]?.timeframe;
    if (tf && prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      setChartTimeframe(tf);
    }
  }, [mode, settings]);

  const isSandbox = mode === 'sandbox';

  return (
    <div style={{ minHeight: '100vh', padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(135deg,#22c55e,#3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ShiftBot
          </h1>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Binance Futures · BTC/USDT</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastFetch && (
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'right' }}>
              <div>อัพเดตล่าสุด: {lastFetch.toLocaleTimeString('th-TH')}</div>
              <div>refresh ใน {countdown}s</div>
            </div>
          )}
          <button
            onClick={() => loadData(mode)}
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
          onSave={async (m, data) => {
            await updateSettings(m, data);
            if (m === mode) setChartTimeframe(data.timeframe);
            await loadData(mode, m === mode ? data.timeframe : chartTimeframe);
          }}
        />
      ) : (
        <>
          <StatusCard
            status={status}
            botStatus={settings?.[mode]?.status}
            onStatusChange={async (newStatus) => {
              await updateSettings(mode, { status: newStatus });
              await loadData(mode, chartTimeframe);
            }}
          />
          <PriceChart
            candles={candles}
            indicators={indicators}
            positions={status?.openPositions ?? []}
            symbol={status?.symbol}
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
