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

export default function Settings({ settings, activeMode, onModeChange, onSave }) {
  const [tab, setTab]       = useState(activeMode ?? 'live');
  const [form, setForm]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState(null); // { type: 'ok'|'err', text }

  useEffect(() => {
    if (activeMode) setTab(activeMode);
  }, [activeMode]);

  // Sync form when settings or tab changes
  useEffect(() => {
    if (settings && settings[tab]) {
      const s = settings[tab];
      setForm({
        symbol:        s.symbol        ?? 'BTC/USDT:USDT',
        timeframe:     s.timeframe     ?? '1h',
        leverage:      s.leverage      ?? 5,
        orderSizeUsdt: s.orderSizeUsdt ?? 100,
        maxPositions:  s.maxPositions  ?? 1,
        stopLossPct:   s.stopLossPct   ?? 2.0,
        takeProfitPct: s.takeProfitPct ?? 4.0,
        emaFast:       s.emaFast       ?? 12,
        emaSlow:       s.emaSlow       ?? 26,
      });
    }
  }, [settings, tab]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await onSave(tab, form);
      setMsg({ type: 'ok', text: 'บันทึกสำเร็จ' });
    } catch {
      setMsg({ type: 'err', text: 'บันทึกไม่สำเร็จ — ตรวจสอบ API' });
    } finally {
      setSaving(false);
    }
  };

  const tabStyle = (active) => ({
    padding: '6px 18px',
    borderRadius: 7,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    background: active ? '#3b82f6' : 'transparent',
    color: active ? '#fff' : '#64748b',
    transition: 'background 0.15s',
  });

  return (
    <div style={{ background: '#1e2536', borderRadius: 12, padding: 24, marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 16, marginTop: 0 }}>
        Trading Settings
      </h2>

      {/* Sub-tabs */}
      <div style={{
        display: 'flex', gap: 4, background: '#0f1117',
        borderRadius: 9, padding: 4, width: 'fit-content', marginBottom: 20,
      }}>
        <button style={tabStyle(tab === 'live')} onClick={() => { setTab('live'); onModeChange?.('live'); }}>Live</button>
        <button style={tabStyle(tab === 'sandbox')} onClick={() => { setTab('sandbox'); onModeChange?.('sandbox'); }}>Sandbox</button>
      </div>

      {!form ? (
        <div style={{ color: '#64748b', fontSize: 13 }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 24px' }}>

          <Field label="Symbol">
            <input
              type="text"
              style={FIELD_STYLE}
              value={form.symbol}
              onChange={e => set('symbol', e.target.value)}
            />
          </Field>

          <Field label="Timeframe">
            <select style={FIELD_STYLE} value={form.timeframe} onChange={e => set('timeframe', e.target.value)}>
              {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
            </select>
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
              ⚠️ เปลี่ยน Timeframe ต้องรีสตาร์ท bot เพื่อให้ cron schedule อัพเดต
            </div>
          </Field>

          <Field label="Leverage (x)">
            <input
              type="number" min={1} max={125} style={FIELD_STYLE}
              value={form.leverage}
              onChange={e => set('leverage', Number(e.target.value))}
            />
          </Field>

          <Field label="Order Size (USDT)">
            <input
              type="number" min={1} style={FIELD_STYLE}
              value={form.orderSizeUsdt}
              onChange={e => set('orderSizeUsdt', Number(e.target.value))}
            />
          </Field>

          <Field label="Max Positions">
            <input
              type="number" min={1} max={10} style={FIELD_STYLE}
              value={form.maxPositions}
              onChange={e => set('maxPositions', Number(e.target.value))}
            />
          </Field>

          <Field label="Stop Loss %">
            <input
              type="number" min={0} step={0.1} style={FIELD_STYLE}
              value={form.stopLossPct}
              onChange={e => set('stopLossPct', parseFloat(e.target.value))}
            />
          </Field>

          <Field label="Take Profit %">
            <input
              type="number" min={0} step={0.1} style={FIELD_STYLE}
              value={form.takeProfitPct}
              onChange={e => set('takeProfitPct', parseFloat(e.target.value))}
            />
          </Field>

          <Field label="EMA Fast Period">
            <input
              type="number" min={1} style={FIELD_STYLE}
              value={form.emaFast}
              onChange={e => set('emaFast', Number(e.target.value))}
            />
          </Field>

          <Field label="EMA Slow Period">
            <input
              type="number" min={1} style={FIELD_STYLE}
              value={form.emaSlow}
              onChange={e => set('emaSlow', Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {/* Save button + feedback */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving || !form}
          style={{
            background: saving ? '#334155' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: 8,
            padding: '9px 24px', cursor: saving ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700,
          }}
        >
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </button>
        {msg && (
          <span style={{ fontSize: 13, color: msg.type === 'ok' ? '#86efac' : '#fca5a5' }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
