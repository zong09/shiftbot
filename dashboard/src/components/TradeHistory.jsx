import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useTheme } from '../ThemeContext.jsx';

const TH_CLASS = 'px-[10px] py-[8px] text-left text-[10px] font-semibold tracking-[0.06em] text-secondary';
const TD_CLASS = 'px-[10px] py-[10px] tabular-nums';
// The Zone cell is the one body cell the design leaves in the body font, not mono.
const TD_PLAIN = 'px-[10px] py-[10px]';

const ACTION_LABEL = {
  OPEN_LONG:   { label: 'Open Long',   className: 'text-bull' },
  CLOSE_LONG:  { label: 'Close Long',  className: 'text-accent' },
  SL_HIT:      { label: 'Stop Loss',   className: 'text-bear' },
  TP_HIT:      { label: 'Take Profit', className: 'text-bull' },
  OPEN_SHORT:  { label: 'Open Short',  className: 'text-warn' },
  CLOSE_SHORT: { label: 'Close Short', className: 'text-accent' },
  SYNC_CLOSE:  { label: 'Sync Close',  className: 'text-secondary' },
};

export default function TradeHistory({ trades = [] }) {
  const { colors } = useTheme();

  // เรียงเก่าไปใหม่ สำหรับกราฟ (ซ้ายไปขวา)
  const chartTrades = [...trades].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  // เรียงใหม่ไปเก่า สำหรับตาราง (บนลงล่าง)
  const tableTrades = [...trades].sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));

  // สร้าง PnL chart data จาก closed trades
  const pnlData = chartTrades
    .filter(t => t.pnl != null)
    .map((t, i) => ({ name: `#${i + 1}`, pnl: parseFloat(t.pnl.toFixed(2)) }));

  return (
    <div className="bg-surface border border-border rounded-2xl px-[18px] py-[16px] mb-4 shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)]">
      <div className="flex items-center justify-between mb-[14px]">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] m-0">
          Trade History <span className="text-[14px] font-medium text-secondary">({trades.length})</span>
        </h2>
      </div>

      {pnlData.length > 0 && (
        <div className="h-[120px] mb-[14px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pnlData} barSize={14}>
              <XAxis dataKey="name" tick={{ fill: colors.textSecondary, fontSize: 10 }} />
              <YAxis tick={{ fill: colors.textSecondary, fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: colors.surfaceAlt,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                }}
                labelStyle={{ color: colors.textPrimary }}
                formatter={v => [`${v > 0 ? '+' : ''}${v} USDT`, 'PnL']}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                {pnlData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? colors.bull : colors.bear} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px] min-w-[640px]">
        <thead>
          <tr>
            {['Symbol', 'Action', 'Price', 'Qty', 'Zone', 'PnL', 'Time'].map(h => (
              <th key={h} className={TH_CLASS}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableTrades.length === 0 ? (
            <tr><td colSpan={7} className="text-center text-secondary/70 py-8">ยังไม่มี trade</td></tr>
          ) : tableTrades.map((t, i) => {
            const meta = ACTION_LABEL[t.action] ?? { label: t.action, className: 'text-primary' };
            const hasPnl = t.pnl != null;
            return (
              <tr key={i} className="border-t border-border hover:bg-surface-alt/60 transition-colors duration-[120ms]">
                <td className={`${TD_CLASS} font-semibold text-primary`}>{t.symbol?.replace(':USDT', '')}</td>
                <td className={`${TD_CLASS} font-semibold ${meta.className}`}>{meta.label}</td>
                <td className={TD_CLASS}>{t.price?.toLocaleString()}</td>
                <td className={TD_CLASS}>{t.quantity}</td>
                <td className={`${TD_PLAIN} text-[11px] text-secondary`}>Zone {t.zone}</td>
                <td className={`${TD_CLASS} ${hasPnl ? (t.pnl >= 0 ? 'text-bull font-semibold' : 'text-bear font-semibold') : 'text-secondary/70'}`}>
                  {hasPnl ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USDT` : '—'}
                </td>
                <td className={`${TD_CLASS} text-secondary text-[11px]`}>
                  {new Date(t.timestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
