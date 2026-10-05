/**
 * The Live tab's Check (shared/tcCheck.cjs, through the desktop app or Link): why a PLC does not answer, step by
 * step (this computer's adapter and network profile, ping, TwinCAT's search, the ADS port, the NetId, the routes).
 */

export interface CheckStep {
  id: 'adapter' | 'network' | 'ping' | 'search' | 'port' | 'netid' | 'router' | 'ads' | 'local' | 'plc';
  /** true: fine; false: the problem; null: a hint (not known, or not needed) */
  ok: boolean | null;
  title: string;
  detail?: string;
  /** What to use instead (the PLC's own AMS NetId; the ADS port its PLC runs on) */
  fix?: { netId?: string; port?: number };
}

export interface CheckResult {
  requestId?: number;
  steps: CheckStep[];
  /** The first problem and what to do, or that all is well */
  verdict: string;
  suggest?: { netId?: string; port?: number };
  error?: string;
}

/** A check as text (for a message, a colleague): the target, each step, the verdict */
export function checkAsText(target: { netId: string; ip: string }, r: CheckResult): string {
  const mark = (ok: boolean | null) => (ok === true ? '[ok]' : ok === false ? '[X] ' : '[!] ');
  return [
    `Kval MachineScope connection check: ${target.netId || '(no NetId)'} at ${target.ip || '(from the NetId)'} (${new Date().toLocaleString()})`,
    ...r.steps.map((s) => `${mark(s.ok)} ${s.title}${s.detail && s.ok !== true ? `\n       ${s.detail}` : ''}`),
    `=> ${r.verdict}`,
  ].join('\n');
}

/**
 * On the PLC's computer (Windows, PowerShell as administrator): its network profile shown, TwinCAT's ports allowed in
 * (ADS TCP 48898, its search and Add Route UDP 48899, ping), from these addresses only when given (e.g. this
 * computer's subnet)
 */
export function firewallCommands(from?: string): string {
  const remote = from ? ` -RemoteAddress ${from}` : '';
  return [
    '# The network profile (Public blocks connections coming in; Domain / Private: the rules below apply)',
    'Get-NetConnectionProfile | Format-Table Name, InterfaceAlias, NetworkCategory',
    '# (Public: Set-NetConnectionProfile -InterfaceAlias "Ethernet" -NetworkCategory Private)',
    '# TwinCAT: ADS (going live), its search and Add Route, ping',
    `New-NetFirewallRule -DisplayName "TwinCAT ADS (TCP 48898)" -Direction Inbound -Protocol TCP -LocalPort 48898 -Action Allow -Profile Domain,Private${remote}`,
    `New-NetFirewallRule -DisplayName "TwinCAT ADS search (UDP 48899)" -Direction Inbound -Protocol UDP -LocalPort 48899 -Action Allow -Profile Domain,Private${remote}`,
    `New-NetFirewallRule -DisplayName "Ping (ICMPv4 in)" -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow -Profile Domain,Private${remote}`,
    '# TwinCAT listening?',
    'Get-NetTCPConnection -LocalPort 48898 -State Listen; Get-NetUDPEndpoint -LocalPort 48899',
  ].join('\n');
}

export interface CheckRequest {
  netId: string;
  ip: string;
  port?: number;
  localNetId?: string;
}
