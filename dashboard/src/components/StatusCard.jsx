import React from 'react';
import ZoneBar from './ZoneBar.jsx';

const s = {
  card:   { background: '#1e2130', borderRadius: 12, padding: 20, marginBottom: 16 },
  label:  { fontSize: 12, color: '#94a3b8', marginBottom: 4 },
  value:  { fontSize: 22, fontWeight: 700 },
  grid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 20 },
  item:   { background: '#262b3d', borderRadius: 8, padding: 14 },
};

const SIGNAL_COLOR = { BUY: '#22c55e', SELL: '#ef4444', HOLD: '#94a3b8' };

const STATUS_CFG = {
  on:    { bg: '#064e3b', color: '#0ECB81', label: 'Running' },
  pause: { bg: '#78350f', color: '#F59E0B', label: 'Paused'  },
  off:   { bg: '#450a0a', color: '#F6465D', label: 'Stopped' },
};

function CtrlBtn({ label, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
      fontSize: 12, fontWeight: 700, background: color + '22', color,
    }}>
      {label}
    </button>
  );
}

export default function StatusCard({ status, botStatus, onStatusChange }) {
  if (!status) return <div style={s.card}>กำลังโหลด...</div>;
  const cdc = status.lastCDC;
  const pnl = parseFloat(status.totalPnl);
  const cfg = STATUS_CFG[botStatus] ?? null;

  const handleStop = () => {
    if (window.confirm('หยุด bot? ระบบจะปิด open positions ทั้งหมดทันที')) {
      onStatusChange?.('off');
    }
  };

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>🤖 Bot Status</h2>
          {cfg ? (
            <span style={{ fontSize: 13, background: cfg.bg, color: cfg.color, borderRadius: 6, padding: '2px 10px' }}>
              {cfg.label}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: '#475569' }}>…</span>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {botStatus === 'on'    && <><CtrlBtn label="⏸ Pause"  color="#F59E0B" onClick={() => onStatusChange?.('pause')} /><CtrlBtn label="⏹ Stop" color="#F6465D" onClick={handleStop} /></>}
            {botStatus === 'pause' && <><CtrlBtn label="▶ Resume" color="#0ECB81" onClick={() => onStatusChange?.('on')}    /><CtrlBtn label="⏹ Stop" color="#F6465D" onClick={handleStop} /></>}
            {botStatus === 'off'   && <CtrlBtn label="▶ Start"   color="#0ECB81" onClick={() => onStatusChange?.('on')} />}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {status.symbol} · {status.timeframe}
        </div>
      </div>

      <div style={s.grid}>
        <div style={s.item}>
          <div style={s.label}>Signal</div>
          <div style={{ ...s.value, color: SIGNAL_COLOR[cdc?.signal] ?? '#fff' }}>
            {cdc?.signal ?? '—'}
          </div>
        </div>
        <div style={s.item}>
          <div style={s.label}>CDC Zone</div>
          <div style={{ ...s.value, color: cdc?.zoneColor ?? '#fff' }}>
            Zone {cdc?.zone ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{cdc?.zoneName}</div>
        </div>
        <div style={s.item}>
          <div style={s.label}>EMA 12</div>
          <div style={s.value}>{cdc ? parseFloat(cdc.emaFast).toFixed(2) : '—'}</div>
        </div>
        <div style={s.item}>
          <div style={s.label}>EMA 26</div>
          <div style={s.value}>{cdc ? parseFloat(cdc.emaSlow).toFixed(2) : '—'}</div>
        </div>
        <div style={s.item}>
          <div style={s.label}>Close Price</div>
          <div style={s.value}>{cdc?.close?.toLocaleString() ?? '—'}</div>
        </div>
        <div style={s.item}>
          <div style={s.label}>Total PnL</div>
          <div style={{ ...s.value, color: pnl >= 0 ? '#22c55e' : '#ef4444' }}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
          </div>
        </div>
      </div>

      <div style={s.label}>CDC Zone Bar</div>
      <ZoneBar currentZone={cdc?.zone} />
    </div>
  );
}
