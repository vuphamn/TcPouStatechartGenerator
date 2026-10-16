import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import type { GatewayConnection } from '../utils/liveGateway.ts';
import type { SparePart } from './WorkParts.tsx';
import { sparesFor } from '../utils/spares.ts';

/** The gateway's spare parts, followed (sparesWatch): for a page that shows what fits its devices */
export function useSpares(conn: GatewayConnection | null, connected: boolean, subscribe: (fn: (m: { type: string }) => void) => () => void, on = true): SparePart[] {
  const [parts, setParts] = useState<SparePart[]>([]);
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === 'spares') setParts((m as unknown as { parts?: SparePart[] }).parts ?? []);
      }),
    [subscribe]
  );
  useEffect(() => {
    if (on && connected && conn) conn.send({ type: 'sparesWatch' });
  }, [on, connected, conn]);
  return parts;
}

/** The spare parts that fit a device (its name, type, product): each with its stock and where it is kept */
export const SparesFor: React.FC<{ parts: SparePart[]; texts: (string | null | undefined)[]; className?: string }> = ({ parts, texts, className = '' }) => {
  const fit = sparesFor(parts, ...texts);
  if (!fit.length) return null;
  return (
    <div className={`spares-for text-xs ${className}`}>
      <div className="flex items-center gap-1 text-slate-400">
        <Package className="w-3.5 h-3.5" /> Spare parts for it
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {fit.map((p) => (
          <li key={p.id} className="spares-for-part" data-part={p.number} data-qty={p.qty}>
            <span className="font-mono">{p.number}</span> {p.name}:{' '}
            <b className={p.qty === 0 ? 'text-rose-300' : p.low ? 'text-amber-300' : 'text-emerald-300'}>
              {p.qty} {p.unit || 'in stock'}
            </b>
            {p.location ? <span className="text-slate-500"> · {p.location}</span> : null}
            {p.reorder?.suggest ? <span className="text-amber-300"> · to order: {p.reorder.suggest}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};
