import React from 'react';
import { ZONES } from '../theme.js';

export default function ZoneBar({ currentZone }) {
  return (
    <div className="flex gap-1">
      {ZONES.map(z => {
        const active = currentZone === z.zone;
        return (
          <div
            key={z.zone}
            className={`flex-1 rounded py-2 px-1 text-center transition-opacity duration-300 ${
              currentZone && !active ? 'opacity-30' : ''
            } ${active ? 'ring-2 ring-primary/40' : ''}`}
            style={{ background: z.color }}
          >
            <div className="text-base font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{z.zone}</div>
            <div className="text-[9px] leading-tight text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{z.name}</div>
          </div>
        );
      })}
    </div>
  );
}
