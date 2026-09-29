/**
 * The Live tab's Check (shared/tcCheck.cjs, through the desktop app or Link): why a PLC does not answer, step by
 * step (this computer's adapter and network profile, ping, TwinCAT's search, the ADS port, the NetId, the routes).
 */

export interface CheckStep {
  id: 'adapter' | 'ping' | 'search' | 'port' | 'netid' | 'router' | 'ads';
  /** true: fine; false: the problem; null: a hint (not known, or not needed) */
  ok: boolean | null;
  title: string;
  detail?: string;
  /** What to use instead (the PLC's own AMS NetId) */
  fix?: { netId: string };
}

export interface CheckResult {
  requestId?: number;
  steps: CheckStep[];
  /** The first problem and what to do, or that all is well */
  verdict: string;
  suggest?: { netId: string };
  error?: string;
}

/** A check as text (for a message, a colleague): the target, each step, the verdict */
export function checkAsText(target: { netId: string; ip: string }, r: CheckResult): string {
  const mark = (ok: boolean | null) => (ok === true ? '[ok]' : ok === false ? '[X] ' : '[!] ');
  return [
    `Kval StateScope connection check: ${target.netId || '(no NetId)'} at ${target.ip || '(from the NetId)'} (${new Date().toLocaleString()})`,
    ...r.steps.map((s) => `${mark(s.ok)} ${s.title}${s.detail && s.ok !== true ? `\n       ${s.detail}` : ''}`),
    `=> ${r.verdict}`,
  ].join('\n');
}

export interface CheckRequest {
  netId: string;
  ip: string;
  port?: number;
  localNetId?: string;
}
