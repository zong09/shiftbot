import React from 'react';
import { zoneBadgeStyle } from '../theme.js';
import { SIGNAL_CLASS, Tile } from './StatusCard.jsx';

const signed = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

export default function PortfolioSummary({ pairs = [], trades = [], balance, activeSymbol, onSymbolChange }) {
  if (!pairs.length) return null;

  const closed  = trades.filter(t => t.pnl != null);
  const wins    = closed.filter(t => t.pnl > 0);
  const losses  = closed.filter(t => t.pnl < 0);
  const profit  = wins.reduce((s, t) => s + t.pnl, 0);
  const loss    = losses.reduce((s, t) => s + t.pnl, 0);
  const net     = profit + loss;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : null;

  const openPositions = pairs.flatMap(p =>
    (p.openPositions ?? []).map(pos => ({ ...pos, markPrice: p.lastCDC?.close ?? null })),
  );
  const unrealized = openPositions.length
    ? openPositions.reduce((s, pos) => {
        if (pos.markPrice == null) return s;
        const dir = pos.side === 'long' ? 1 : -1;
        return s + (pos.markPrice - pos.entryPrice) * pos.quantity * dir;
      }, 0)
    : null;

  let unrealizedClass = 'text-primary';
  if (unrealized != null) unrealizedClass = unrealized >= 0 ? 'text-bull' : 'text-bear';

  return (
    <div className="bg-surface border border-border rounded-2xl px-5 py-[18px] shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)]">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] m-0">Portfolio Summary</h2>
        <span className="text-xs text-secondary tabular-nums">{pairs.length} pairs</span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5 mb-3">
        <Tile label="Net PnL">
          <div className={`text-2xl font-semibold tracking-[-0.01em] leading-none tabular-nums ${net >= 0 ? 'text-bull' : 'text-bear'}`}>
            {signed(net)} <span className="text-[11px] text-secondary font-normal">USDT</span>
          </div>
        </Tile>
        <Tile label="Profit" sub={`${wins.length} ไม้กำไร`}>
          <div className="text-2xl font-semibold tracking-[-0.01em] leading-none tabular-nums text-bull">{signed(profit)}</div>
        </Tile>
        <Tile label="Loss" sub={`${losses.length} ไม้ขาดทุน`}>
          <div className="text-2xl font-semibold tracking-[-0.01em] leading-none tabular-nums text-bear">{loss.toFixed(2)}</div>
        </Tile>
        <Tile label="Win Rate" sub={closed.length ? `W ${wins.length} · L ${losses.length}` : undefined}>
          <div className="text-2xl font-semibold tracking-[-0.01em] leading-none tabular-nums">
            {winRate != null ? `${winRate.toFixed(0)}%` : '—'}
          </div>
        </Tile>
        <Tile label="Unrealized" sub={openPositions.length ? `${openPositions.length} positions` : undefined}>
          <div className={`text-2xl font-semibold tracking-[-0.01em] leading-none tabular-nums ${unrealizedClass}`}>
            {unrealized != null ? signed(unrealized) : '—'}
          </div>
        </Tile>
      </div>

      {/* Balance row — baseline-aligned label/value pairs, not stacked tiles */}
      {balance && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5 mb-3.5">
          {[
            { label: 'Balance',   value: balance.total },
            { label: 'Available', value: balance.free  },
            { label: 'In Use',    value: balance.used  },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-baseline justify-between bg-surface-alt border border-border rounded-xl px-4 py-3.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-secondary">{label}</span>
              <span className="text-[19px] font-semibold tabular-nums">
                {value > 0 ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}{' '}
                <span className="text-[11px] text-secondary font-normal">USDT</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {pairs.map(p => {
          const cdc      = p.lastCDC;
          const badge    = zoneBadgeStyle(cdc?.zone);
          const pnl      = Number.parseFloat(p.totalPnl || 0);
          const active   = p.symbol === activeSymbol;
          const posCount = p.openPositions?.length ?? 0;
          const posSide  = posCount ? p.openPositions[0].side : null;
          const pairClosed = closed.filter(t => t.symbol === p.symbol);
          const pairWins   = pairClosed.filter(t => t.pnl > 0).length;
          const pairLosses = pairClosed.filter(t => t.pnl < 0).length;

          let posClass = 'text-secondary/60';
          if (posCount) posClass = posSide === 'long' ? 'text-bull font-semibold' : 'text-bear font-semibold';

          return (
            <button
              key={p.symbol}
              onClick={() => onSymbolChange?.(p.symbol)}
              className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 text-left bg-surface-alt border rounded-[11px] px-3.5 py-[11px] cursor-pointer transition-colors duration-150 ${
                active ? 'border-accent' : 'border-border hover:border-accent/40'
              }`}
            >
              <span className="font-semibold text-[13px] min-w-[88px] tabular-nums">
                {p.symbol.replace(':USDT', '')}
                <span className="text-[11px] text-secondary font-normal ml-1.5">{p.timeframe}</span>
              </span>

              <span
                className={`inline-flex items-center text-[11px] font-semibold rounded-md px-[9px] py-[3px] min-w-[110px] justify-center ${
                  badge ? '' : 'bg-border text-secondary'
                }`}
                style={badge}
              >
                {cdc ? `Z${cdc.zone} · ${cdc.zoneName}` : 'รอข้อมูล'}
              </span>

              <span className={`text-xs font-semibold min-w-[38px] ${SIGNAL_CLASS[cdc?.signal] ?? 'text-secondary'}`}>
                {cdc?.signal ?? '—'}
              </span>

              <span className={`text-xs min-w-[62px] ${posClass}`}>
                {posCount ? `${posCount} ${posSide.toUpperCase()}` : '—'}
              </span>

              <span className="text-[11px] text-secondary tabular-nums">
                W {pairWins} · L {pairLosses}
              </span>

              <span className={`ml-auto text-sm font-semibold tabular-nums ${pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
                {signed(pnl)} <span className="text-[10px] text-secondary font-normal">USDT</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
