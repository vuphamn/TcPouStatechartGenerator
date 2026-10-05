// The PLCs found on the network (Browse), each described the way going live would see it: TwinCAT's state, its
// PLC's (port 851: Run, Stop, Invalid when it runs no program, or none there) and its project's name, read over a
// connection of their own (this computer's TwinCAT router first, else straight with this computer's NetId; read-only).
// One that does not answer: no route for this computer (or not reachable). Each within a few seconds, all at once.
// Its TwinCAT trial license too, when it has one (license: { state: expired | soon | ok, expires }): a PLC that runs no
// program because its trial ran out is told apart from one never started.
const ads = require('./tcAds.cjs');
const { systemClient } = require('./liveSession.cjs');
const { readBootFile, projectInfoOf } = require('./tcSources.cjs');
const { readTrialLicense, licenseState } = require('./tcLicense.cjs');

const adsCode = (err) => err?.adsError?.errorCode ?? err?.parent?.adsError?.errorCode ?? null;
const ADS_PORT_NOT_FOUND = 6;

/** One PLC: { system, plc, project } or { error } */
async function describePlc(device, { plcPort = 851, localNetId, localAdsPort } = {}) {
  let c = null;
  try {
    c = await systemClient({ netId: device.netId, ip: device.ip, ...(localNetId ? { localNetId } : {}), ...(localAdsPort ? { localAdsPort } : {}) });
    const system = ads.ADS_STATES[(await c.readState()).adsState] ?? 'unknown';
    let plc = null;
    if (system !== 'Config') {
      try {
        plc = ads.ADS_STATES[(await c.readState({ amsNetId: device.netId, adsPort: plcPort })).adsState] ?? 'unknown';
      } catch (err) {
        plc = adsCode(err) === ADS_PORT_NOT_FOUND ? 'none' : null;
      }
    }
    let project = null;
    try {
      project = (await projectInfoOf((p) => readBootFile(c, p)))?.project?.name || null;
    } catch {
      // (no project in its boot folder)
    }
    let license = null;
    try {
      const trial = await readTrialLicense(c);
      const st = licenseState(trial);
      if (st) license = { state: st.state, expires: trial.expires };
    } catch {
      // (no trial license there)
    }
    return { system, plc, project, ...(license ? { license } : {}) };
  } catch (err) {
    return { error: /route/i.test(String(err?.message ?? '')) ? 'no route for this computer' : String(err?.message ?? err).slice(0, 160) };
  } finally {
    await c?.disconnect().catch(() => {});
  }
}

/** The devices with their states (state: the above, or { error: 'no answer in time' }) */
async function describePlcs(devices, { timeoutMs = 4000, localNetId } = {}) {
  const list = (devices ?? []).slice(0, 32);
  const timeout = () => new Promise((r) => setTimeout(() => r({ error: 'no answer in time' }), timeoutMs));
  const states = await Promise.all(list.map((d) => (d?.netId ? Promise.race([describePlc(d, { localNetId }), timeout()]) : Promise.resolve(null))));
  return list.map((d, i) => (states[i] ? { ...d, state: states[i] } : d));
}

module.exports = { describePlc, describePlcs };
