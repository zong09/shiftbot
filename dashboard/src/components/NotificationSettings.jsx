import React, { useState, useEffect } from 'react';
import Toggle from './Toggle.jsx';
import { fetchNotificationSettings, updateNotificationSettings, sendTestNotification } from '../api.js';

const FIELD_CLASS =
  'w-full bg-surface-alt border border-border rounded-[9px] px-[12px] py-[10px] text-[13px] text-primary font-mono ' +
  'transition-colors duration-150';

const CARD_SHADOW = '0 1px 2px rgba(40,48,58,.05), 0 14px 36px -28px rgba(40,48,58,.3)';

const EVENTS = [
  { key: 'notifyOpen',         label: 'เปิดออเดอร์',   desc: 'แจ้งเตือนเมื่อเปิด position ใหม่' },
  { key: 'notifyClose',        label: 'ปิดออเดอร์',    desc: 'แจ้งเตือนเมื่อปิด position' },
  { key: 'notifyTpSl',         label: 'ชน TP/SL',      desc: 'แจ้งเตือนเมื่อโดน Take Profit หรือ Stop Loss' },
  { key: 'notifyError',        label: 'ข้อผิดพลาด',    desc: 'แจ้งเตือนเมื่อ bot พบข้อผิดพลาด' },
  { key: 'notifyDailySummary', label: 'สรุปรายวัน',    desc: 'สรุปผลการเทรดประจำวัน' },
];

const segClass = (active) =>
  `px-[15px] py-[7px] rounded-[9px] text-[12.5px] font-semibold leading-none cursor-pointer transition-all duration-150 ${
    active ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
  }`;

function CheckRow({ event, checked, onToggle }) {
  return (
    <div
      onClick={onToggle}
      className="flex items-start gap-2.5 border rounded-[10px] px-[12px] py-[11px] cursor-pointer transition-colors duration-150"
      style={{
        borderColor: checked ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : 'var(--border)',
        background: checked ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
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
      <span>
        <span className="block text-[13px] font-semibold">{event.label}</span>
        <span className="block text-[11px] text-secondary">{event.desc}</span>
      </span>
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

export default function NotificationSettings({ mode, onModeChange }) {
  const [data, setData]       = useState(null);
  const [form, setForm]       = useState(null);
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
      setForm({
        enabled: res.enabled,
        lineWebhookUrl: res.lineWebhookUrl ?? '',
        lineChannelAccessToken: '', // never prefilled with the masked placeholder
        lineChannelSecret: '',      // never prefilled with the masked placeholder
        lineGroupId: res.lineGroupId ?? '',
        lineUserId: res.lineUserId ?? '',
        notifyOpen: res.notifyOpen,
        notifyClose: res.notifyClose,
        notifyTpSl: res.notifyTpSl,
        notifyError: res.notifyError,
        notifyDailySummary: res.notifyDailySummary,
      });
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

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const payload = { ...form };
      if (!payload.lineChannelAccessToken) delete payload.lineChannelAccessToken;
      if (!payload.lineChannelSecret) delete payload.lineChannelSecret;
      const res = await updateNotificationSettings(mode, payload);
      setData(res);
      setForm(f => ({ ...f, lineChannelAccessToken: '', lineChannelSecret: '' }));
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
      const res = await sendTestNotification(mode);
      setData(res);
      setMsg({ type: 'ok', text: 'ส่งข้อความทดสอบแล้ว' });
    } catch {
      setMsg({ type: 'err', text: 'ส่งข้อความทดสอบไม่สำเร็จ' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section
      className="bg-surface border border-border rounded-2xl px-[22px] py-[20px] mb-4 max-w-[920px] mx-auto"
      style={{ boxShadow: CARD_SHADOW }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap mb-[18px]">
        <div>
          <h2 className="text-[18px] font-semibold m-0 mb-[4px]">การแจ้งเตือน LINE · Webhook</h2>
          <p className="text-[13px] text-secondary m-0">ตั้งค่าการแจ้งเตือนผ่าน LINE Messaging API แยกตามโหมด</p>
        </div>
        <div className="flex gap-[4px] p-[4px] bg-surface-alt border border-border rounded-[10px]">
          {[['live', 'Live'], ['sandbox', 'Sandbox']].map(([key, label]) => (
            <button key={key} className={segClass(mode === key)} onClick={() => onModeChange(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 bg-surface-alt border border-border rounded-xl px-[16px] py-[14px] mb-[18px]">
        <Toggle checked={form.enabled} onChange={v => set('enabled', v)} />
        <div>
          <span className="block text-[13px] font-semibold">
            แจ้งเตือนของ {mode === 'sandbox' ? 'Sandbox' : 'Live'} Mode — {form.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'}
          </span>
          <span className="block text-[11px] text-secondary font-mono">{formatLastSent(data?.lastSentAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[14px] mb-[18px]">
        <label className="block col-span-full">
          <span className="block text-[11px] font-semibold text-secondary mb-1.5">WEBHOOK URL</span>
          <input
            type="text"
            placeholder="https://api.line.me/v2/bot/message/push"
            className={FIELD_CLASS}
            value={form.lineWebhookUrl}
            onChange={e => set('lineWebhookUrl', e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-secondary mb-1.5">CHANNEL ACCESS TOKEN</span>
          <input
            type="text"
            placeholder={data?.lineChannelAccessToken ?? 'วาง token ของ channel'}
            className={FIELD_CLASS}
            value={form.lineChannelAccessToken}
            onChange={e => set('lineChannelAccessToken', e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-secondary mb-1.5">CHANNEL SECRET</span>
          <input
            type="text"
            placeholder={data?.lineChannelSecret ?? 'วาง channel secret (ใช้ verify webhook)'}
            className={FIELD_CLASS}
            value={form.lineChannelSecret}
            onChange={e => set('lineChannelSecret', e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-secondary mb-1.5">GROUP ID</span>
          <input type="text" placeholder="Cxxxxxxxxxxxx" className={FIELD_CLASS} value={form.lineGroupId} onChange={e => set('lineGroupId', e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-secondary mb-1.5">USER ID</span>
          <input type="text" placeholder="Uxxxxxxxxxxxx" className={FIELD_CLASS} value={form.lineUserId} onChange={e => set('lineUserId', e.target.value)} />
        </label>
      </div>

      <div className="mb-[18px]">
        <span className="block text-[11px] font-semibold text-secondary uppercase tracking-[0.05em] mb-2.5">เหตุการณ์ที่จะแจ้งเตือน</span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[10px]">
          {EVENTS.map(ev => (
            <CheckRow key={ev.key} event={ev} checked={form[ev.key]} onToggle={() => set(ev.key, !form[ev.key])} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
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
          className="px-[18px] py-[10px] border border-accent text-accent rounded-[9px] text-[13px] font-semibold cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? 'กำลังส่ง...' : 'ส่งข้อความทดสอบ'}
        </button>
        {msg && <span className={`text-[13px] ${msg.type === 'ok' ? 'text-bull' : 'text-bear'}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
