import React, { useEffect, useState } from 'react';

// Design defaults (prototype: manual:{…size:'12',lev:'5'})
const DEFAULTS = { side: 'LONG', size: '12', lev: '5' };

const INPUT_CLASS =
  'w-full px-3 py-[11px] rounded-[9px] border border-border bg-surface-alt text-primary text-[13px] font-mono';
const LABEL_CLASS =
  'block text-[11px] font-semibold tracking-[0.05em] text-secondary mb-1.5';

const nfmt = (v, d) =>
  v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * "เปิด Position เอง" — open a position without waiting for a CDC signal.
 *
 * Market orders only: the design also draws a Limit chip, but a resting limit order
 * has no position row on the exchange and the backend has no pending-order state,
 * so the chip renders disabled rather than lying about what submit does.
 *
 * The bot manages the resulting position exactly like its own (SL/TP come from the
 * pair's settings, a CDC flip closes it), which is what the note below says.
 */
export default function ManualEntryDialog({ open, mode, pairs = [], onClose, onSubmit }) {
  const [side, setSide] = useState(DEFAULTS.side);
  const [sym, setSym] = useState('');
  const [size, setSize] = useState(DEFAULTS.size);
  const [lev, setLev] = useState(DEFAULTS.lev);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset to the design defaults each time it opens, so a cancelled attempt doesn't
  // leak its numbers into the next one.
  useEffect(() => {
    if (!open) return;
    setSide(DEFAULTS.side);
    setSym(pairs[0]?.symbol ?? '');
    setSize(DEFAULTS.size);
    setLev(DEFAULTS.lev);
    setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const pair = pairs.find(p => p.symbol === sym);
  // Market order: the price shown is the pair's last close. The server re-reads the
  // live ticker when the order is submitted — this is a preview, not the entry price.
  const last = pair?.lastCDC?.close ?? 0;
  const sizeNum = parseFloat(size) || 0;
  const levNum = parseFloat(lev) || 0;
  const notional = sizeNum * levNum;
  const qty = last > 0 ? notional / last : 0;
  const valid = last > 0 && sizeNum > 0 && levNum > 0 && !!sym;
  const sideColor = side === 'LONG' ? 'var(--bull)' : 'var(--bear)';

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit?.({
        mode,
        symbol: sym,
        side: side.toLowerCase(),
        orderSizeUsdt: sizeNum,
        leverage: levNum,
      });
      onClose?.();
    } catch (err) {
      // The API's own Thai message is the useful one (404 unknown pair, 409 at the
      // position cap, 400 below min notional) — show it instead of a generic failure.
      setError(err?.response?.data?.message ?? err?.message ?? 'เปิด position ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-auto p-6"
      style={{ background: 'color-mix(in srgb, #151a20 58%, transparent)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-[460px] m-auto bg-surface border border-border rounded-2xl pt-5 px-[22px] pb-[22px] shadow-[0_30px_70px_-30px_rgba(20,24,30,0.6)] animate-sbfade"
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h3 className="m-0 font-display text-[17px] font-semibold">เปิด Position เอง</h3>
            <p className="mt-1 mb-0 text-[12px] text-secondary">
              สั่งเปิดสถานะด้วยตนเอง โดยไม่รอสัญญาณจากบอท ·{' '}
              <span className="font-semibold text-accent">
                {mode === 'live' ? 'Live' : 'Sandbox'} Mode
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="flex-none w-[30px] h-[30px] flex items-center justify-center rounded-lg border border-border bg-surface text-secondary cursor-pointer hover:border-bear hover:text-bear transition-colors duration-150"
          >
            ✕
          </button>
        </div>

        {/* Side selector */}
        <div className="flex gap-1.5 mb-3.5">
          {['LONG', 'SHORT'].map(s => {
            const on = side === s;
            const color = s === 'LONG' ? 'var(--bull)' : 'var(--bear)';
            return (
              <button
                key={s}
                onClick={() => setSide(s)}
                className="flex-1 px-2.5 py-[11px] rounded-[10px] font-display text-[13px] font-bold tracking-[0.03em] cursor-pointer transition-all duration-150 border"
                style={
                  on
                    ? { borderColor: 'transparent', background: color, color: '#fff', boxShadow: `0 8px 18px -12px ${color}` }
                    : { borderColor: 'var(--border)', background: 'var(--surface-alt)', color: 'var(--text-secondary)' }
                }
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={LABEL_CLASS} htmlFor="manual-symbol">SYMBOL</label>
            <select id="manual-symbol" className={INPUT_CLASS} value={sym} onChange={e => setSym(e.target.value)}>
              {pairs.map(p => (
                <option key={p.symbol} value={p.symbol}>{p.symbol.replace(':USDT', '')}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <span className={LABEL_CLASS}>ประเภทออเดอร์</span>
            <div className="flex gap-1 p-1 bg-surface-alt border border-border rounded-[10px]">
              <span className="flex-1 px-4 py-[7px] rounded-lg text-[12.5px] font-semibold text-center bg-surface text-primary shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                Market
              </span>
              {/* Limit is drawn by the design but not supported by the API yet */}
              <span
                title="ยังไม่รองรับ limit order — ใช้ market เท่านั้น"
                className="flex-1 px-4 py-[7px] rounded-lg text-[12.5px] font-semibold text-center text-secondary opacity-45 cursor-not-allowed"
              >
                Limit
              </span>
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="manual-size">ORDER SIZE (USDT)</label>
            <input id="manual-size" className={INPUT_CLASS} value={size} placeholder="12"
                   inputMode="decimal" onChange={e => setSize(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="manual-lev">LEVERAGE (x)</label>
            <input id="manual-lev" className={INPUT_CLASS} value={lev} placeholder="5"
                   inputMode="numeric" onChange={e => setLev(e.target.value)} />
          </div>

          <div className="col-span-2">
            <label className={LABEL_CLASS} htmlFor="manual-price">ราคาตลาดปัจจุบัน (USDT)</label>
            <input id="manual-price" className={`${INPUT_CLASS} opacity-60 cursor-not-allowed`} disabled
                   value={last > 0 ? nfmt(last, 1) : '—'} />
          </div>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap justify-between gap-3 mt-4 mb-1 px-3.5 py-3 rounded-[11px] bg-surface-alt border border-border">
          <span className="text-[11.5px] text-secondary">
            มูลค่าสัญญา <b className="font-mono font-semibold text-primary">{nfmt(notional, 2)}</b> USDT
          </span>
          <span className="text-[11.5px] text-secondary">
            ปริมาณประมาณ{' '}
            <b className="font-mono font-semibold text-primary">
              {qty > 0 ? `${qty < 1 ? qty.toFixed(4) : qty.toFixed(2)} ${sym.split('/')[0]}` : '—'}
            </b>
          </span>
        </div>
        <p className="mt-0 mb-3.5 text-[11px] text-secondary">
          ส่งเป็น market order ทันทีที่ราคาปัจจุบัน — บอทจะดูแลสถานะนี้ต่อตามสัญญาณ CDC
        </p>

        {error && (
          <p className="mt-0 mb-3 text-[12px] text-bear">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-none px-[18px] py-[11px] rounded-[10px] border border-border bg-surface text-secondary text-[13px] font-semibold cursor-pointer hover:border-secondary transition-colors duration-150"
          >
            ยกเลิก
          </button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            className="flex-1 px-[18px] py-[11px] rounded-[10px] border-none text-white text-[13.5px] font-semibold"
            style={{
              background: sideColor,
              boxShadow: `0 10px 22px -12px color-mix(in srgb, ${sideColor} 80%, transparent)`,
              ...(valid && !submitting
                ? { cursor: 'pointer' }
                : { opacity: 0.45, cursor: 'not-allowed' }),
            }}
          >
            {submitting ? 'กำลังส่งออเดอร์...' : `เปิด ${side} ${sym.replace(':USDT', '')}`}
          </button>
        </div>
      </div>
    </div>
  );
}
