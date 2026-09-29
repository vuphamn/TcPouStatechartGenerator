// The target's TwinCAT trial license (read-only, over ADS: the system service's file access, next to its boot
// folder): when it runs out. A trial that ran out lets a running PLC run on, but the next application start (a
// download, a restart, an activation) fails: the PLC stays in Stop, TwinCAT in Config mode. Checked before a write
// that restarts the application, and shown in the Live tab when it is near.
// A full license (a dongle, an online license, a license file of the machine) has no trial file: nothing to say.
const { readBootFile } = require('./tcSources.cjs');

// (TwinCAT 3.1.4026: <root>\License, the Boot folder's sibling; 4024: <root>\3.1\Target\License)
const TRIAL_FILES = ['../License/TrialLicense.tclrs', '../Target/License/TrialLicense.tclrs'];
const DAY = 24 * 3600 * 1000;

/** The trial license's times and what it covers: { expires, issued, orders } (ISO, UTC), or null (none found) */
async function readTrialLicense(client) {
  for (const f of TRIAL_FILES) {
    let xml;
    try {
      xml = (await readBootFile(client, f)).toString('utf8');
    } catch {
      continue;
    }
    const expire = /<ExpireTime>([^<]+)<\/ExpireTime>/.exec(xml)?.[1];
    if (!expire) continue;
    // (the file's times are UTC without a zone)
    const iso = (t) => (/Z|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`);
    const issued = /<IssueTime>([^<]+)<\/IssueTime>/.exec(xml)?.[1];
    return { expires: new Date(iso(expire)).toISOString(), ...(issued ? { issued: new Date(iso(issued)).toISOString() } : {}), orders: [...xml.matchAll(/<OrderNo>([^<]+)<\/OrderNo>/g)].map((m) => m[1]) };
  }
  return null;
}

/**
 * What a trial license's end means now: { state: 'expired' | 'soon' | 'ok', text } (soon: within 2 days); null
 * without a trial
 */
function licenseState(trial, now = Date.now()) {
  if (!trial?.expires) return null;
  const left = Date.parse(trial.expires) - now;
  const when = new Date(trial.expires).toLocaleString();
  if (left <= 0) return { state: 'expired', text: `The PLC's TwinCAT trial license ran out (${when}). The PLC runs on, but a download, restart or activation leaves it stopped: renew the trial first (XAE: SYSTEM > License > 7 Days Trial License).` };
  if (left < 2 * DAY) return { state: 'soon', text: `The PLC's TwinCAT trial license runs out ${left < DAY ? `in ${Math.max(1, Math.round(left / 3600000))} h` : 'tomorrow'} (${when}). After that the PLC's next start fails: renew it (XAE: SYSTEM > License > 7 Days Trial License).` };
  return { state: 'ok', text: `The PLC's TwinCAT trial license runs until ${when}.` };
}

module.exports = { readTrialLicense, licenseState, TRIAL_FILES };
