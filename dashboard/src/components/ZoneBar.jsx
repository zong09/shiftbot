import React from 'react';

const ZONES = [
  { zone: 1, name: 'Strong Bull',    color: '#00FF00', textColor: '#000' },
  { zone: 2, name: 'Bull',           color: '#008000', textColor: '#fff' },
  { zone: 3, name: 'Weak Bull',      color: '#808000', textColor: '#fff' },
  { zone: 4, name: 'Caution Bull',   color: '#006400', textColor: '#fff' },
  { zone: 5, name: 'Weak Bear',      color: '#FFA500', textColor: '#000' },
  { zone: 6, name: 'Bear',           color: '#FF4500', textColor: '#fff' },
  { zone: 7, name: 'Strong Bear (w)',color: '#FF0000', textColor: '#fff' },
  { zone: 8, name: 'Strong Bear',    color: '#8B0000', textColor: '#fff' },
];

export default function ZoneBar({ currentZone }) {
  return (
    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', gap: 2 }}>
      {ZONES.map(z => (
        <div
          key={z.zone}
          style={{
            flex: 1,
            background: z.color,
            color: z.textColor,
            padding: '8px 4px',
            textAlign: 'center',
            fontSize: 11,
            fontWeight: currentZone === z.zone ? 900 : 400,
            opacity: currentZone && currentZone !== z.zone ? 0.35 : 1,
            transform: currentZone === z.zone ? 'scaleY(1.15)' : 'scaleY(1)',
            transition: 'all 0.3s',
            boxShadow: currentZone === z.zone ? '0 0 12px 2px rgba(255,255,255,0.4)' : 'none',
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800 }}>{z.zone}</div>
          <div style={{ fontSize: 9, lineHeight: 1.2 }}>{z.name}</div>
        </div>
      ))}
    </div>
  );
}
