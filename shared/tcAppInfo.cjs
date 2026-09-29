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

module.exports = { plcAppInfo, waitForRun, ONLINE_CHANGES };
