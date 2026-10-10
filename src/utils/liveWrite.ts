/**
 * Writing a watched variable's value to the PLC (XAE's Write Values, from the Live tab's guard values): the text typed
 * read as the variable's type (BOOL, an enum's member or number, an integer in decimal or 16# / 8# / 2#, a REAL, a TIME
 * as T#… or milliseconds, a STRING), then written by the edition's host (TwinCAT XAE, VS Code, the desktop app) to the
 * symbol it follows. The PLC's own checks (its range, a string's length) answer in the result.
 */
import type { EnumTables } from './liveGuards.ts';

export type WritableValue = boolean | number | string;

const INTEGER_TYPES = /^(SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT|BYTE|WORD|DWORD|LWORD|BIT)$/;

/** T#1s250ms / T#2S / TIME#500MS / 1500 → milliseconds; null when not a duration */
export function parseDuration(text: string): number | null {
  const t = text.trim().replace(/_/g, '');
  if (/^-?\d+$/.test(t)) return Number(t);
  const m = /^(?:L?T|L?TIME)#(-)?(.+)$/i.exec(t);
  if (!m) return null;
  const units: Record<string, number> = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };
  let total = 0;
  let rest = m[2].toLowerCase();
  while (rest) {
    const p = /^(\d+(?:\.\d+)?)(ms|d|h|m|s)/.exec(rest);
    if (!p) return null;
    total += Number(p[1]) * units[p[2]];
    rest = rest.slice(p[0].length);
  }
  return Math.round(m[1] ? -total : total);
}

/** An integer as written in ST: 42, -7, 16#FF, 8#17, 2#1010 (underscores allowed); null when not one */
function parseInteger(text: string): number | null {
  const t = text.trim().replace(/_/g, '');
  const b = /^(16|8|2)#([0-9a-f]+)$/i.exec(t);
  if (b) return parseInt(b[2], Number(b[1]));
  return /^[+-]?\d+$/.test(t) ? Number(t) : null;
}

/**
 * The text typed for a variable of a type (its PLC type name: BOOL, INT, LREAL, STRING(80), TIME, E_State …) → its
 * value, or why it is not one
 */
export function parseLiveValue(text: string, type: string | undefined, enums?: EnumTables | null): { value: WritableValue } | { error: string } {
  const t = (type ?? '').trim();
  const T = t.toUpperCase();
  const s = text.trim();
  if (!s && !/STRING/.test(T)) return { error: 'Type a value' };
  if (T === 'BOOL' || T === 'BIT') {
    if (/^(TRUE|1)$/i.test(s)) return { value: true };
    if (/^(FALSE|0)$/i.test(s)) return { value: false };
    return { error: 'TRUE or FALSE' };
  }
  const names = enums?.types.get(t.toLowerCase()) ?? enums?.types.get((t.split('.').pop() ?? '').toLowerCase());
  if (names) {
    const member = s.split('.').pop()!.toLowerCase();
    for (const [n, name] of names) if (name.toLowerCase() === member) return { value: n };
    const n = parseInteger(s);
    if (n !== null) return { value: n };
    return { error: `One of ${[...names.values()].slice(0, 8).join(', ')}${names.size > 8 ? ', …' : ''}` };
  }
  if (/^W?STRING/.test(T)) return { value: s.replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1') };
  if (/^L?TIME$/.test(T)) {
    const ms = parseDuration(s);
    return ms === null ? { error: 'A duration: T#2S, T#1s250ms or milliseconds' } : { value: ms };
  }
  if (/^L?REAL$/.test(T)) {
    const n = Number(s.replace(/_/g, ''));
    return Number.isFinite(n) && s !== '' ? { value: n } : { error: 'A number (1.5, -2, 1E3)' };
  }
  if (INTEGER_TYPES.test(T) || !T) {
    const n = parseInteger(s);
    return n === null ? { error: 'A whole number (42, -7, 16#FF)' } : { value: n };
  }
  // (another type the PLC holds as a number: an alias, a subrange)
  const n = parseInteger(s) ?? Number(s);
  return Number.isFinite(n) ? { value: n } : { error: `A value of ${t}` };
}

let seq = 0;

/** The value written by the edition's host to the watched variable (its watch id) → { ok, message } */
export async function writeLiveVar(mode: 'xae' | 'desktop' | 'web' | null, id: string, value: WritableValue): Promise<{ ok: boolean; message: string }> {
  // (the hosts' modules when needed: the parsing above stands alone)
  const { onHostMessage, postToHost } = await import('./xaeHost.ts');
  const { desktopLive } = await import('./liveHost.ts');
  if (mode === 'desktop') {
    const live = desktopLive() as unknown as { write?: (req: { id: string; value: WritableValue }) => Promise<{ ok: boolean; message: string }> } | null;
    if (!live?.write) return { ok: false, message: 'Update the desktop app: it cannot write values' };
    return live.write({ id, value }).catch((e: unknown) => ({ ok: false, message: String((e as Error)?.message ?? e) }));
  }
  if (mode !== 'xae') return { ok: false, message: 'Writing values is in TwinCAT XAE, VS Code and the desktop app (not through a gateway)' };
  const requestId = ++seq;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off();
      resolve({ ok: false, message: 'No answer from the extension' });
    }, 15000);
    const off = onHostMessage((m) => {
      if (m.type !== 'liveWriteResult' || m.requestId !== requestId) return;
      window.clearTimeout(timer);
      off();
      resolve({ ok: m.ok, message: m.message });
    });
    postToHost({ type: 'liveWrite', requestId, id, value });
  });
}
