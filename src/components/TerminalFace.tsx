import React from 'react';
import type { IoBox } from './IoTreePanel.tsx';
import { contactPos, faceOf, type FaceContact, type TerminalFace } from '../data/terminalFaces.ts';

/** The colour of a contact's kind (as on Beckhoff's drawings: power red / blue, PE green-yellow, signal orange) */
const KIND: Record<FaceContact['kind'], { fill: string; text: string }> = {
  in: { fill: 'var(--color-orange-400)', text: 'var(--color-slate-200)' },
  out: { fill: 'var(--color-orange-400)', text: 'var(--color-slate-200)' },
  signal: { fill: 'var(--color-orange-400)', text: 'var(--color-slate-200)' },
  'power+': { fill: 'var(--color-rose-500)', text: 'var(--color-rose-200)' },
  power0: { fill: 'var(--color-sky-500)', text: 'var(--color-sky-200)' },
  pe: { fill: 'var(--color-lime-400)', text: 'var(--color-lime-200)' },
  shield: { fill: 'var(--color-slate-400)', text: 'var(--color-slate-300)' },
  ethercat: { fill: 'var(--color-slate-300)', text: 'var(--color-slate-300)' },
  nc: { fill: 'var(--color-slate-700)', text: 'var(--color-slate-500)' },
};
const LED: Record<string, string> = { green: 'var(--color-emerald-400)', red: 'var(--color-rose-500)', yellow: 'var(--color-amber-300)', orange: 'var(--color-orange-400)', blue: 'var(--color-sky-400)', white: 'var(--color-slate-100)' };

/** A box's channel n's linked entry (its PDO "Channel n", or the n-th of its BIT / BOOL entries) */
function channelEntry(box: IoBox, channel: number, dir?: 'in' | 'out') {
  for (const p of box.pdos) {
    if (dir && p.dir !== dir) continue;
    if (new RegExp(`\\bChannel ${channel}\\b`, 'i').test(p.name)) return p.entries.find((e) => e.link) ?? p.entries[0];
  }
  const bits = box.pdos.filter((p) => (!dir || p.dir === dir) && p.name !== '(other links)').flatMap((p) => p.entries.filter((e) => /^(BIT|BOOL)/i.test(e.type || 'BIT')));
  return bits[channel - 1];
}

/**
 * A terminal's front as Beckhoff draws it (from its manual's connection diagram; to be checked against the manual):
 * its LEDs (lit by the linked channels' live values), its contacts numbered (hover: their signal and linked
 * variable), its sockets; nothing for a type not in the table
 */
