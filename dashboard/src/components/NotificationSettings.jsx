import React, { useState, useEffect } from 'react';
import Toggle from './Toggle.jsx';
import { fetchNotificationSettings, updateNotificationSettings, sendTestNotification } from '../api.js';

const FIELD_CLASS =
  'w-full bg-surface-alt border border-border rounded-[9px] px-[12px] py-[10px] text-[13px] text-primary font-mono ' +
  'transition-colors duration-150';

const CARD_SHADOW = '0 1px 2px rgba(40,48,58,.05), 0 14px 36px -28px rgba(40,48,58,.3)';

// Provider brand colours — used for the channel cards and their switches only. Everything
// else in this card (event rows, primary button) stays on the mode accent.
const CHANNELS = [
  {
    key: 'line',
    label: 'LINE',
    brand: '#06C755',
    enabledKey: 'lineEnabled',
    lastSentKey: 'lastSentAt',
    // Secrets are write-only: the GET returns them masked, so they're never seeded into
    // form state and the mask is shown as a placeholder instead.
    secretKeys: ['lineChannelAccessToken', 'lineChannelSecret'],
    events: [
      ['notifyOpen',         'เปิดออเดอร์',  'ส่งเมื่อบอทเปิดสถานะใหม่'],
      ['notifyClose',        'ปิดออเดอร์',   'ส่งเมื่อปิดสถานะพร้อม PnL'],
      ['notifyTpSl',         'ชน TP / SL',   'แจ้งเมื่อถึงจุดทำกำไรหรือตัดขาดทุน'],
      ['notifyError',        'ข้อผิดพลาด',   'API ล้มเหลว, order ถูกปฏิเสธ'],
      ['notifyDailySummary', 'สรุปรายวัน',   'ยังไม่เปิดใช้งาน — ไม่มีตัวส่งสรุปรายวัน'],
    ],
    fields: [
      { key: 'lineWebhookUrl',         label: 'WEBHOOK URL',          placeholder: 'https://api.line.me/v2/bot/message/push', full: true },
      { key: 'lineChannelAccessToken', label: 'CHANNEL ACCESS TOKEN', placeholder: 'วาง token ของ channel', secret: true },
      { key: 'lineChannelSecret',      label: 'CHANNEL SECRET',       placeholder: 'วาง channel secret (ใช้ verify webhook)', secret: true },
      { key: 'lineGroupId',            label: 'GROUP ID',             placeholder: 'Cxxxxxxxxxxxx' },
      { key: 'lineUserId',             label: 'USER ID',              placeholder: 'Uxxxxxxxxxxxx' },
    ],
  },
  {
    key: 'telegram',
    label: 'Telegram',
    brand: '#229ED9',
    enabledKey: 'telegramEnabled',
    lastSentKey: 'telegramLastSentAt',
    secretKeys: ['telegramBotToken'],
    events: [
      ['telegramNotifyOpen',         'เปิดออเดอร์',  'ส่งเมื่อบอทเปิดสถานะใหม่'],
      ['telegramNotifyClose',        'ปิดออเดอร์',   'ส่งเมื่อปิดสถานะพร้อม PnL'],
      ['telegramNotifyTpSl',         'ชน TP / SL',   'แจ้งเมื่อถึงจุดทำกำไรหรือตัดขาดทุน'],
      ['telegramNotifyError',        'ข้อผิดพลาด',   'API ล้มเหลว, order ถูกปฏิเสธ'],
      ['telegramNotifyDailySummary', 'สรุปรายวัน',   'ยังไม่เปิดใช้งาน — ไม่มีตัวส่งสรุปรายวัน'],
    ],
    fields: [
      { key: 'telegramBotToken',        label: 'BOT TOKEN',                    placeholder: 'วาง bot token จาก @BotFather', secret: true },
      { key: 'telegramChatId',          label: 'CHAT ID',                      placeholder: '-1001234567890' },
      { key: 'telegramMessageThreadId', label: 'MESSAGE THREAD ID (ไม่บังคับ)', placeholder: 'เช่น 42 สำหรับ topic ในกลุ่ม' },
    ],
  },
];

