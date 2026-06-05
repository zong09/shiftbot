import React, { useState, useEffect, useCallback } from 'react';
import StatusCard   from './components/StatusCard.jsx';
import Positions    from './components/Positions.jsx';
import TradeHistory from './components/TradeHistory.jsx';
import { fetchStatus, fetchTrades } from './api.js';

const REFRESH_INTERVAL = 30_000; // 30 วินาที

export default function App() {
  const [status,    setStatus]    = useState(null);
  const [trades,    setTrades]    = useState([]);
  const [lastFetch, setLastFetch] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [s, t] = await Promise.all([fetchStatus(), fetchTrades()]);
      setStatus(s);
      setTrades(t.trades ?? []);
      setLastFetch(new Date());
      setCountdown(REFRESH_INTERVAL / 1000);
    } catch (e) {
      setError('เชื่อมต่อ API ไม่ได้ — ตรวจสอบว่า Bot กำลังรันอยู่ที่ localhost:3000');
    } finally {
      setLoading(false);
    }
  }, []);

  // auto refresh
  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [loadData]);

  // countdown display
  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, [lastFetch]);

  return (
    <div style={{ minHeight: '100vh', padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
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
            onClick={loadData}
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
      <StatusCard status={status} />
      <Positions  positions={status?.openPositions ?? []} />
      <TradeHistory trades={trades} />

      {/* Footer */}
      <div style={{ textAlign: 'center', color: '#334155', fontSize: 11, paddingTop: 12 }}>
        ⚠️ ทดสอบบน Testnet ก่อนใช้เงินจริงเสมอ
      </div>
    </div>
  );
}