export const TerminalFaceView: React.FC<{
  box: IoBox;
  valueOf: (variable: string) => { v: unknown } | undefined;
  /** Small (a network node): the drawing only, as an SVG at x, y of the node's own (height: its width's) */
  compact?: boolean;
  x?: number;
  y?: number;
  height?: number;
  face?: TerminalFace | null;
}> = ({ box, valueOf, compact = false, x: atX = 0, y: atY = 0, height, face: given }) => {
  const face = given === undefined ? faceOf(box) : given;
  if (!face) return null;
  const rows = face.rows;
  const cols = face.columns;
  const W = face.width ?? Math.max(cols * 14 + 8, face.sockets ? 36 : 0, face.ports?.length ? 46 : 0, 32);
  // (an LED at its own place in the field, else the next one row by row)
  const ledAt = face.leds.map((l, i) => l.at ?? ([i % Math.max(1, face.ledColumns), Math.floor(i / Math.max(1, face.ledColumns))] as [number, number]));
  const ledRows = face.leds.length ? Math.max(...ledAt.map((a) => a[1])) + 1 : 0;
  const top = 20 + (face.ports?.length ? face.ports.length * 15 : 0);
  const ledH = ledRows * 9 + (face.leds.length ? 6 : 0);
  const contactsTop = top + ledH;
  const socketsH = face.sockets ? Math.ceil(face.sockets.length / 2) * 20 : 0;
  const bottomTop = contactsTop + rows * 15 + socketsH + 4;
  const H = bottomTop + (face.portsBottom?.length ? 18 : 0) + 6;
  // (a contact's name when Beckhoff gives none: left / right and its row)
  const place = (c: FaceContact) => {
    if (!face.unnumbered) return String(c.n);
    const pos = contactPos(c.n);
    const col = Math.floor((pos - 1) / rows);
    const row = (pos - 1) % rows;
    // (2 columns: L / R and the row; more: the column and a / b … from the top)
    return cols <= 2 ? `${col === 0 ? 'L' : 'R'}${row + 1}` : `${col + 1}${'abcdefgh'[row] ?? row + 1}`;
  };
  const label = (c: FaceContact) => {
    const e = c.channel ? channelEntry(box, c.channel, c.kind === 'out' ? 'out' : c.kind === 'in' ? 'in' : undefined) : undefined;
    const v = e?.link ? valueOf(e.link)?.v : undefined;
    return { e, v };
  };
  const value = (v: unknown) => (v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
  const drawing = (
      <svg data-terminal-face={compact ? face.type : undefined} x={compact ? atX : undefined} y={compact ? atY : undefined} width={compact ? ((height ?? H) * W) / H : W * 1.6} height={compact ? height ?? H : H * 1.6} viewBox={`0 0 ${W} ${H}`} className="shrink-0" role="img" aria-label={`${face.type}: front view`}>
        <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="2" fill="var(--color-slate-300)" stroke="var(--color-slate-500)" />
        <rect x="2" y="2" width={W - 4} height="12" rx="1" fill="var(--color-slate-100)" />
        <text x={W / 2} y="10.5" fontSize="6.5" fontWeight="700" textAnchor="middle" fill="var(--color-slate-800)" fontFamily="ui-monospace, monospace">{face.type.replace(/-0000$/, '')}</text>
        {/* RJ45 / M8 ports at the top (couplers, boxes) */}
        {face.ports?.map((p, i) => (
          <g key={p.name} data-face-port={p.name} transform={`translate(4, ${18 + i * 15})`}>
            <title>{`${p.name}${p.comment ? `: ${p.comment}` : ''}`}</title>
            <rect width="16" height="12" rx="1.5" fill="var(--color-slate-700)" stroke="var(--color-slate-500)" />
            <rect x="4" y="3" width="8" height="6" fill="var(--color-slate-900)" />
            <text x="19" y="8.5" fontSize="5" fill="var(--color-slate-800)">{p.name}</text>
          </g>
        ))}
        {/* LEDs */}
        {face.leds.map((l, i) => {
          const [col, row] = ledAt[i];
          const e = l.channel ? channelEntry(box, l.channel, l.dir) : undefined;
          const v = e?.link ? valueOf(e.link)?.v : undefined;
          const on = l.channel ? v === true : false;
          const known = l.channel ? v !== undefined : false;
          const x = 8 + col * ((W - 16) / Math.max(1, face.ledColumns - 1 || 1)) * (face.ledColumns === 1 ? 0 : 1) + (face.ledColumns === 1 ? (W - 16) / 2 : 0);
          return (
            <g key={`${l.name}-${i}`} data-face-led={l.name} data-on={on ? 'true' : known ? 'false' : undefined} transform={`translate(${x}, ${top + 4 + row * 9})`}>
              <title>{`${l.name} (${l.colour})${l.meaning ? `: ${l.meaning}` : ''}${e?.link ? `\n${e.link} = ${value(v) || '…'}` : ''}`}</title>
              <rect x="-3" y="-2.5" width="6" height="5" rx="1" fill={on ? LED[l.colour] ?? LED.green : 'var(--color-slate-600)'} stroke="var(--color-slate-500)" strokeWidth="0.5" />
            </g>
          );
        })}
        {/* The contacts: column by column, top to bottom (Beckhoff's numbering) */}
        {face.contacts.map((c) => {
          const pos = contactPos(c.n);
          const col = Math.floor((pos - 1) / rows);
          const row = (pos - 1) % rows;
          const x = 4 + col * 14 + 7;
          const y = contactsTop + row * 15 + 7;
          const { e, v } = label(c);
          return (
            <g key={c.n} data-face-contact={c.n} transform={`translate(${x}, ${y})`}>
              <title>{`${c.n}: ${c.label}${c.comment ? ` (${c.comment})` : ''}${e?.link ? `\n${e.link} = ${value(v) || '…'}` : ''}`}</title>
              <rect x="-5" y="-6" width="10" height="5" rx="1" fill={KIND[c.kind].fill} />
              <circle cy="3" r="3" fill="var(--color-slate-800)" stroke="var(--color-slate-500)" strokeWidth="0.5" />
              {!face.unnumbered && <text x="-6.5" y="5" fontSize="4.2" textAnchor="end" fill="var(--color-slate-700)">{c.n}</text>}
            </g>
          );
        })}
        {/* M8 / M12 sockets (boxes) */}
        {face.sockets?.map((s, i) => {
          const half = Math.ceil((face.sockets?.length ?? 0) / 2);
          const [c, r] = face.socketOrder === 'columns' ? [Math.floor(i / half), i % half] : [i % 2, Math.floor(i / 2)];
          const x = 10 + c * (W - 20);
          const y = contactsTop + rows * 15 + r * 20 + 9;
          const e = s.channel ? channelEntry(box, s.channel, s.dir) : undefined;
          const v = e?.link ? valueOf(e.link)?.v : undefined;
          return (
            <g key={s.name} data-face-socket={s.name} transform={`translate(${x}, ${y})`}>
              <title>{`${s.name}${s.comment ? `: ${s.comment}` : ''}${e?.link ? `\n${e.link} = ${value(v) || '…'}` : ''}`}</title>
              <circle r="7" fill="var(--color-slate-600)" stroke="var(--color-slate-400)" />
              <circle r="3.5" fill={v === true ? 'var(--color-emerald-400)' : 'var(--color-slate-800)'} />
              <text y="-8.5" fontSize="4.5" textAnchor="middle" fill="var(--color-slate-800)">{s.name}</text>
            </g>
          );
        })}
        {/* Connectors at the bottom (a box's power) */}
        {face.portsBottom?.map((p, i) => (
          <g key={p.name} data-face-port={p.name} transform={`translate(${4 + i * ((W - 8) / Math.max(1, face.portsBottom!.length))}, ${bottomTop})`}>
            <title>{`${p.name}${p.comment ? `: ${p.comment}` : ''}`}</title>
            <circle cx="6" cy="6" r="5.5" fill="var(--color-slate-700)" stroke="var(--color-slate-500)" />
            <text x="13" y="8" fontSize="4.5" fill="var(--color-slate-800)">{p.name}</text>
          </g>
        ))}
      </svg>
  );
  if (compact) return drawing;
  return (
    <div data-terminal-face={face.type} className="flex gap-2 items-start">
      {drawing}
      {(
        <div className="min-w-0 flex-1 text-[10px]">
          <table className="w-full">
            <tbody>
              {[...face.contacts].sort((a, b) => contactPos(a.n) - contactPos(b.n)).map((c) => {
                const { e, v } = label(c);
                return (
                  <tr key={c.n} data-face-row={c.n} className="align-top">
                    <td className="pr-1 font-mono text-slate-500 text-right">{place(c)}</td>
                    <td className="pr-1" style={{ color: KIND[c.kind].text }}>{c.label}</td>
                    <td className="font-mono text-slate-500 truncate max-w-[9rem]" title={e?.link}>{e?.link ? `${e.link}${v === undefined ? '' : ` = ${value(v)}`}` : c.comment ?? ''}</td>
                  </tr>
                );
              })}
              {[...(face.ports ?? []), ...(face.portsBottom ?? [])].map((p) => (
                <tr key={`port-${p.name}`} data-face-row={p.name} className="align-top">
                  <td className="pr-1 font-mono text-slate-500 text-right whitespace-nowrap">{p.name}</td>
                  <td colSpan={2} className="text-slate-400">{p.comment ?? ''}</td>
                </tr>
              ))}
              {face.sockets?.map((s) => {
                const e = s.channel ? channelEntry(box, s.channel, s.dir) : undefined;
                const v = e?.link ? valueOf(e.link)?.v : undefined;
                return (
                  <tr key={s.name} data-face-row={s.name} className="align-top">
                    <td className="pr-1 font-mono text-slate-500 text-right">{s.name}</td>
                    <td className="pr-1 text-slate-200">{s.label}</td>
                    <td className="font-mono text-slate-500 truncate max-w-[9rem]" title={e?.link}>{e?.link ? `${e.link}${v === undefined ? '' : ` = ${value(v)}`}` : s.comment ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div data-face-note="" className="pt-1 text-amber-300/90">
            Drawn from Beckhoff's documentation{face.confidence !== 'high' ? ' (partly)' : ''}: check against the manual before wiring.
            {face.notes ? <span className="text-slate-500"> {face.notes}</span> : null}
          </div>
        </div>
      )}
    </div>
  );
};