// Every editable column, in one list — the save sends the whole row so both channels
// persist together regardless of which one is on screen.
const TEXT_KEYS = CHANNELS.flatMap(c => c.fields.map(f => f.key));
const BOOL_KEYS = CHANNELS.flatMap(c => [c.enabledKey, ...c.events.map(([key]) => key)]);
const SECRET_KEYS = CHANNELS.flatMap(c => c.secretKeys);

function CheckRow({ label, desc, checked, onToggle }) {
  return (
    <div
      onClick={onToggle}
      className="flex items-start gap-2.5 border rounded-[10px] px-[13px] py-[11px] cursor-pointer transition-colors duration-150"
      style={{
        borderColor: checked ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border)',
        background: checked ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--surface-alt)',
      }}
    >
      <span
        className="flex items-center justify-center shrink-0 rounded-[5px] border mt-[1px]"
        style={{
          width: 17, height: 17,
          borderColor: checked ? 'var(--accent)' : 'var(--border)',
          background: checked ? 'var(--accent)' : 'transparent',
        }}
      >
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: checked ? 1 : 0 }}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{label}</span>
        <span className="block text-[11px] text-secondary mt-[2px]">{desc}</span>
      </span>
    </div>
  );
}

function ChannelCard({ channel, enabled, selected, onSelect, onToggle }) {
  return (
    <div
      onClick={onSelect}
      className="flex items-center gap-3 rounded-xl px-[15px] py-[13px] cursor-pointer border transition-all duration-200"
      style={{
        borderColor: selected ? channel.brand : 'var(--border)',
        background: selected ? `color-mix(in srgb, ${channel.brand} 7%, var(--surface-alt))` : 'var(--surface-alt)',
        boxShadow: selected ? `0 6px 18px -14px ${channel.brand}` : 'none',
      }}
    >
      <span
        className="flex items-center justify-center shrink-0 rounded-[9px] text-white font-display text-[11px] font-bold"
        style={{ width: 30, height: 30, background: channel.brand, opacity: enabled ? 1 : 0.4 }}
      >
        {channel.label.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{channel.label}</span>
        <span
          className="block text-[11px] font-semibold mt-[2px]"
          style={{ color: enabled ? channel.brand : 'var(--text-secondary)' }}
        >
          {enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
        </span>
      </span>
      {/* The whole card is a click target, so the switch must not bubble into onSelect. */}
      <Toggle
        checked={enabled}
        color={channel.brand}
        onClick={e => { e.stopPropagation(); onToggle(); }}
      />
    </div>
  );
}

function formatLastSent(iso) {
  if (!iso) return 'ยังไม่เคยส่ง';
  const d = new Date(iso);
  const date = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'numeric' });
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return `ส่งสำเร็จเมื่อ ${date} ${time}`;
}

