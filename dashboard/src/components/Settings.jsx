import React, { useState, useEffect } from 'react';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const FIELD_CLASS =
  'w-full bg-surface-alt border border-border rounded-md px-2.5 py-2 text-[13px] text-primary ' +
  'focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none transition-colors duration-150';

const STATUS_CLASS = {
  on:    'bg-bull/10 text-bull',
  pause: 'bg-warn/10 text-warn',
  off:   'bg-bear/10 text-bear',
};

function Field({ label, children }) {
  return (
    <div className="mb-3.5">
      <label className="block text-xs font-medium text-secondary mb-1">{label}</label>
      {children}
    </div>
  );
}

function PairForm({ pair, mode, onSave, onRemove }) {
  const [form, setForm]     = useState(null);
  const [open, setOpen]     = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null);

  useEffect(() => {
    setForm({
      timeframe:     pair.timeframe     ?? '1h',
      leverage:      pair.leverage      ?? 5,
      orderSizeUsdt: pair.orderSizeUsdt ?? 100,
      maxPositions:  pair.maxPositions  ?? 1,
      stopLossPct:   pair.stopLossPct   ?? 2.0,
      takeProfitPct: pair.takeProfitPct ?? 4.0,
      emaFast:       pair.emaFast       ?? 12,
      emaSlow:       pair.emaSlow       ?? 26,
    });
  }, [pair]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    // Clearing a numeric field makes Number('') === 0, which the backend rejects
    // with a raw 400 — validate here so the user gets a clear inline message.
    const numFields = ['leverage', 'orderSizeUsdt', 'maxPositions', 'stopLossPct', 'takeProfitPct', 'emaFast', 'emaSlow'];
    for (const k of numFields) {
      if (!Number.isFinite(form[k]) || form[k] <= 0) {
        setMsg({ type: 'err', text: `${k} ต้องเป็นตัวเลขมากกว่า 0` });
        return;
      }
    }
    if (form.emaFast >= form.emaSlow) {
      setMsg({ type: 'err', text: 'emaFast ต้องน้อยกว่า emaSlow' });
      return;
    }

    setSaving(true); setMsg(null);
    try {
      await onSave(mode, pair.symbol, form);
      setMsg({ type: 'ok', text: 'บันทึกสำเร็จ' });
    } catch {
      setMsg({ type: 'err', text: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface-alt border border-border rounded-lg mb-2.5 overflow-hidden">
      {/* Header row */}
      <div
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface transition-colors duration-150"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold">{pair.symbol.replace(':USDT', '')}</span>
          <span className={`text-[11px] rounded px-2 py-0.5 ${STATUS_CLASS[pair.status] ?? 'bg-surface text-secondary'}`}>
            {pair.status ?? 'on'}
          </span>
          <span className="text-[11px] text-secondary">{pair.timeframe}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`ลบ ${pair.symbol.replace(':USDT', '')}?`)) onRemove(mode, pair.symbol); }}
            className="rounded-md border border-bear/40 text-bear hover:bg-bear/10 px-2.5 py-1 text-xs cursor-pointer transition-colors duration-150"
          >
            ลบ
          </button>
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`text-secondary transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Expandable settings */}
      {open && form && (
        <div className="px-4 pb-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-5">
            <Field label="Timeframe">
              <select className={FIELD_CLASS} value={form.timeframe} onChange={e => set('timeframe', e.target.value)}>
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </Field>
            <Field label="Leverage (x)">
              <input type="number" min={1} max={125} className={FIELD_CLASS} value={form.leverage} onChange={e => set('leverage', Number(e.target.value))} />
            </Field>
            <Field label="Order Size (USDT)">
              <input type="number" min={1} className={FIELD_CLASS} value={form.orderSizeUsdt} onChange={e => set('orderSizeUsdt', Number(e.target.value))} />
            </Field>
            <Field label="Max Positions">
              <input type="number" min={1} max={1} className={FIELD_CLASS} value={form.maxPositions} onChange={e => set('maxPositions', Number(e.target.value))} />
            </Field>

            <Field label="EMA Fast">
              <input type="number" min={1} className={FIELD_CLASS} value={form.emaFast} onChange={e => set('emaFast', Number(e.target.value))} />
            </Field>
            <Field label="EMA Slow">
              <input type="number" min={1} className={FIELD_CLASS} value={form.emaSlow} onChange={e => set('emaSlow', Number(e.target.value))} />
            </Field>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-white rounded-lg px-5 py-2 text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            {msg && (
              <span className={`text-[13px] ${msg.type === 'ok' ? 'text-bull' : 'text-bear'}`}>
                {msg.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AddPairRow({ mode, onAdd }) {
  const [symbol, setSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg,    setMsg]    = useState(null);

  const handleAdd = async () => {
    let s = symbol.trim();
    if (!s) return;
    if (!s.includes(':')) s = s + ':USDT';
    setAdding(true); setMsg(null);
    try {
      await onAdd(mode, s);
      setSymbol('');
      setMsg({ type: 'ok', text: `เพิ่ม ${s.replace(':USDT', '')} สำเร็จ` });
    } catch {
      setMsg({ type: 'err', text: 'เพิ่มไม่สำเร็จ' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex items-center gap-2 mt-3">
      <input
        type="text"
        placeholder="เช่น ETH/USDT"
        value={symbol}
        onChange={e => setSymbol(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        className="w-[220px] bg-surface-alt border border-border rounded-md px-2.5 py-2 text-[13px] text-primary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none transition-colors duration-150"
      />
      <button
        onClick={handleAdd}
        disabled={adding || !symbol.trim()}
        className="bg-accent text-white rounded-lg px-4 py-2 text-[13px] font-semibold cursor-pointer hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {adding ? '...' : '+ เพิ่ม Pair'}
      </button>
      {msg && (
        <span className={`text-[13px] ${msg.type === 'ok' ? 'text-bull' : 'text-bear'}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

export default function Settings({ settings, activeMode, onModeChange, onSave, onAddPair, onRemovePair }) {
  const [tab, setTab] = useState(activeMode ?? 'live');

  useEffect(() => {
    if (activeMode) setTab(activeMode);
  }, [activeMode]);

  const pairs = Array.isArray(settings?.[tab]) ? settings[tab] : [];

  const tabClass = (active) =>
    `px-4 py-1.5 rounded-md text-[13px] font-semibold cursor-pointer transition-colors duration-150 ${
      active ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'
    }`;

  return (
    <div className="bg-surface border border-border rounded-lg p-6 mb-5">
      <h2 className="text-base font-semibold mb-4">Trading Settings</h2>

      {/* Mode tabs */}
      <div className="inline-flex items-center gap-1 bg-surface-alt rounded-lg p-1 mb-5">
        <button className={tabClass(tab === 'live')} onClick={() => { setTab('live'); onModeChange?.('live'); }}>Live</button>
        <button className={tabClass(tab === 'sandbox')} onClick={() => { setTab('sandbox'); onModeChange?.('sandbox'); }}>Sandbox</button>
      </div>

      {/* Pair list */}
      {pairs.length === 0 ? (
        <div className="text-secondary text-[13px] mb-3">ยังไม่มี pair — เพิ่มด้านล่าง</div>
      ) : (
        pairs.map(p => (
          <PairForm
            key={p.symbol}
            pair={p}
            mode={tab}
            onSave={onSave}
            onRemove={onRemovePair}
          />
        ))
      )}

      <AddPairRow mode={tab} onAdd={onAddPair} />
    </div>
  );
}
