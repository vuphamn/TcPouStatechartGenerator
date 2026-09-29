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

export interface CheckRequest {
  netId: string;
  ip: string;
  port?: number;
  localNetId?: string;
}
