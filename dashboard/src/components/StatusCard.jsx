import React from 'react';
import ZoneBar from './ZoneBar.jsx';
import { zoneByNumber } from '../theme.js';

export const SIGNAL_CLASS = { BUY: 'text-bull', SELL: 'text-bear', HOLD: 'text-secondary' };

const STATUS_CFG = {
  on:    { className: 'bg-bull/10 text-bull border-bull/30',  label: 'Running' },
  pause: { className: 'bg-warn/10 text-warn border-warn/30',  label: 'Paused'  },
  off:   { className: 'bg-bear/10 text-bear border-bear/30',  label: 'Stopped' },
};

const CTRL_CLASS = {
  bull: 'border-bull/40 text-bull hover:bg-bull/10',
  warn: 'border-warn/40 text-warn hover:bg-warn/10',
  bear: 'border-bear/40 text-bear hover:bg-bear/10',
};

function CtrlBtn({ label, tone, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs font-semibold cursor-pointer transition-colors duration-150 ${CTRL_CLASS[tone]}`}
    >
      {label}
    </button>
  );
}

export function Tile({ label, children, sub }) {
  return (
    <div className="bg-surface-alt border border-border rounded-lg p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-secondary mb-1">{label}</div>
      {children}
      {sub && <div className="text-[11px] text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

export default function StatusCard({ status, pairs = [], activeSymbol, onSymbolChange, onStatusChange }) {
  if (!status) {
    return (
      <div className="bg-surface border border-border rounded-lg p-5 mb-4 text-secondary text-sm">
        กำลังโหลด...
      </div>
    );
  }
  
  const activePairStatus = status.pairs?.find(p => p.symbol === activeSymbol) || status.pairs?.[0] || status;
  const cdc = activePairStatus.lastCDC;
  const pnl = parseFloat(activePairStatus.totalPnl || 0);
  const botStatus = activePairStatus.botStatus;
  const cfg = STATUS_CFG[botStatus] ?? null;
  const zoneColor = zoneByNumber(cdc?.zone)?.color;

  const handleStop = () => {
    if (window.confirm('หยุด bot? ระบบจะปิด open positions ทั้งหมดทันที')) {
      onStatusChange?.('off');
    }
  };

  return (
    <div className="bg-surface border border-border rounded-lg p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold m-0">Bot Status</h2>
          {cfg ? (
            <span className={`text-xs border rounded-md px-2.5 py-0.5 ${cfg.className}`}>
              {cfg.label}
            </span>
          ) : (
            <span className="text-xs text-secondary/60">…</span>
          )}
          <div className="flex gap-1.5">
            {botStatus === 'on'    && <><CtrlBtn label="Pause"  tone="warn" onClick={() => onStatusChange?.('pause')} /><CtrlBtn label="Stop" tone="bear" onClick={handleStop} /></>}
            {botStatus === 'pause' && <><CtrlBtn label="Resume" tone="bull" onClick={() => onStatusChange?.('on')}    /><CtrlBtn label="Stop" tone="bear" onClick={handleStop} /></>}
            {botStatus === 'off'   && <CtrlBtn label="Start"   tone="bull" onClick={() => onStatusChange?.('on')} />}
          </div>
        </div>
        <div className="text-xs text-secondary">
          {activePairStatus.symbol?.replace(':USDT', '')} · {activePairStatus.timeframe}
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Tile label="Signal">
          <div className={`text-lg font-semibold ${SIGNAL_CLASS[cdc?.signal] ?? 'text-primary'}`}>
            {cdc?.signal ?? '—'}
          </div>
        </Tile>
        <Tile label="CDC Zone" sub={cdc?.zoneName}>
          <div className="text-lg font-semibold" style={zoneColor ? { color: zoneColor } : undefined}>
            Zone {cdc?.zone ?? '—'}
          </div>
        </Tile>
        <Tile label="EMA 12">
          <div className="text-lg font-semibold tabular-nums">{cdc ? parseFloat(cdc.emaFast).toFixed(2) : '—'}</div>
        </Tile>
        <Tile label="EMA 26">
          <div className="text-lg font-semibold tabular-nums">{cdc ? parseFloat(cdc.emaSlow).toFixed(2) : '—'}</div>
        </Tile>
        <Tile label="Close Price">
          <div className="text-lg font-semibold tabular-nums">{cdc?.close?.toLocaleString() ?? '—'}</div>
        </Tile>
        <Tile label="Total PnL">
          <div className={`text-lg font-semibold tabular-nums ${pnl >= 0 ? 'text-bull' : 'text-bear'}`}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
          </div>
        </Tile>
      </div>

      {/* Balance row */}
      {status.balance && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: 'Balance',   value: status.balance.total },
            { label: 'Available', value: status.balance.free  },
            { label: 'In Use',    value: status.balance.used  },
          ].map(({ label, value }) => (
            <Tile key={label} label={label}>
              <div className="text-base font-semibold tabular-nums">
                {value > 0 ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}{' '}
                <span className="text-[11px] text-secondary font-normal">USDT</span>
              </div>
            </Tile>
          ))}
        </div>
      )}

      <div className="text-[11px] uppercase tracking-wide text-secondary mb-1.5">CDC Zone Bar</div>
      <ZoneBar currentZone={cdc?.zone} />
    </div>
  );
}
