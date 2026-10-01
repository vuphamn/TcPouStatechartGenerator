import React, { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { IoBox, IoDevice } from './IoTreePanel.tsx';

/** A slave's state from the EtherCAT master (shared/tcEcat.cjs), by its box's path */
export interface SlaveState {
  name: string;
  ok: boolean;
  flags: string[];
  link: string[];
  ports: string[];
  /** Where it was read: the master (over ADS), or the box's own linked InfoData / WcState */
  from?: 'master' | 'infodata';
}
/** The masters' answer (ecatStatesResult): by the I/O device's AmsNetId */
export interface EcatStatesResult {
  masters?: Record<string, { count?: number; slaves?: (SlaveState & { index: number })[]; at?: number; error?: string }>;
  error?: string;
}

const STATE_NAMES: Record<number, string> = { 1: 'INIT', 2: 'PREOP', 3: 'BOOT', 4: 'SAFEOP', 8: 'OP' };
/** A slave's state word as TwinCAT keeps it (InfoData^State; the master's IG 9): the low nibble, its flags */
export function describeSlaveState(device: number, link = 0): SlaveState {
  const base = device & 0x0f;
  const flags = [
    ...(device & 0x10 ? ['error'] : []),
    ...(device & 0x20 ? ['invalid VPRS'] : []),
    ...(device & 0x40 ? ['init command error'] : []),
    ...(device & 0x80 ? ['disabled'] : []),
  ];
  const linkFlags = [
    ...(link & 0x01 ? ['not present'] : []),
    ...(link & 0x02 ? ['link without communication'] : []),
    ...(link & 0x04 ? ['missing link'] : []),
    ...(link & 0x08 ? ['additional link'] : []),
  ];
  const ports = ['A', 'B', 'C', 'D'].filter((_, i) => link & (0x10 << i));
  return { name: STATE_NAMES[base] ?? (base ? `state ${base}` : 'no answer'), ok: base === 8 && !(device & 0xf0) && !(link & 0x0f), flags, link: linkFlags, ports };
}

/** The boxes of a device in order (each one, then the boxes in it) */
export function allBoxes(boxes: IoBox[]): IoBox[] {
  const out: IoBox[] = [];
  const walk = (bs: IoBox[]) => bs.forEach((b) => (out.push(b), walk(b.boxes)));
  walk(boxes);
  return out;
}
/** A box's linked health items: its InfoData^State (the slave's state word) and its WcState (TRUE: invalid data) */
export function healthLinks(b: IoBox): { state?: string; wc?: string } {
  const out: { state?: string; wc?: string } = {};
  for (const p of b.pdos)
    for (const e of p.entries) {
      if (!e.link) continue;
      if (/\^InfoData\^State$/i.test(e.path)) out.state ??= e.link;
      else if (/\^WcState\^WcState$/i.test(e.path)) out.wc ??= e.link;
    }
  return out;
}

/**
 * The boxes' states by path: from the master (by each box's place among its slaves), else from the box's own linked
 * InfoData^State; a working counter fault (its WcState TRUE) makes either one not OK
 */
export function boxStates(devices: IoDevice[], ecat: EcatStatesResult | null, valueOf: (variable: string) => { v: unknown } | undefined): Map<string, SlaveState> {
  const out = new Map<string, SlaveState>();
  for (const d of devices) {
    const master = d.netId ? ecat?.masters?.[d.netId] : undefined;
    for (const b of allBoxes(d.boxes)) {
      let st: SlaveState | undefined;
      const fromMaster = master?.slaves && b.slave !== undefined && b.slave !== null ? master.slaves[b.slave] : undefined;
      if (fromMaster) st = { ...fromMaster, from: 'master' };
      else if (master?.slaves && typeof b.slave === 'number' && master.count !== undefined && b.slave >= master.count) st = { name: 'missing', ok: false, flags: [], link: ['not found by the master'], ports: [], from: 'master' };
      const h = healthLinks(b);
      if (!st && h.state) {
        const v = valueOf(h.state)?.v;
        if (typeof v === 'number') st = { ...describeSlaveState(v), from: 'infodata' };
      }
      if (h.wc && valueOf(h.wc)?.v === true) {
        st = st ? { ...st, ok: false, flags: [...st.flags, 'working counter'] } : { name: 'WC', ok: false, flags: ['working counter'], link: [], ports: [], from: 'infodata' };
      }
      if (st) out.set(b.path, st);
    }
  }
  return out;
}

/** A state as a sentence (a tooltip) */
export function stateText(st: SlaveState): string {
  return `${st.name}${st.flags.length ? ` (${st.flags.join(', ')})` : ''}${st.link.length ? `; link: ${st.link.join(', ')}${st.ports.length ? ` on port ${st.ports.join(', ')}` : ''}` : ''}${st.from === 'infodata' ? ' (its InfoData)' : st.from === 'master' ? ' (the EtherCAT master)' : ''}`;
}

const W = 128;
const H = 74;
const GAP_X = 18;
const GAP_Y = 34;

interface Placed {
  box: IoBox;
  x: number;
  y: number;
  /** The box it is wired to and on which of its ports (A … D) */
  parent: IoBox | null;
  port: number;
  /** Cut off: a box before it (on its way to the master) is down */
  behind: string | null;
}

/**
 * The cabling as the project wires it: a box's children on its port B (the E-bus, its terminals) in a row to its
 * right, those on its ports C / D (a junction's, a coupler's outgoing cables) in rows below
 */
function layout(device: IoDevice, states: Map<string, SlaveState>): { placed: Placed[]; width: number; height: number } {
  const all = allBoxes(device.boxes);
  const byId = new Map(all.filter((b) => b.id !== undefined).map((b) => [b.id!, b]));
  // (each box's parent and port: from its port A's info; without it, the box it is nested in, on port B)
  const parentOf = new Map<IoBox, { parent: IoBox | null; port: number }>();
  const nestParent = new Map<IoBox, IoBox | null>();
  const nest = (bs: IoBox[], p: IoBox | null) => bs.forEach((b) => (nestParent.set(b, p), nest(b.boxes, b)));
  nest(device.boxes, null);
  for (const b of all) {
    const info = b.portA;
    if (info && info.box !== undefined && byId.has(info.box)) parentOf.set(b, { parent: byId.get(info.box)!, port: info.port });
    else if (info && info.master) parentOf.set(b, { parent: null, port: 0 });
    else parentOf.set(b, { parent: nestParent.get(b) ?? null, port: 1 });
  }
  const children = new Map<IoBox | null, { box: IoBox; port: number }[]>();
  for (const b of all) {
    const { parent, port } = parentOf.get(b)!;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push({ box: b, port });
  }
  const placed: Placed[] = [];
  let maxX = 0;
  let cursorY = 0;
  // A row from a box: it, then its port-B chain; each one's other ports' cables: rows below
  const row = (start: IoBox, parent: IoBox | null, port: number, x: number, behind: string | null) => {
    const y = cursorY;
    cursorY += H + GAP_Y;
    let cur: IoBox | null = start;
    let px = x;
    let p = parent;
    let pPort = port;
    let cut = behind;
    const branches: { from: IoBox; box: IoBox; port: number; x: number; behind: string | null }[] = [];
    while (cur) {
      const st = cur.path ? states.get(cur.path) : undefined;
      placed.push({ box: cur, x: px, y, parent: p, port: pPort, behind: cut });
      maxX = Math.max(maxX, px + W);
      const nextCut = cut ?? (st && !st.ok ? cur.name : null);
      const kids: { box: IoBox; port: number }[] = children.get(cur) ?? [];
      for (const k of kids.filter((k) => k.port !== 1)) branches.push({ from: cur, box: k.box, port: k.port, x: px + 24, behind: nextCut });
      const chain: { box: IoBox; port: number }[] = kids.filter((k) => k.port === 1);
      p = cur;
      pPort = 1;
      cut = nextCut;
      cur = chain[0]?.box ?? null;
      // (a second box on the same port B: drawn as a branch)
      for (const extra of chain.slice(1)) branches.push({ from: p, box: extra.box, port: 1, x: px + 24, behind: nextCut });
      px += W + GAP_X;
    }
    for (const br of branches) row(br.box, br.from, br.port, br.x, br.behind);
    return y;
  };
  for (const root of children.get(null) ?? []) row(root.box, null, 0, 0, null);
  return { placed, width: maxX + 8, height: cursorY + 8 };
}

const PORTS = ['A', 'B', 'C', 'D'];

/**
 * The I/O network (an I/O device's EtherCAT topology): each box where it is cabled, its state from the master (OP
 * green; another state or a link fault red, the boxes behind it greyed: cut off), its linked boolean channels as
 * LEDs (lit: TRUE). Read-only; the states NOT YET CONFIRMED ON HARDWARE
 */
export const IoNetworkView: React.FC<{
  device: IoDevice;
  states: Map<string, SlaveState>;
  /** The master's answer: an error (its states not known), or when */
  stateNote: string | null;
  valueOf: (variable: string) => { v: unknown } | undefined;
  onSelectBox?: (path: string) => void;
}> = ({ device, states, stateNote, valueOf, onSelectBox }) => {
  const { placed, width, height } = useMemo(() => layout(device, states), [device, states]);
  const [scale, setScale] = useState(1);
  const at = new Map(placed.map((p) => [p.box, p]));
  const leds = (b: IoBox) =>
    b.pdos
      .flatMap((p) => p.entries.filter((e) => e.link && /^(BIT|BOOL)/i.test(e.type || 'BIT')).map((e) => ({ e, dir: p.dir })))
      .slice(0, 16);
  return (
    <div id="io-network" className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800 text-[10px] text-slate-400">
        <span id="io-network-unconfirmed" className="shrink-0 px-1.5 rounded border border-amber-700/60 bg-amber-950/40 text-amber-300" title="The states are read from the EtherCAT master over ADS as Beckhoff documents it (index groups 6 and 9 on port 0xFFFF); this has not been tried on a real PLC yet">
          Not yet confirmed on hardware
        </span>
        <span id="io-network-note" className="truncate">{stateNote}</span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setScale((s) => Math.max(0.4, s - 0.1))} className="p-0.5 rounded hover:bg-slate-800" title="Smaller"><Minus className="w-3 h-3" /></button>
          <span className="font-mono w-9 text-center">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((s) => Math.min(2, s + 0.1))} className="p-0.5 rounded hover:bg-slate-800" title="Bigger"><Plus className="w-3 h-3" /></button>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-2">
        <svg width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`} className="block" style={{ minWidth: width * scale }}>
          {/* The cables: to each box from the port of the box it is wired to */}
          {placed.map((p) => {
            if (!p.parent) return null;
            const from = at.get(p.parent);
            if (!from) return null;
            const st = states.get(p.box.path);
            const down = (st && !st.ok) || !!p.behind;
            const stroke = down ? 'var(--color-rose-500)' : 'var(--color-slate-500)';
            const d =
              p.port === 1 && from.y === p.y
                ? `M ${from.x + W} ${from.y + H / 2} L ${p.x} ${p.y + H / 2}`
                : `M ${p.x + 12} ${from.y + H} L ${p.x + 12} ${p.y + H / 2} L ${p.x} ${p.y + H / 2}`;
            return (
              <g key={`c-${p.box.path}`} data-io-cable={p.box.path}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={down ? 2 : 1.5} strokeDasharray={p.behind ? '4 3' : undefined} />
                {p.port !== 1 && <text x={p.x + 15} y={from.y + H + 11} fontSize="9" fill="var(--color-slate-400)">{PORTS[p.port] ?? p.port}</text>}
              </g>
            );
          })}
          {/* The boxes */}
          {placed.map((p) => {
            const st = states.get(p.box.path);
            const down = !!st && !st.ok;
            const cut = !!p.behind;
            const border = down ? 'var(--color-rose-500)' : cut ? 'var(--color-slate-600)' : st ? 'var(--color-emerald-500)' : 'var(--color-slate-600)';
            const label = p.box.name.replace(/\s*\([^()]*\)\s*$/, '');
            const lights = leds(p.box);
            return (
              <g
                key={p.box.path}
                data-io-node={p.box.path}
                data-state={st ? st.name : 'unknown'}
                data-down={down ? 'true' : undefined}
                data-cut={cut ? 'true' : undefined}
                transform={`translate(${p.x}, ${p.y})`}
                opacity={cut ? 0.45 : 1}
                style={{ cursor: onSelectBox ? 'pointer' : undefined }}
                onClick={() => onSelectBox?.(p.box.path)}
              >
                <title>{`${p.box.name}\n${st ? stateText(st) : 'State not known'}${cut ? `\nCut off: ${p.behind} before it is down` : ''}`}</title>
                <rect width={W} height={H} rx="6" fill="var(--color-slate-900)" stroke={border} strokeWidth={down ? 2.5 : 1.5} />
                {down && <rect width={W} height={H} rx="6" fill="var(--color-rose-500)" opacity="0.12" />}
                <text x="8" y="15" fontSize="11" fontWeight="700" fill="var(--color-sky-300)" fontFamily="ui-monospace, monospace">{p.box.product || '—'}</text>
                <text x={W - 8} y="15" fontSize="9" textAnchor="end" fontWeight="700" fill={down ? 'var(--color-rose-300)' : st ? 'var(--color-emerald-300)' : 'var(--color-slate-500)'}>
                  {cut && !st ? 'cut off' : st ? st.name : '—'}
                </text>
                <text x="8" y="31" fontSize="10" fill="var(--color-slate-200)">{label.length > 20 ? `${label.slice(0, 19)}…` : label}</text>
                {label.length > 20 && <text x="8" y="43" fontSize="10" fill="var(--color-slate-400)">{label.slice(19, 38)}{label.length > 38 ? '…' : ''}</text>}
                {lights.map(({ e, dir }, i) => {
                  const v = valueOf(e.link!)?.v;
                  const on = v === true;
                  const fill = v === undefined ? 'var(--color-slate-700)' : on ? (dir === 'in' ? 'var(--color-emerald-400)' : 'var(--color-amber-400)') : 'var(--color-slate-800)';
                  return (
                    <circle key={e.path} data-io-led={e.link} data-on={on ? 'true' : 'false'} cx={10 + (i % 8) * 14} cy={i < 8 ? 56 : 68} r="4.5" fill={fill} stroke="var(--color-slate-600)" strokeWidth="1">
                      <title>{`${e.name}: ${e.link} = ${v === undefined ? '…' : String(v).toUpperCase()}`}</title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
