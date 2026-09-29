// The remembered PLCs kept up to date by the Live tab's Browse (no browser or host needed: unit-tested)
import type { FoundPlc, RememberedPlc } from './plcDiscovery.ts';

/**
 * The remembered PLCs with what a search found about them (by AMS NetId): its TwinCAT, OS and when it was seen; its
 * IP when that is a plain address that changed (DHCP). Not their names (the user's). The same list when nothing is new
 */
export function refreshRemembered(list: RememberedPlc[], devices: FoundPlc[], now: number): RememberedPlc[] {
  let changed = false;
  const next = list.map((p) => {
    const d = devices.find((x) => x.netId === p.netId && x.source !== 'project');
    if (!d) return p;
    const plainIp = !p.ip || /^\d{1,3}(\.\d{1,3}){3}$/.test(p.ip);
    const ip = plainIp && d.ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(d.ip) ? d.ip : p.ip;
    const q = { ...p, ip, ...(d.twincat ? { twincat: d.twincat } : {}), ...(d.os ? { os: d.os } : {}), seen: now };
    if (q.ip !== p.ip || q.twincat !== p.twincat || q.os !== p.os || !p.seen || now - p.seen > 60000) {
      changed = true;
      return q;
    }
    return p;
  });
  return changed ? next : list;
}