export default function NotificationSettings({ mode }) {
  const [data, setData]       = useState(null);
  const [form, setForm]       = useState(null);
  const [active, setActive]   = useState('line');
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg]         = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setMsg(null);
    setLoadError(null);
    fetchNotificationSettings(mode).then(res => {
      if (cancelled) return;
      setData(res);
      const next = {};
      for (const key of BOOL_KEYS) next[key] = !!res[key];
      // Secrets are never prefilled with the masked placeholder — an empty field means
      // "leave the stored value alone".
      for (const key of TEXT_KEYS) next[key] = SECRET_KEYS.includes(key) ? '' : (res[key] ?? '');
      setForm(next);
    }).catch(() => {
      setLoadError('โหลดการตั้งค่าแจ้งเตือนไม่สำเร็จ');
    });
    return () => { cancelled = true; };
  }, [mode]);

  if (!form) {
    if (loadError) {
      return (
        <section
          className="bg-surface border border-border rounded-2xl px-[22px] py-[20px] mb-4 max-w-[920px] mx-auto"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <p className="text-[13px] text-bear m-0">การแจ้งเตือน · {mode} — {loadError}</p>
        </section>
      );
    }
    return null;
  }

  const channel = CHANNELS.find(c => c.key === active);
  const channelEnabled = form[channel.enabledKey];
  const modeLabel = mode === 'sandbox' ? 'Sandbox Mode' : 'Live Mode';
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const payload = { ...form };
      // An empty secret keeps the stored one; an empty URL would fail @IsUrl (which only
      // skips null/undefined, not '').
      for (const key of [...SECRET_KEYS, 'lineWebhookUrl']) {
        if (!payload[key]) delete payload[key];
      }
      const res = await updateNotificationSettings(mode, payload);
      setData(res);
      setForm(f => ({ ...f, ...Object.fromEntries(SECRET_KEYS.map(k => [k, ''])) }));
      setMsg({ type: 'ok', text: 'บันทึกสำเร็จ' });
    } catch {
      setMsg({ type: 'err', text: 'บันทึกไม่สำเร็จ' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true); setMsg(null);
    try {
      const res = await sendTestNotification(mode, channel.key);
      setData(res);
      setMsg({ type: 'ok', text: `ส่งข้อความทดสอบ ${channel.label} แล้ว` });
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.message ?? 'ส่งข้อความทดสอบไม่สำเร็จ' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section
      className="bg-surface border border-border rounded-2xl px-[22px] py-[20px] mb-4 max-w-[920px] mx-auto"
      style={{ boxShadow: CARD_SHADOW }}
    >
      <div className="mb-4">
        <h2 className="text-[18px] font-semibold m-0 mb-[4px]">การแจ้งเตือน · LINE &amp; Telegram</h2>
        <p className="text-[13px] text-secondary m-0">
          เปิด/ปิดแยกกันได้ทีละช่องทาง และแยกชุดตั้งค่าตามโหมด Live / Sandbox
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-[10px] mb-[18px]">
        {CHANNELS.map(c => (
          <ChannelCard
            key={c.key}
            channel={c}
            enabled={form[c.enabledKey]}
            selected={active === c.key}
            onSelect={() => setActive(c.key)}
            onToggle={() => set(c.enabledKey, !form[c.enabledKey])}
          />
        ))}
      </div>

      {/* Dimmed but still editable when the channel is off — you configure it, then switch it on. */}
      <div style={{ opacity: channelEnabled ? 1 : 0.55, transition: 'opacity .2s' }}>
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          <span className="text-[12px] font-semibold">
            ตั้งค่า <span style={{ color: channel.brand }}>{channel.label}</span> ·{' '}
            <span className="text-accent">{modeLabel}</span>
          </span>
          <span className="text-[11px] text-secondary font-mono">
            {formatLastSent(data?.[channel.lastSentKey])}
          </span>
          {!channelEnabled && (
            <span className="text-[11px] text-secondary">
              ช่องทางนี้ถูกปิดอยู่ — การตั้งค่ายังบันทึกได้ แต่จะไม่มีการส่งข้อความ
            </span>
          )}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[14px]">
          {channel.fields.map(f => (
            <label key={f.key} className={`block ${f.full ? 'col-span-full' : ''}`}>
              <span className="block text-[11px] font-semibold tracking-[0.05em] text-secondary mb-1.5">{f.label}</span>
              <input
                type="text"
                className={FIELD_CLASS}
                placeholder={f.secret ? (data?.[f.key] ?? f.placeholder) : f.placeholder}
                value={form[f.key]}
                onChange={e => set(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>

        <div className="text-[11px] font-semibold tracking-[0.05em] text-secondary mt-[18px] mb-2.5">
          เหตุการณ์ที่จะแจ้งเตือน
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[9px]">
          {channel.events.map(([key, label, desc]) => (
            <CheckRow
              key={key}
              label={label}
              desc={desc}
              checked={form[key]}
              onToggle={() => set(key, !form[key])}
            />
          ))}
        </div>

        <div className="flex items-center gap-2.5 flex-wrap mt-[18px]">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-white rounded-[9px] px-[22px] py-[10px] text-[13px] font-semibold cursor-pointer hover:brightness-105 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึกการแจ้งเตือน'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-[18px] py-[10px] border border-border bg-surface text-primary rounded-[9px] text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? 'กำลังส่ง...' : `ส่งข้อความทดสอบ ${channel.label}`}
          </button>
          {msg && <span className={`text-[13px] ${msg.type === 'ok' ? 'text-bull' : 'text-bear'}`}>{msg.text}</span>}
        </div>
      </div>
    </section>
  );
}
