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

export default function StatusCard({ status }) {
  if (!status) return <div style={s.card}>กำลังโหลด...</div>;
  const cdc = status.lastCDC;
  const pnl = parseFloat(status.totalPnl);

  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>
          🤖 Bot Status &nbsp;
          <span style={{ fontSize: 13, background: '#22c55e22', color: '#22c55e', borderRadius: 6, padding: '2px 10px' }}>
            Running
          </span>
        </h2>
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
