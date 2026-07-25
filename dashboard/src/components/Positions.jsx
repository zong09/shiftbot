import React, { useState } from 'react';

const TH_CLASS = 'px-[10px] py-[8px] text-left text-[10px] font-semibold tracking-[0.06em] text-secondary';
const TD_CLASS = 'px-[10px] py-[11px] tabular-nums';

const signed = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

export default function Positions({ positions = [], pairs = [], onClose }) {
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

  // Unrealized PnL per row, marked against the pair's last close — the same mark price
  // PortfolioSummary aggregates. Null when that pair has no CDC result yet.
  const pnlFor = (p) => {
    const mark = pairs.find(pair => pair.symbol === p.symbol)?.lastCDC?.close ?? null;
    if (mark == null) return null;
    return (mark - p.entryPrice) * p.quantity * (p.side === 'long' ? 1 : -1);
  };

  return (
    <div className="bg-surface border border-border rounded-2xl px-[18px] py-4 mb-4 shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)]">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] m-0 mb-3">
        Open Positions <span className="text-[14px] font-medium text-secondary">({positions.length})</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px] min-w-[520px]">
          <thead>
            <tr>
              {['SYMBOL', 'SIDE', 'ENTRY', 'QTY', 'PNL', 'OPENED'].map(h => (
                <th key={h} className={TH_CLASS}>{h}</th>
              ))}
              <th className={TH_CLASS} />
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const pnl = pnlFor(p);
              return (
                <tr key={p.id} className="border-t border-border hover:bg-surface-alt transition-colors duration-[120ms]">
                  <td className={`${TD_CLASS} font-semibold text-primary`}>
                    {p.symbol?.replace(':USDT', '')}
                  </td>
                  <td className="px-[10px] py-[11px]">
                    <span className={`text-[11px] font-bold ${p.side === 'long' ? 'text-bull' : 'text-bear'}`}>
                      {p.side.toUpperCase()}
                    </span>
                  </td>
                  <td className={TD_CLASS}>{p.entryPrice?.toLocaleString()}</td>
                  <td className={TD_CLASS}>{p.quantity}</td>
                  <td className={`${TD_CLASS} font-semibold ${pnl == null ? 'text-secondary/70' : pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                    {pnl == null ? '—' : signed(pnl)}
                  </td>
                  <td className={`${TD_CLASS} text-secondary text-[11px]`}>
                    {new Date(p.openTime).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                  </td>
                  <td className="px-[10px] py-[11px]">
                    <button
                      onClick={() => handleClose(p)}
                      disabled={closingId === p.id}
                      className="rounded-[7px] border border-bear/40 text-bear px-3 py-[5px] text-[11px] font-semibold hover:bg-bear/10 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {closingId === p.id ? 'กำลังปิด...' : 'Close'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {positions.length === 0 && (
          <div className="py-[26px] text-center text-secondary text-[13px]">ไม่มีโพซิชันที่เปิดอยู่</div>
        )}
      </div>
    </div>
  );
}
