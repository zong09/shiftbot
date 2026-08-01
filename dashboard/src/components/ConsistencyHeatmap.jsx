import React, { useMemo, useState } from 'react';
import { buildHeatmap } from '../heatmap.js';

// Activity ramp — the design writes these against --surface-2; this repo's token is --surface-alt.
const SHADES = [
  'var(--surface-alt)',
  'color-mix(in srgb, var(--accent) 22%, var(--surface-alt))',
  'color-mix(in srgb, var(--accent) 45%, var(--surface-alt))',
  'color-mix(in srgb, var(--accent) 72%, var(--surface-alt))',
  'var(--accent)',
];

const LEVEL_LABEL = ['ไม่มีการเทรด', 'เบาบาง', 'ปกติ', 'คึกคัก', 'หนาแน่นมาก'];

const CELL_BORDER = '1px solid color-mix(in srgb, var(--border) 70%, transparent)';

const signed = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

function TipRow({ label, children }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-secondary">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function ConsistencyHeatmap({ trades = [] }) {
  // App swaps `trades` on every 30s poll — don't re-bucket 365 days on unrelated renders.
  const heat = useMemo(() => buildHeatmap(trades), [trades]);
  // Hover lives here, not in App: one of ~371 cells must not re-render the chart and both tables.
  const [hover, setHover] = useState(null);

  const cell = hover != null ? heat.cells[hover.i] : null;

  return (
    <div className="bg-surface border border-border rounded-2xl px-[18px] py-4 shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)]">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3.5">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] m-0">
          Consistency <span className="text-[14px] font-medium text-secondary">— กิจกรรมการเทรดรายวัน</span>
        </h2>
        <span className="text-[11px] text-secondary tabular-nums">last 12 months</span>
      </div>

      <div className="overflow-x-auto pb-0.5">
        {/* hover ขยายช่อง 1.3x — ถ้าไม่เผื่อที่ขวา/ล่าง ส่วนที่ล้นจะกลายเป็น scrollable overflow
            แล้ว overflow-x-auto (ซึ่งดัน overflow-y จาก visible เป็น auto ไปด้วย) จะโชว์ scrollbar
            ทุกครั้งที่ hover  4px ครอบคลุมส่วนล้นที่กว้างสุด: 0.15 x ช่อง ~21px ของการ์ดที่ 1284px */}
        <div className="min-w-[860px] pr-1 pb-1">
          <div
            className="grid gap-[3px] mb-[6px]"
            style={{ gridTemplateColumns: `repeat(${heat.cols}, 1fr)` }}
          >
            {heat.months.map(m => (
              <span
                key={m.col}
                className="text-[10px] font-semibold tracking-[0.08em] text-secondary tabular-nums"
                style={{ gridColumn: m.col }}
              >
                {m.label}
              </span>
            ))}
          </div>

          <div
            className="grid gap-[3px]"
            style={{
              gridAutoFlow: 'column',
              gridTemplateRows: 'repeat(7, 1fr)',
              gridTemplateColumns: `repeat(${heat.cols}, 1fr)`,
            }}
          >
            {heat.cells.map((c, i) => {
              const active = hover?.i === i;
              return (
                <div
                  key={c.key}
                  className={`w-full aspect-square rounded-[4px] transition-transform duration-[120ms] ${c.future ? 'cursor-default' : 'cursor-pointer'}`}
                  style={{
                    background: c.future ? 'transparent' : SHADES[c.level],
                    border: c.future ? '1px solid transparent' : CELL_BORDER,
                    ...(active && {
                      transform: 'scale(1.3)',
                      position: 'relative',
                      zIndex: 3,
                      boxShadow: '0 0 0 1.5px var(--accent)',
                    }),
                  }}
                  onMouseEnter={c.future ? undefined : (e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setHover({ i, x: r.left + r.width / 2, y: r.top });
                  }}
                  onMouseLeave={c.future ? undefined : () => setHover(null)}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2.5 mt-3">
        <span className="text-[11.5px] text-secondary">
          {heat.activeDays} วันที่มีการเทรด จาก {heat.totalDays} วัน · สตรีคยาวสุด {heat.bestStreak} วัน
        </span>
        <div className="flex items-center gap-[5px]">
          <span className="text-[10.5px] text-secondary">น้อย</span>
          {SHADES.map((s, i) => (
            <span
              key={i}
              className="w-[11px] h-[11px] rounded-[3px]"
              style={{ background: s, border: CELL_BORDER }}
            />
          ))}
          <span className="text-[10.5px] text-secondary">มาก</span>
        </div>
      </div>

      {/* fixed, not absolute — the grid sits inside a horizontal scroller */}
      {cell && (
        <div
          className="fixed z-50 pointer-events-none min-w-[186px] px-[13px] py-[11px] rounded-[11px] bg-surface border border-border shadow-[0_18px_40px_-16px_rgba(20,24,30,0.45)] animate-sbfade"
          style={{ left: hover.x, top: hover.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="flex items-baseline justify-between gap-2.5 mb-2 pb-[7px] border-b border-border">
            <span className="text-[12.5px] font-semibold tabular-nums">{cell.date}</span>
            <span className="text-[10.5px] text-secondary">{cell.dow}</span>
          </div>
          <div className="flex flex-col gap-[5px] text-[11.5px]">
            <TipRow label="จำนวนเทรด">
              <span className="font-semibold tabular-nums">{cell.trades ? `${cell.trades} รายการ` : '—'}</span>
            </TipRow>
            <TipRow label="PnL">
              <span className={`font-semibold tabular-nums ${cell.trades ? (cell.pnl >= 0 ? 'text-bull' : 'text-bear') : 'text-secondary'}`}>
                {cell.trades ? `${signed(cell.pnl)} USDT` : '—'}
              </span>
            </TipRow>
            <TipRow label="Win / Loss">
              {cell.trades ? (
                <span className="tabular-nums">
                  {cell.wins}W / {cell.losses}L{' '}
                  <span className="text-secondary">· {Math.round((cell.wins / cell.trades) * 100)}%</span>
                </span>
              ) : (
                <span className="tabular-nums">—</span>
              )}
            </TipRow>
            <div className="flex justify-between gap-3 mt-0.5 pt-1.5 border-t border-dashed border-border">
              <span className="text-secondary">ระดับกิจกรรม</span>
              <span className={`font-semibold ${cell.level === 0 ? 'text-secondary' : 'text-accent'}`}>
                {LEVEL_LABEL[cell.level]}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
