import React from 'react';

// Inline SVG icon set (Lucide-style) recreated from the design prototype.
// The logo is the "Signal Wave" mark (design option 2B).

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function SignalWave({ size = 23, stroke = '#fff', strokeWidth = 2.4 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 14h3l2.5 4L12 6l2.5 8 2-4H21" />
    </svg>
  );
}

// Accent-gradient rounded tile wrapping the Signal-Wave mark.
// The design uses two variants that differ in more than size: the header tile mixes the
// gradient's dark stop at 74% with a tight shadow and a 2.4-weight mark, the login tile
// mixes at 72% with a much softer shadow and a 2.2-weight mark. Defaults are the header's.
export function LogoTile({
  size = 38,
  radius = 11,
  iconSize = 23,
  mixStop = 74,
  strokeWidth = 2.4,
  shadow = '0 4px 12px -4px color-mix(in srgb,var(--accent) 55%,transparent)',
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background:
          `linear-gradient(135deg,color-mix(in srgb,var(--accent) 82%,#fff),var(--accent) 55%,color-mix(in srgb,var(--accent) ${mixStop}%,#1c2430))`,
        boxShadow: shadow,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <SignalWave size={iconSize} strokeWidth={strokeWidth} />
    </div>
  );
}

export function Eye({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOff({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" />
    </svg>
  );
}

export function Refresh({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function Sun({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function Moon({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export function Logout({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function Chevron({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
