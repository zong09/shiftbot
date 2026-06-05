import React from 'react';

const s = {
  card:  { background: '#1e2130', borderRadius: 12, padding: 20, marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { padding: '8px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #2d3748' },
  td:    { padding: '10px 12px', borderBottom: '1px solid #1a1f30' },
  empty: { textAlign: 'center', color: '#475569', padding: 30 },
};

export default function Positions({ positions = [] }) {
  return (
    <div style={s.card}>
      <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 700 }}>
        📈 Open Positions ({positions.length})
      </h3>
      <table style={s.table}>
        <thead>
          <tr>
            {['Side', 'Entry Price', 'Quantity', 'Stop Loss', 'Take Profit', 'Opened'].map(h => (
              <th key={h} style={s.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <tr><td colSpan={6} style={s.empty}>ไม่มี position เปิดอยู่</td></tr>
          ) : positions.map((p, i) => (
            <tr key={i}>
              <td style={{ ...s.td, color: '#22c55e', fontWeight: 700 }}>
                {p.side.toUpperCase()}
              </td>
              <td style={s.td}>{p.entryPrice?.toLocaleString()}</td>
              <td style={s.td}>{p.quantity}</td>
              <td style={{ ...s.td, color: '#ef4444' }}>{p.stopLoss?.toFixed(2)}</td>
              <td style={{ ...s.td, color: '#22c55e' }}>{p.takeProfit?.toFixed(2)}</td>
              <td style={{ ...s.td, color: '#64748b', fontSize: 11 }}>
                {new Date(p.openTime).toLocaleString('th-TH')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
