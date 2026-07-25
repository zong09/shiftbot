import React, { useState } from 'react';
import { login } from '../api.js';
import { LogoTile, Eye, EyeOff } from './icons.jsx';
import { DEFAULT_ACCENT } from '../theme.js';

// The only two focus-styled elements in the whole design — a 3px accent@18% ring.
const INPUT_CLASS =
  'w-full px-3.5 py-[13px] rounded-[11px] border border-border bg-surface-alt text-primary text-sm ' +
  'placeholder-secondary/60 outline-none transition-colors duration-150 focus:border-accent ' +
  'focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]';

export default function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const data = await login(username, password);
      if (data?.accessToken) {
        localStorage.setItem('token', data.accessToken);
        onLoginSuccess(data.accessToken);
      } else {
        setError('เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-dvh flex items-center justify-center p-6 text-primary"
      style={{
        '--accent': DEFAULT_ACCENT.live,
        background:
          'radial-gradient(1200px 600px at 15% -10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%), radial-gradient(1000px 500px at 110% 120%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 55%), var(--bg)',
      }}
    >
      <div className="w-full max-w-[420px] bg-surface border border-border rounded-[20px] shadow-[0_24px_60px_-30px_rgba(40,48,58,0.4)] px-[34px] py-[38px] animate-sbfade">
        <div className="flex justify-center mb-4.5">
          <LogoTile
            size={62}
            radius={17}
            iconSize={36}
            mixStop={72}
            strokeWidth={2.2}
            shadow="0 12px 26px -12px color-mix(in srgb,var(--accent) 75%,transparent)"
          />
        </div>
        <h1 className="text-center text-[26px] font-bold tracking-[-0.02em] m-0">ShiftBot Dashboard</h1>
        <p className="text-center text-sm text-secondary mt-2 mb-6.5">กรุณาเข้าสู่ระบบเพื่อจัดการระบบเทรดอัตโนมัติ</p>

        {error && (
          <div className="mb-5 px-4 py-3 bg-bear/10 border border-bear/20 text-bear text-xs rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="block text-[11px] font-semibold tracking-[0.08em] text-secondary mb-1.5">USERNAME</label>
          <input
            className={`${INPUT_CLASS} mb-4.5`}
            placeholder="กรอกชื่อผู้ใช้งาน"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />

          <label className="block text-[11px] font-semibold tracking-[0.08em] text-secondary mb-1.5">PASSWORD</label>
          <div className="relative mb-6">
            <input
              className={`${INPUT_CLASS} pr-11`}
              type={showPassword ? 'text' : 'password'}
              placeholder="กรอกรหัสผ่าน"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              tabIndex={-1}
              className="absolute right-[6px] top-1/2 -translate-y-1/2 p-2 flex text-secondary hover:text-primary transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-[11px] bg-accent text-white text-[15px] font-semibold cursor-pointer transition-all duration-150 hover:brightness-105 hover:-translate-y-px disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ boxShadow: '0 10px 22px -10px color-mix(in srgb, var(--accent) 70%, transparent)' }}
          >
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}
