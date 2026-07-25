import React, { useState, useEffect } from 'react';
import { useTheme } from '../ThemeContext.jsx';
import { ACCENT_PRESETS } from '../theme.js';
import { Chevron } from './icons.jsx';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const CARD_SHADOW = '0 1px 2px rgba(40,48,58,.05), 0 14px 36px -28px rgba(40,48,58,.3)';

const FIELD_CLASS =
  'w-full bg-surface-alt border border-border rounded-[9px] px-[12px] py-[10px] text-[13px] text-primary ' +
  'transition-colors duration-150';

const chipClass = (active) =>
  `px-[16px] py-[7px] rounded-[8px] text-[12.5px] font-semibold leading-none cursor-pointer transition-all duration-150 ${
    active ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-primary'
  }`;

function Section({ children }) {
  return (
    <section
      className="bg-surface border border-border rounded-2xl px-[22px] py-[20px] mb-4 max-w-[920px] mx-auto"
      style={{ boxShadow: CARD_SHADOW }}
    >
      {children}
    </section>
  );
}

function Swatch({ hex, active, onClick }) {
  return (
    <button
      type="button"
      title={hex}
      onClick={onClick}
      className="w-[34px] h-[34px] rounded-[9px] cursor-pointer transition-all duration-150"
      style={{
        background: hex,
        boxShadow: active
          ? '0 0 0 2px var(--surface), 0 0 0 4px var(--text-primary)'
          : '0 1px 3px rgba(0,0,0,.18)',
      }}
    />
  );
}

