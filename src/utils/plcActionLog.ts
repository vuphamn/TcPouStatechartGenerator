/**
 * What was done to the PLCs from here, not live (Browse's Start PLC, Stop PLC, Restart, Run mode): kept in this
 * browser (the last 100), newest first, for the Live tab's history. A gateway keeps its own (its audit log).
 */
export interface PlcActionEntry {
  /** When (ms) */
  t: number;
  netId: string;
  name: string;
  /** plc (started), stop, restart, run (TwinCAT to Run mode) */
  mode: 'plc' | 'stop' | 'restart' | 'run';
  ok: boolean;
  state?: string | null;
  error?: string;
  /** Who (a gateway's user); here: this computer */
  user?: string;
}

const KEY = 'kss.plcActions';
const MAX = 100;

export function loadPlcActions(): PlcActionEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e.t === 'number' && typeof e.netId === 'string') : [];
  } catch {
    return [];
  }
}

export function addPlcAction(entry: PlcActionEntry): PlcActionEntry[] {
  const list = [entry, ...loadPlcActions()].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // (not kept: a per-viewer convenience)
  }
  return list;
}
