/**
 * What a PLC's trial license end means now (as shared/tcLicense.cjs licenseState, for XAE, which reads only the
 * file's times): ran out, runs out within two days, or fine
 */
const DAY = 24 * 3600 * 1000;

export function trialLicenseState(expires: string, now = Date.now()): { state: 'expired' | 'soon' | 'ok'; text: string } | null {
  const end = Date.parse(expires);
  if (!Number.isFinite(end)) return null;
  const left = end - now;
  const when = new Date(end).toLocaleString();
  if (left <= 0) return { state: 'expired', text: `The PLC's TwinCAT trial license ran out (${when}). The PLC runs on, but a download, restart or activation leaves it stopped: renew the trial first (XAE: SYSTEM > License > 7 Days Trial License).` };
  if (left < 2 * DAY) return { state: 'soon', text: `The PLC's TwinCAT trial license runs out ${left < DAY ? `in ${Math.max(1, Math.round(left / 3600000))} h` : 'tomorrow'} (${when}). After that the PLC's next start fails: renew it (XAE: SYSTEM > License > 7 Days Trial License).` };
  return { state: 'ok', text: `The PLC's TwinCAT trial license runs until ${when}.` };
}

/** The chip's text: "trial until Oct 15, 17:00" (and how long left) */
export function trialChip(expires: string, now = Date.now()): { text: string; level: 'ok' | 'soon' | 'expired' } {
  const end = Date.parse(expires);
  const left = end - now;
  const date = new Date(end).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (left <= 0) return { text: `trial ran out ${date}`, level: 'expired' };
  const d = Math.floor(left / DAY);
  const h = Math.floor((left % DAY) / 3600000);
  return { text: `trial until ${date} (${d ? `${d} d ` : ''}${h} h)`, level: left < 2 * DAY ? 'soon' : 'ok' };
}
