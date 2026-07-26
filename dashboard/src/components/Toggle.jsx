import React from 'react';

export default function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        width: 46,
        height: 26,
        borderRadius: 13,
        padding: 3,
        background: checked ? 'var(--accent)' : 'var(--surface-alt)',
        border: checked ? 'none' : '1px solid var(--border)',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        transition: 'background .2s, border-color .2s',
      }}
    >
      <span
        className="rounded-full bg-white"
        style={{ width: 20, height: 20, boxShadow: '0 1px 3px rgba(0,0,0,.25)' }}
      />
    </button>
  );
}