function Appearance() {
  const { theme, setTheme, accentLive, accentSandbox, setAccent, resetAppearance } = useTheme();
  const eq = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

  return (
    <Section>
      <h2 className="text-[18px] font-semibold m-0 mb-[4px]">รูปลักษณ์ · Appearance</h2>
      <p className="text-[13px] text-secondary m-0 mb-[18px]">ปรับธีมสีของแดชบอร์ด — เลือกโหมดสว่าง/มืด และสีหลักของแต่ละโหมดการเทรด</p>

      <div className="flex flex-col gap-[18px]">
        {/* Theme mode */}
        <div className="flex items-center gap-3.5 flex-wrap">
          <span className="text-[11px] font-semibold tracking-[0.07em] text-secondary uppercase min-w-[96px]">โหมดธีม</span>
          <div className="flex gap-[4px] p-[4px] bg-surface-alt border border-border rounded-[10px]">
            {[['light', 'สว่าง'], ['dark', 'มืด']].map(([key, label]) => (
              <button key={key} className={chipClass(theme === key)} onClick={() => setTheme(key)}>{label}</button>
            ))}
          </div>
        </div>

        {/* Live accent */}
        <div className="flex items-center gap-3.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.07em] text-secondary uppercase min-w-[96px]">
            <span className="w-2 h-2 rounded-full" style={{ background: '#3f9e6b' }} />สีหลัก Live
          </span>
          <div className="flex gap-2.5 flex-wrap">
            {ACCENT_PRESETS.map(h => (
              <Swatch key={h} hex={h} active={eq(accentLive, h)} onClick={() => setAccent('live', h)} />
            ))}
          </div>
        </div>

        {/* Sandbox accent */}
        <div className="flex items-center gap-3.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.07em] text-secondary uppercase min-w-[96px]">
            <span className="w-2 h-2 rounded-full" style={{ background: '#b5883f' }} />สีหลัก Sandbox
          </span>
          <div className="flex gap-2.5 flex-wrap">
            {ACCENT_PRESETS.map(h => (
              <Swatch key={h} hex={h} active={eq(accentSandbox, h)} onClick={() => setAccent('sandbox', h)} />
            ))}
          </div>
        </div>

        {/* Preview + reset */}
        <div className="flex items-center gap-3 flex-wrap pt-0.5">
          <span className="text-[11px] font-semibold tracking-[0.07em] text-secondary uppercase min-w-[96px]">พรีวิว</span>
          <div
            className="inline-flex items-center gap-2 px-[15px] py-[9px] rounded-[10px] bg-accent text-white text-[13px] font-semibold"
            style={{ boxShadow: '0 8px 18px -10px color-mix(in srgb, var(--accent) 70%, transparent)' }}
          >
            <span className="w-[7px] h-[7px] rounded-full bg-white" />สีหลักปัจจุบัน
          </div>
          <button
            onClick={resetAppearance}
            className="px-[15px] py-[9px] border border-border rounded-[10px] bg-surface text-secondary text-[12px] font-semibold cursor-pointer hover:text-accent hover:border-accent transition-colors duration-150"
          >
            รีเซ็ตเป็นค่าเริ่มต้น
          </button>
        </div>
      </div>
    </Section>
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
  const enabled = (pair.status ?? 'on') === 'on';

  const handleToggleEnable = async (e) => {
    e.stopPropagation();
    const next = enabled ? 'off' : 'on';
    if (next === 'off' && !window.confirm(`ปิด ${pair.symbol.replace(':USDT', '')}? ระบบจะปิด open positions ของคู่นี้`)) return;
    await onSave(mode, pair.symbol, { status: next });
  };

  const handleSave = async () => {
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
    <div className="border border-border rounded-[13px] overflow-hidden bg-surface-alt mb-3">
      {/* Header row */}
      <div onClick={() => setOpen(o => !o)} className="flex items-center gap-[12px] px-[16px] py-[14px] cursor-pointer">
        <span className="font-mono font-semibold text-sm min-w-[96px]">{pair.symbol.replace(':USDT', '')}</span>
        <button
          onClick={handleToggleEnable}
          className="rounded-[20px] px-[12px] py-[3px] text-[10px] font-mono font-semibold tracking-[0.05em] cursor-pointer border-none"
          style={enabled
            ? { background: 'color-mix(in srgb, var(--bull) 18%, transparent)', color: 'var(--bull)' }
            : { background: 'var(--surface-alt)', color: 'var(--text-secondary)' }}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
        <span className="text-[11px] text-secondary font-mono">{pair.timeframe}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`ลบ ${pair.symbol.replace(':USDT', '')}?`)) onRemove(mode, pair.symbol); }}
            className="rounded-md border border-bear/40 text-bear hover:bg-bear/10 px-3 py-1 text-[11px] font-semibold cursor-pointer transition-colors duration-150"
          >
            ลบ
          </button>
          <span className={`text-secondary flex transition-transform duration-200 ${open ? 'rotate-180' : ''}`}><Chevron /></span>
        </div>
      </div>

      {/* Expandable settings */}
      {open && form && (
        <div className="px-[16px] pt-[4px] pb-[18px] border-t border-border bg-surface">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px] mt-[16px]">
            <label className="block">
              <span className="block text-[11px] font-semibold text-secondary mb-1.5">Timeframe</span>
              <select className={FIELD_CLASS} value={form.timeframe} onChange={e => set('timeframe', e.target.value)}>
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-secondary mb-1.5">Leverage (x)</span>
              <input type="number" min={1} max={125} className={`${FIELD_CLASS} font-mono`} value={form.leverage} onChange={e => set('leverage', Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-secondary mb-1.5">Order Size (USDT)</span>
              <input type="number" min={1} className={`${FIELD_CLASS} font-mono`} value={form.orderSizeUsdt} onChange={e => set('orderSizeUsdt', Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-secondary mb-1.5">Max Positions</span>
              <input type="number" min={1} max={1} className={`${FIELD_CLASS} font-mono`} value={form.maxPositions} onChange={e => set('maxPositions', Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-secondary mb-1.5">EMA Fast</span>
              <input type="number" min={1} className={`${FIELD_CLASS} font-mono`} value={form.emaFast} onChange={e => set('emaFast', Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold text-secondary mb-1.5">EMA Slow</span>
              <input type="number" min={1} className={`${FIELD_CLASS} font-mono`} value={form.emaSlow} onChange={e => set('emaSlow', Number(e.target.value))} />
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-white rounded-[9px] px-[22px] py-[10px] text-[13px] font-semibold cursor-pointer hover:brightness-105 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            {msg && <span className={`text-[13px] ${msg.type === 'ok' ? 'text-bull' : 'text-bear'}`}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function AddPairRow({ mode, onAdd }) {
  const [symbol, setSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg]       = useState(null);

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
    <div className="flex items-center gap-2.5 mt-4 flex-wrap">
      <input
        type="text"
        placeholder="เช่น ETH/USDT"
        value={symbol}
        onChange={e => setSymbol(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
        className="flex-1 min-w-[200px] bg-surface-alt border border-border rounded-[10px] px-[14px] py-[11px] text-[13px] text-primary font-mono transition-colors duration-150"
      />
      <button
        onClick={handleAdd}
        disabled={adding || !symbol.trim()}
        className="inline-flex items-center gap-1.5 px-[18px] py-[11px] rounded-[10px] text-[13px] font-semibold cursor-pointer border border-accent text-accent transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}
      >
        {adding ? '...' : '+ เพิ่ม Pair'}
      </button>
      {msg && <span className={`text-[13px] ${msg.type === 'ok' ? 'text-bull' : 'text-bear'}`}>{msg.text}</span>}
    </div>
  );
}

export default function Settings({ settings, activeMode, onSave, onAddPair, onRemovePair }) {
  // The design has no mode switch in this card — the header segmented control owns it
  const tab = activeMode ?? 'live';

  const pairs = Array.isArray(settings?.[tab]) ? settings[tab] : [];
  const modeColor = tab === 'sandbox' ? '#b5883f' : '#7895b2';

  return (
    <div className="animate-sbfade">
      <Appearance />

      <Section>
        <h2 className="text-[18px] font-semibold m-0 mb-1">Trading Settings</h2>
        <p className="text-[13px] text-secondary m-0 mb-4">
          ตั้งค่ากลยุทธ์การเทรดสำหรับแต่ละคู่เหรียญของ{' '}
          <span className="font-semibold" style={{ color: modeColor }}>{tab === 'sandbox' ? 'Sandbox Mode' : 'Live Mode'}</span>
        </p>

        {pairs.length === 0 ? (
          <div className="text-secondary text-[13px] mb-3">ยังไม่มี pair — เพิ่มด้านล่าง</div>
        ) : (
          pairs.map(p => <PairForm key={p.symbol} pair={p} mode={tab} onSave={onSave} onRemove={onRemovePair} />)
        )}

        <AddPairRow mode={tab} onAdd={onAddPair} />
        <p className="text-center text-[11px] text-secondary mt-5">ระบบเชื่อมต่อ Testnet · กรุณาใช้ด้วยความระมัดระวัง</p>
      </Section>
    </div>
  );
}
