import React, { useState, useEffect } from 'react';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const FIELD_STYLE = {
  width: '100%',
  background: '#0f1117',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '8px 10px',
  fontSize: 13,
  boxSizing: 'border-box',
};

const LABEL_STYLE = {
  display: 'block',
  fontSize: 12,
  color: '#94a3b8',
  marginBottom: 4,
  fontWeight: 600,
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={LABEL_STYLE}>{label}</label>
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

  const statusColor = { on: '#22c55e', pause: '#f59e0b', off: '#ef4444' }[pair.status] ?? '#94a3b8';

  return (
    <div style={{ background: '#131929', borderRadius: 10, marginBottom: 10, overflow: 'hidden', border: '1px solid #1e2a3a' }}>
      {/* Header row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{pair.symbol.replace(':USDT', '')}</span>
          <span style={{ fontSize: 11, color: statusColor, background: statusColor + '22', borderRadius: 5, padding: '2px 8px' }}>
            {pair.status ?? 'on'}
          </span>
          <span style={{ fontSize: 11, color: '#64748b' }}>{pair.timeframe}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`ลบ ${pair.symbol.replace(':USDT', '')}?`)) onRemove(mode, pair.symbol); }}
            style={{ padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 12, background: '#450a0a', color: '#f87171' }}
          >
            ลบ
          </button>
          <span style={{ color: '#475569', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expandable settings */}
      {open && form && (
        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0 20px' }}>
            <Field label="Timeframe">
              <select style={FIELD_STYLE} value={form.timeframe} onChange={e => set('timeframe', e.target.value)}>
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </Field>
            <Field label="Leverage (x)">
              <input type="number" min={1} max={125} style={FIELD_STYLE} value={form.leverage} onChange={e => set('leverage', Number(e.target.value))} />
            </Field>
            <Field label="Order Size (USDT)">
              <input type="number" min={1} style={FIELD_STYLE} value={form.orderSizeUsdt} onChange={e => set('orderSizeUsdt', Number(e.target.value))} />
            </Field>
            <Field label="Max Positions">
              <input type="number" min={1} max={10} style={FIELD_STYLE} value={form.maxPositions} onChange={e => set('maxPositions', Number(e.target.value))} />
            </Field>
            <Field label="Stop Loss %">
              <input type="number" min={0} step={0.1} style={FIELD_STYLE} value={form.stopLossPct} onChange={e => set('stopLossPct', parseFloat(e.target.value))} />
            </Field>
            <Field label="Take Profit %">
              <input type="number" min={0} step={0.1} style={FIELD_STYLE} value={form.takeProfitPct} onChange={e => set('takeProfitPct', parseFloat(e.target.value))} />
            </Field>
            <Field label="EMA Fast">
              <input type="number" min={1} style={FIELD_STYLE} value={form.emaFast} onChange={e => set('emaFast', Number(e.target.value))} />
            </Field>
            <Field label="EMA Slow">
              <input type="number" min={1} style={FIELD_STYLE} value={form.emaSlow} onChange={e => set('emaSlow', Number(e.target.value))} />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ background: saving ? '#334155' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            {msg && <span style={{ fontSize: 13, color: msg.type === 'ok' ? '#86efac' : '#fca5a5' }}>{msg.text}</span>}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
      <input
        type="text"
        placeholder="เช่น ETH/USDT"
        value={symbol}
        onChange={e => setSymbol(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        style={{ ...FIELD_STYLE, width: 220 }}
      />
      <button
        onClick={handleAdd}
        disabled={adding || !symbol.trim()}
        style={{ background: '#22c55e', color: '#000', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: adding ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}
      >
        {adding ? '...' : '+ เพิ่ม Pair'}
      </button>
      {msg && <span style={{ fontSize: 13, color: msg.type === 'ok' ? '#86efac' : '#fca5a5' }}>{msg.text}</span>}
    </div>
  );
}

export default function Settings({ settings, activeMode, onModeChange, onSave, onAddPair, onRemovePair }) {
  const [tab, setTab] = useState(activeMode ?? 'live');

  useEffect(() => {
    if (activeMode) setTab(activeMode);
  }, [activeMode]);

  const pairs = Array.isArray(settings?.[tab]) ? settings[tab] : [];

  const tabStyle = (active) => ({
    padding: '6px 18px',
    borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
    background: active ? '#3b82f6' : 'transparent',
    color: active ? '#fff' : '#64748b',
    transition: 'background 0.15s',
  });

  return (
    <div style={{ background: '#1e2536', borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 16, marginTop: 0 }}>
        Trading Settings
      </h2>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4, background: '#0f1117', borderRadius: 9, padding: 4, width: 'fit-content', marginBottom: 20 }}>
        <button style={tabStyle(tab === 'live')} onClick={() => { setTab('live'); onModeChange?.('live'); }}>Live</button>
        <button style={tabStyle(tab === 'sandbox')} onClick={() => { setTab('sandbox'); onModeChange?.('sandbox'); }}>Sandbox</button>
      </div>

      {/* Pair list */}
      {pairs.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>ยังไม่มี pair — เพิ่มด้านล่าง</div>
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
