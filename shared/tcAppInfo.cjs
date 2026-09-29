// The PLC application's state and how often it took an online change (read-only): after a write, is it back in Run?
// After an online change made from the user's own XAE, did the PLC take it (its count went up)?
// TwinCAT counts them in TwinCAT_SystemInfoVarList._AppInfo.OnlineChangeCnt (reset by a download).
const ads = require('./tcAds.cjs');

const ONLINE_CHANGES = 'TwinCAT_SystemInfoVarList._AppInfo.OnlineChangeCnt';

/** The PLC runtime's state (Run, Stop, ...) and its online change count: { state, onlineChanges } (null: not read) */
async function plcAppInfo(client) {
  let state = null;
  try {
    state = ads.ADS_STATES[(await client.readState()).adsState] ?? 'unknown';
  } catch {
    // not reachable now (TwinCAT restarting)
  }
  let onlineChanges = null;
  try {
    const info = await ads.probe(client, ONLINE_CHANGES);
    if (info) {
      const handle = await ads.createHandle(client, ONLINE_CHANGES);
      try {
        onlineChanges = Number(await ads.readByHandle(client, handle, info.size));
      } finally {
        await ads.releaseHandle(client, handle).catch(() => {});
      }
    }
  } catch {
    // (an older runtime without it, or not reachable)
  }
  return { state, onlineChanges };
}

/**
 * After a write: the PLC's state until it is Run, or the time is up (a download starts the application within a few
 * seconds; activating restarts TwinCAT first). → { state, ok, waitedMs }
 */
async function waitForRun(client, { timeoutMs = 20000, pollMs = 1000 } = {}) {
  const started = Date.now();
  let state = null;
  for (;;) {
    try {
      state = ads.ADS_STATES[(await client.readState()).adsState] ?? 'unknown';
    } catch {
      state = null;
    }
    if (state === 'Run' || Date.now() - started >= timeoutMs) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { state, ok: state === 'Run', waitedMs: Date.now() - started };
}

/** The PLC application started (ADS: Run), then waited for until it runs: { state, ok } or { state, ok: false, error } */
async function startPlc(client, { timeoutMs = 10000 } = {}) {
  try {
    await client.startPlc();
  } catch (err) {
    const why = err?.adsError?.errorStr ?? err?.parent?.adsError?.errorStr ?? err?.message ?? String(err);
    return { state: null, ok: false, error: `The PLC did not start: ${why}` };
  }
  const run = await waitForRun(client, { timeoutMs });
  return { state: run.state, ok: run.ok, ...(run.ok ? {} : { error: `The PLC is in ${run.state ?? '?'} after Start: look at TwinCAT's messages on the target (its license, an exception)` }) };
}

module.exports = { plcAppInfo, waitForRun, startPlc, ONLINE_CHANGES };
