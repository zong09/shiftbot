import React from 'react';
import { ZONES } from '../theme.js';

export default function ZoneBar({ currentZone }) {
  const cur = Number(currentZone);
  return (
    <div className="flex gap-1">
      {ZONES.map(z => {
        const active = cur === z.zone;
        return (
          <div
            key={z.zone}
            className={`flex-1 min-w-0 rounded-xl py-4 px-1 text-center transition-all duration-200 ${
              currentZone && !active ? 'opacity-45' : ''
            }`}
            style={{
              background: z.color,
              color: z.text,
              boxShadow: active ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : 'none',
            }}
          >
            <div className="font-mono text-2xl font-bold leading-none">{z.zone}</div>
            <div className="text-[11px] font-semibold leading-tight mt-1.5 opacity-90 overflow-hidden">{z.name}</div>
          </div>
        );
      })}
    </div>
  );
}
