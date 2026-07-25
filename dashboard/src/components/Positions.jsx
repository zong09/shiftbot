import React, { useState } from 'react';

const TH_CLASS = 'px-3 py-2 text-left text-[11px] uppercase tracking-wide font-medium text-secondary border-b border-border';
const TD_CLASS = 'px-3 py-2.5 border-b border-border/60 tabular-nums';

export default function Positions({ positions = [], onClose }) {
  const [closingId, setClosingId] = useState(null);

  const handleClose = async (p) => {
    if (!window.confirm(`ปิด ${p.symbol.replace(':USDT', '')} (${p.side.toUpperCase()}) ที่ตลาดทันที?`)) return;
    setClosingId(p.id);
    try {
      await onClose?.(p.id);
    } finally {
      setClosingId(null);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 mb-4 shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)]">
      <h3 className="text-sm font-semibold mb-4">
        Open Positions <span className="text-secondary font-normal">({positions.length})</span>
      </h3>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {['Symbol', 'Side', 'Entry Price', 'Quantity', 'Opened', 'Action'].map(h => (
              <th key={h} className={TH_CLASS}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-secondary/70 py-8">ไม่มี position เปิดอยู่</td></tr>
          ) : positions.map((p) => (
            <tr key={p.id} className="hover:bg-surface-alt/60 transition-colors duration-150">
              <td className={`${TD_CLASS} font-semibold text-primary`}>
                {p.symbol?.replace(':USDT', '')}
              </td>
              <td className={`${TD_CLASS} font-semibold ${p.side === 'long' ? 'text-bull' : 'text-bear'}`}>
                {p.side.toUpperCase()}
              </td>
              <td className={TD_CLASS}>{p.entryPrice?.toLocaleString()}</td>
              <td className={TD_CLASS}>{p.quantity}</td>
              <td className={`${TD_CLASS} text-secondary text-[11px]`}>
                {new Date(p.openTime).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
              </td>
              <td className={TD_CLASS}>
                <button
                  onClick={() => handleClose(p)}
                  disabled={closingId === p.id}
                  className="rounded-md border border-bear/30 text-bear px-2.5 py-1 text-[12px] font-medium hover:bg-bear/10 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {closingId === p.id ? 'กำลังปิด...' : 'Close'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
