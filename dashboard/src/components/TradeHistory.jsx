import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const s = {
  card:  { background: '#1e2130', borderRadius: 12, padding: 20, marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #2d3748' },
  td:    { padding: '10px 12px', borderBottom: '1px solid #1a1f30' },
  empty: { textAlign: 'center', color: '#475569', padding: 30 },
};

const ACTION_LABEL = {
  OPEN_LONG:   { label: '🟢 Open Long',  color: '#22c55e' },
  CLOSE_LONG:  { label: '🔵 Close Long', color: '#60a5fa' },
  SL_HIT:      { label: '🛑 Stop Loss',  color: '#ef4444' },
  TP_HIT:      { label: '✅ Take Profit', color: '#22c55e' },
  OPEN_SHORT:  { label: '🔴 Open Short', color: '#f97316' },
  CLOSE_SHORT: { label: '🔵 Close Short',color: '#60a5fa' },
};

export default function TradeHistory({ trades = [] }) {
  // สร้าง PnL chart data จาก closed trades
  const pnlData = trades
    .filter(t => t.pnl !== undefined)
    .map((t, i) => ({ name: `#${i + 1}`, pnl: parseFloat(t.pnl.toFixed(2)) }));

  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 700 }}>
        📋 Trade History ({trades.length})
      </h3>

      {pnlData.length > 0 && (
        <div style={{ height: 120, marginBottom: 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pnlData} barSize={14}>
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: '#262b3d', border: 'none', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                formatter={v => [`${v > 0 ? '+' : ''}${v} USDT`, 'PnL']}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {pnlData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#22c55e' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <table style={s.table}>
        <thead>
          <tr>
            {['Action', 'Price', 'Qty', 'Zone', 'PnL', 'Time'].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr><td colSpan={6} style={s.empty}>ยังไม่มี trade</td></tr>
          ) : [...trades].reverse().map((t, i) => {
            const meta = ACTION_LABEL[t.action] ?? { label: t.action, color: '#fff' };
            const hasPnl = t.pnl !== undefined;
            return (
              <tr key={i}>
                <td style={{ ...s.td, color: meta.color, fontWeight: 600 }}>{meta.label}</td>
                <td style={s.td}>{t.price?.toLocaleString()}</td>
                <td style={s.td}>{t.quantity}</td>
                <td style={{ ...s.td, color: '#94a3b8' }}>Zone {t.zone}</td>
                <td style={{ ...s.td, color: hasPnl ? (t.pnl >= 0 ? '#22c55e' : '#ef4444') : '#475569', fontWeight: hasPnl ? 600 : 400 }}>
                  {hasPnl ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USDT` : '—'}
                </td>
                <td style={{ ...s.td, color: '#64748b', fontSize: 11 }}>
                  {new Date(t.timestamp).toLocaleString('th-TH')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
