import React from 'react';

const TH_CLASS = 'px-3 py-2 text-left text-[11px] uppercase tracking-wide font-medium text-secondary border-b border-border';
const TD_CLASS = 'px-3 py-2.5 border-b border-border/60 tabular-nums';

export default function Positions({ positions = [] }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5 mb-4">
      <h3 className="text-sm font-semibold mb-4">
        Open Positions <span className="text-secondary font-normal">({positions.length})</span>
      </h3>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Side', 'Entry Price', 'Quantity', 'Stop Loss', 'Take Profit', 'Opened'].map(h => (
              <th key={h} className={TH_CLASS}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-secondary/70 py-8">ไม่มี position เปิดอยู่</td></tr>
          ) : positions.map((p, i) => (
            <tr key={i} className="hover:bg-surface-alt/60 transition-colors duration-150">
              <td className={`${TD_CLASS} font-semibold text-bull`}>
                {p.side.toUpperCase()}
              </td>
              <td className={TD_CLASS}>{p.entryPrice?.toLocaleString()}</td>
              <td className={TD_CLASS}>{p.quantity}</td>
              <td className={`${TD_CLASS} text-bear`}>{p.stopLoss?.toFixed(2)}</td>
              <td className={`${TD_CLASS} text-bull`}>{p.takeProfit?.toFixed(2)}</td>
              <td className={`${TD_CLASS} text-secondary text-[11px]`}>
                {new Date(p.openTime).toLocaleString('th-TH')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
