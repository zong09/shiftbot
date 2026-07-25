import React from 'react';
import ZoneBar from './ZoneBar.jsx';
import { zoneTextColor } from '../theme.js';

export const SIGNAL_CLASS = { BUY: 'text-bull', SELL: 'text-bear', HOLD: 'text-secondary' };

const STATUS_CFG = {
  on:    { className: 'bg-bull/10 text-bull border-bull/30',  label: 'Running' },
  pause: { className: 'bg-warn/10 text-warn border-warn/30',  label: 'Paused'  },
  off:   { className: 'bg-bear/10 text-bear border-bear/30',  label: 'Stopped' },
};

// Design handoff: Pause hovers only its border to accent; Stop is a permanently tinted
// destructive button with no hover state at all.
const CTRL_CLASS = {
  bull:    'border-bull/40 text-bull hover:border-accent',
  warn:    'border-warn/40 text-warn hover:border-accent',
  bear:    'border-bear/40 text-bear bg-bear/10',
  neutral: 'border-border text-primary hover:border-accent',
};

function CtrlBtn({ label, tone, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors duration-150 ${CTRL_CLASS[tone]}`}
    >
      {label}
    </button>
  );
}

// Two tile geometries in the design: the Portfolio Summary KPI tile (larger value,
// 12px radius) and the Bot Status stat tile (16px value, 10px radius).
const TILE_VARIANTS = {
  kpi: {
    wrap:  'rounded-xl px-3.5 py-[13px]',
    label: 'text-[10px] font-semibold uppercase tracking-[0.07em] text-secondary',
    body:  'mt-[7px]',
    sub:   'text-[11px] text-secondary mt-1.5',
  },
  stat: {
    wrap:  'rounded-[10px] px-3 py-[11px]',
    label: 'text-[10px] font-semibold uppercase tracking-[0.06em] text-secondary',
    body:  'mt-1.5',
    sub:   'text-[10px] text-secondary mt-[3px]',
  },
};

export function Tile({ label, children, sub, variant = 'kpi' }) {
  const v = TILE_VARIANTS[variant] ?? TILE_VARIANTS.kpi;
  return (
    <div className={`bg-surface-alt border border-border ${v.wrap}`}>
      <div className={v.label}>{label}</div>
      <div className={v.body}>{children}</div>
      {sub && <div className={v.sub}>{sub}</div>}
    </div>
  );
}

export default function StatusCard({ status, pairs = [], activeSymbol, onSymbolChange, onStatusChange }) {
  if (!status) {
    return (
      <div className="bg-surface border border-border rounded-2xl px-[18px] py-4 mb-4 shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)] text-secondary text-sm">
        กำลังโหลด...
      </div>
    );
  }
  
  const activePairStatus = status.pairs?.find(p => p.symbol === activeSymbol) || status.pairs?.[0] || status;
  const cdc = activePairStatus.lastCDC;
  const pnl = parseFloat(activePairStatus.totalPnl || 0);
  const botStatus = activePairStatus.botStatus;
  const cfg = STATUS_CFG[botStatus] ?? null;
  const zoneColor = zoneTextColor(cdc?.zone);

  const handleStop = () => {
    if (window.confirm('หยุด bot? ระบบจะปิด open positions ทั้งหมดทันที')) {
      onStatusChange?.('off');
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl px-[18px] py-4 mb-4 shadow-[0_1px_2px_rgba(40,48,58,0.05),0_14px_36px_-28px_rgba(40,48,58,0.3)]">
      <div className="flex items-center justify-between flex-wrap gap-2.5 mb-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] m-0">Bot Status</h2>
          {cfg ? (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-[20px] px-2.5 py-1 ${cfg.className}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-sbpulse" />{cfg.label}
            </span>
          ) : (
            <span className="text-xs text-secondary/60">…</span>
          )}
        </div>
        <div className="flex gap-2">
          {botStatus === 'on'    && <><CtrlBtn label="Pause"  tone="neutral" onClick={() => onStatusChange?.('pause')} /><CtrlBtn label="Stop" tone="bear" onClick={handleStop} /></>}
          {botStatus === 'pause' && <><CtrlBtn label="Resume" tone="bull" onClick={() => onStatusChange?.('on')}    /><CtrlBtn label="Stop" tone="bear" onClick={handleStop} /></>}
          {botStatus === 'off'   && <CtrlBtn label="Start"   tone="bull" onClick={() => onStatusChange?.('on')} />}
        </div>
      </div>

      {pairs.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {pairs.map(p => (
            <button
              key={p.symbol}
              onClick={() => onSymbolChange?.(p.symbol)}
              className={`rounded-full border px-3.5 py-1 text-xs font-semibold cursor-pointer transition-colors duration-150 ${
                activeSymbol === p.symbol
                  ? 'border-accent text-accent bg-accent/5'
                  : 'border-border text-secondary hover:text-primary hover:bg-surface-alt'
              }`}
            >
              {p.symbol.replace(':USDT', '')}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-[9px] mb-4">
        <Tile variant="stat" label="Signal" sub="CDC ActionZone">
          <div className={`text-[16px] font-mono font-semibold leading-none ${SIGNAL_CLASS[cdc?.signal] ?? 'text-primary'}`}>
            {cdc?.signal ?? '—'}
          </div>
        </Tile>
        <Tile variant="stat" label="CDC Zone" sub={cdc?.zoneName}>
          <div className="text-[16px] font-mono font-semibold leading-none" style={zoneColor ? { color: zoneColor } : undefined}>
            Zone {cdc?.zone ?? '—'}
          </div>
        </Tile>
        <Tile variant="stat" label="EMA 12" sub="fast">
          <div className="text-[16px] font-semibold leading-none tabular-nums">{cdc ? Number(cdc.emaFast).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</div>
        </Tile>
        <Tile variant="stat" label="EMA 26" sub="slow">
          <div className="text-[16px] font-semibold leading-none tabular-nums">{cdc ? Number(cdc.emaSlow).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</div>
        </Tile>
        <Tile variant="stat" label="Close" sub="last price">
          <div className="text-[16px] font-semibold leading-none tabular-nums">{cdc?.close != null ? Number(cdc.close).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</div>
        </Tile>
        <Tile variant="stat" label="Total PnL" sub="USDT">
          <div className={`text-[16px] font-semibold leading-none tabular-nums ${pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
          </div>
        </Tile>
      </div>

      <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-secondary mb-2">CDC Zone Bar</div>
      <ZoneBar currentZone={cdc?.zone} />
    </div>
  );
}
