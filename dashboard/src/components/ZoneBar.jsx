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
            className="flex-1 min-w-0 rounded-[8px] py-[9px] px-1 pb-2 text-center transition-all duration-200"
            style={{
              background: z.color,
              color: z.text,
              boxShadow: active ? '0 0 0 2px var(--surface), 0 0 0 4px var(--accent)' : 'none',
            }}
          >
            <div className="font-mono text-[15px] font-bold leading-none">{z.zone}</div>
            <div className="text-[8px] font-semibold leading-[1.15] mt-0.5 opacity-90 break-words hyphens-auto">{z.name}</div>
          </div>
        );
      })}
    </div>
  );
}
