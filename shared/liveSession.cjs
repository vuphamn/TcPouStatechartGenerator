// A live view session: follows a POU's state variable in a PLC over ADS, straight to the PLC's router (TCP 48898,
// ads-client in direct mode: no TwinCAT needed on this computer). Needs an ADS route on the PLC for this computer
// (its AMS NetId and IP). Reports with the same liveStatus / liveValues messages as the XAE extension.
// Used by the desktop app (electron/tcLive.cjs, one session) and the local helper (link/, one per browser tab).
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('ads-client');
const ads = require('./tcAds.cjs');
const { readPlcSources } = require('./tcSources.cjs');
const { buildFromPlc, checkEdits, closeXae } = require('./tcBuild.cjs');
const { VarWatcher, parseWatchRequest } = require('./liveVars.cjs');

const LOCAL_ADS_PORT = 32905;

// Adapters that do not reach a PLC on the network: virtual switches (Hyper-V, WSL, VirtualBox, VMware), Bluetooth,
// Wi-Fi Direct; and addresses without a network (169.254: no DHCP answer)
const VIRTUAL_ADAPTER = /vEthernet|Hyper-V|WSL|VirtualBox|VMware|VMnet|Bluetooth|Loopback|Local Area Connection\*|Teredo|isatap/i;

/**
 * This computer's IPv4 address towards the PLC: the adapter on the PLC's subnet; else (a PLC behind a gateway) a real
 * network adapter's, not a virtual switch's (the first adapter is often Hyper-V's)
 */
function localIpTowards(plcIp) {
  const all = Object.entries(os.networkInterfaces()).flatMap(([iface, addrs]) => (addrs ?? []).filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => ({ ...a, iface })));
  const toInt = (ip) => ip.split('.').reduce((n, b) => (n << 8) + Number(b), 0) >>> 0;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(plcIp)) {
    const hit = all.find((a) => !a.address.startsWith('169.254.') && (toInt(a.address) & toInt(a.netmask)) === (toInt(plcIp) & toInt(a.netmask)));
    if (hit) return hit.address;
  }
  const real = all.filter((a) => !a.address.startsWith('169.254.') && !VIRTUAL_ADAPTER.test(a.iface));
  return (real[0] ?? all.find((a) => !a.address.startsWith('169.254.')) ?? all[0])?.address ?? '127.0.0.1';
}

/** This computer's TwinCAT AMS NetId, when TwinCAT is installed (its router owns that NetId) */
function localTwinCatNetId() {
  // (the tests: KSS_LOCAL_TWINCAT_NETID, a NetId or "none")
  const forced = process.env.KSS_LOCAL_TWINCAT_NETID;
  if (forced) return forced === 'none' ? null : forced;
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Beckhoff\\TwinCAT3\\System', '/v', 'AmsNetId'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
    const hex = out.match(/REG_BINARY\s+([0-9A-F]{12})/i)?.[1];
    return hex ? hex.match(/../g).map((h) => parseInt(h, 16)).join('.') : null;
  } catch {
    return null;
  }
}

/**
 * The AMS NetId this computer uses towards the PLC: its IP + ".1.1", unless TwinCAT on this computer already has
 * that NetId (answers to it would go to TwinCAT's router, not to StateScope): then ".1.2"
 */
function defaultLocalNetId(localIp) {
  const id = `${localIp}.1.1`;
  return id === localTwinCatNetId() ? `${localIp}.1.2` : id;
}

/**
 * hooks: { findInstances?(path, typeName): string[], plcPort?(path): number } - instance paths and ADS port from
 * the PLC project's files (desktop app); without them (or without a path) the PLC's own tables are used
 */
function createLiveSession(hooks = {}) {
  let session = null;
  let sessionId = 0;

  /**
   * options: { path?, typeName?, stateVar, instance?, netId, ip?, port?, localNetId? }
   * netId: the PLC's AMS NetId; ip: its address (default: the first 4 numbers of the NetId), may be "host:tcpPort";
   * typeName: the function block's name, to find its instances in the PLC when the project files do not tell
   */
  async function start(send, options) {
    await stop(false);
    const id = ++sessionId;
    const status = (state, message, extra = {}) => id === sessionId && send({ type: 'liveStatus', state, message, ...extra });
    const netId = (options.netId || '').trim();
    if (!/^\d+\.\d+\.\d+\.\d+\.\d+\.\d+$/.test(netId)) {
      status('error', "Enter the PLC's AMS NetId (e.g. 192.168.1.20.1.1)");
      return;
    }
    const [host, tcp] = (options.ip || netId.split('.').slice(0, 4).join('.')).trim().split(':');
    const tcpPort = Number(tcp) || 48898;
    const localIp = localIpTowards(host);
    const localNetId = (options.localNetId || '').trim() || defaultLocalNetId(localIp);
    const route = { localNetId, localIp };
    const typeName = options.typeName || (options.path ? path.basename(options.path).replace(/\.TcPOU$/i, '') : null);
    const adsPort = options.port || (options.path && hooks.plcPort ? hooks.plcPort(options.path) : 851);
    status('connecting', `Connecting to ${host} (${netId}, port ${adsPort})...`, { route });

    // A PLC on this computer (127.0.0.1 / localhost, no local NetId given): through this computer's own TwinCAT router,
    // which gives the connection its address and port (as any local ADS program); else straight to the PLC's router,
    // with this computer's NetId (its route on the PLC)
    const viaLocalRouter = /^(127\.\d+\.\d+\.\d+|localhost)$/i.test(host) && tcpPort === 48898 && !(options.localNetId || '').trim();
    const makeClient = (router) => new Client({
      targetAmsNetId: netId,
      targetAdsPort: adsPort,
      routerAddress: router ? '127.0.0.1' : host,
      routerTcpPort: router ? 48898 : tcpPort,
      ...(router ? {} : { localAmsNetId: localNetId, localAdsPort: LOCAL_ADS_PORT }),
      rawClient: true,
      autoReconnect: false,
      timeoutDelay: 3000,
      hideConsoleWarnings: true,
    });
    // TwinCAT on this computer, a PLC elsewhere (no local NetId given): through this computer's TwinCAT router first,
    // so a route it already has (XAE's Add Route) serves here too; it refuses at once when it has none: then straight
    // to the PLC, with this computer's own NetId
    let client = null;
    let preconnected = false;
    const routerNetId = !viaLocalRouter && tcpPort === 48898 && !(options.localNetId || '').trim() ? localTwinCatNetId() : null;
    if (routerNetId) {
      const c = makeClient(true);
      try {
        await c.connect();
        await c.readState();
        client = c;
        preconnected = true;
        Object.assign(route, { localNetId: routerNetId, viaRouter: true });
      } catch {
        await c.disconnect().catch(() => {});
      }
      if (id !== sessionId) {
        await client?.disconnect().catch(() => {});
        return;
      }
    }
    client ??= makeClient(viaLocalRouter);
    // desired: guard variables asked for before the connection was made (liveWatch)
    const s = { id, client, adsPort, netId, handle: 0, subscription: null, queue: [], timer: null, stateTimer: null, vars: null, desired: null, dtCache: new Map(), connected: false, sources: null };
    session = s;
    const found = [];
    try {
      try {
        if (!preconnected) await client.connect();
      } catch (err) {
        throw new Error(`${host}:${tcpPort} did not accept the connection (${ads.adsErrorText(err)}). Is there an ADS route on the PLC for this computer (AMS NetId ${localNetId}, IP ${localIp})?`);
      }
      let plcState;
      try {
        plcState = ads.ADS_STATES[(await client.readState()).adsState] ?? 'unknown';
      } catch (err) {
        throw new Error(`The PLC did not answer on ADS port ${adsPort}: ${ads.adsErrorText(err)}. Without a route for this computer (AMS NetId ${localNetId}, IP ${localIp}) the PLC does not answer.`);
      }
      // Monitor (another PLC in the Machine Overview): connected for browsing and watched values, no state variable
      if (options.monitor === true) {
        if (id !== sessionId) throw new Error('stopped');
        startTimers(s, send, status);
        s.connected = true;
        status('connected', `${host} (${netId}:${adsPort}) (PLC ${plcState})`, { target: `${netId}:${adsPort}`, plcState, instances: [], route, monitor: true });
        return { symbol: null, netId, adsPort };
      }
      let candidates = options.path && typeName && hooks.findInstances ? hooks.findInstances(options.path, typeName) : [];
      // Not from the project (or not found there): the PLC's own symbol and data type tables
      if (candidates.length === 0 && typeName) {
        try {
          candidates = await ads.discoverInstances(client, typeName);
        } catch {
          // runtimes without the upload services: the path has to be entered
        }
      }
      if (options.instance) candidates.unshift(options.instance.trim());
      let chosen = null;
      let info = null;
      for (const c of [...new Map(candidates.map((p) => [p.toLowerCase(), p])).values()]) {
        const i = await ads.probe(client, `${c}.${options.stateVar}`);
        if (!i) continue;
        found.push(c);
        if (!chosen) {
          chosen = c;
          info = i;
        }
      }
      if (!chosen) {
        throw new Error(candidates.length === 0
          ? `No instance of ${typeName ?? 'the POU'} was found in the project or the PLC: enter its path (e.g. MAIN.fbX)`
          : `The PLC (${plcState}) has none of ${candidates.slice(0, 3).join(', ')}${candidates.length > 3 ? ', ...' : ''}: is the current program downloaded? Or enter the instance path`);
      }
      if (![1, 2, 4, 8].includes(info.size)) throw new Error(`${chosen}.${options.stateVar} is ${info.size} bytes: only integer / enum variables can be followed`);
      const symbol = `${chosen}.${options.stateVar}`;
      s.handle = await ads.createHandle(client, symbol);
      s.queue.push({ t: Date.now(), value: await ads.readByHandle(client, s.handle, info.size) });
      s.subscription = await ads.subscribeHandle(client, s.handle, info.size, (sample) => s.queue.push(sample));
      if (id !== sessionId) throw new Error('stopped');
      startTimers(s, send, status);
      s.connected = true;
      status('connected', `${symbol} on ${host} (${netId}:${adsPort}) (PLC ${plcState})`, {
        target: `${netId}:${adsPort}`, plcState, instance: chosen, instances: found, symbolType: info.type, route,
      });
      return { symbol, netId, adsPort };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await release(s);
      if (session === s) session = null;
      if (message !== 'stopped') status('error', message, { instances: found, route });
      return null;
    }
  }

  /** The watched values, the queued samples every 50 ms, and the PLC's state every 2 s */
  function startTimers(s, send, status) {
    s.vars = new VarWatcher(s.client, send);
    if (s.desired) s.vars.set(s.desired);
    s.timer = setInterval(() => {
      if (s.queue.length) send({ type: 'liveValues', events: s.queue.splice(0) });
      const values = s.vars?.drain();
      if (values) send({ type: 'liveVars', values });
    }, 50);
    s.stateTimer = setInterval(async () => {
      try {
        const st = ads.ADS_STATES[(await s.client.readState()).adsState] ?? 'unknown';
        if (s.id === sessionId) send({ type: 'liveStatus', state: 'plcState', plcState: st });
      } catch (err) {
        status('lost', `Connection lost: ${ads.adsErrorText(err)}`);
      }
    }, 2000);
  }

  async function release(s) {
    clearInterval(s.timer);
    clearInterval(s.stateTimer);
    const client = s.client;
    if (s.vars) await s.vars.close();
    try {
      if (s.subscription) await client.unsubscribe(s.subscription);
      if (s.handle) await ads.releaseHandle(client, s.handle);
    } catch {
      // the connection may already be gone
    }
    try {
      await client.disconnect(true);
    } catch {
      // ignore
    }
  }

  /** Guard variables to follow in the running session (liveWatch): [{ id, candidates }]; false when malformed */
  function watch(vars) {
    const parsed = parseWatchRequest(vars);
    if (!parsed) return false;
    const s = session;
    if (!s) return true;
    if (s.vars) s.vars.set(parsed);
    else s.desired = parsed;
    return true;
  }

  /**
   * Symbol browser (liveBrowse): a symbol's members, one level, answered with liveBrowseResult. Only while connected;
   * req: { requestId, path, stateVar? }
   */
  async function browse(send, req) {
    const requestId = Number.isInteger(req?.requestId) ? req.requestId : 0;
    const symbolPath = typeof req?.path === 'string' ? req.path.trim() : '';
    const stateVar = typeof req?.stateVar === 'string' && /^[A-Za-z_]\w*$/.test(req.stateVar) ? req.stateVar : 'machineState';
    if (!ads.isSymbolPath(symbolPath)) return send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: 'Not a symbol path' });
    const s = session;
    if (!s || !s.connected) return send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: 'Not connected' });
    try {
      const node = await ads.browseSymbol(s.client, symbolPath, { stateVar, cache: s.dtCache });
      if (session === s) send({ type: 'liveBrowseResult', requestId, ...node });
    } catch (err) {
      if (session === s) send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: ads.adsErrorText(err) });
    }
  }

  /**
   * The PLC project's sources as the PLC keeps them (plcSources): answered with plcSourcesResult { project, files }
   * or { error }. Read once per connection (a few MB). Only while connected; req: { requestId, plcProject? } (another
   * PLC project on the same target)
   */
  async function sources(send, req) {
    const requestId = Number.isInteger(req?.requestId) ? req.requestId : 0;
    const s = session;
    if (!s || !s.connected) return send({ type: 'plcSourcesResult', requestId, error: 'Not connected' });
    try {
      const key = typeof req?.plcProject === 'string' ? req.plcProject.slice(0, 100) : '';
      s.sources ??= new Map();
      if (!s.sources.has(key)) s.sources.set(key, readPlcSources(s.client, s.adsPort ?? 851, { plcProject: key }));
      const r = await s.sources.get(key);
      if (r.error) s.sources.delete(key);
      if (session === s) send({ type: 'plcSourcesResult', requestId, ...r });
    } catch (err) {
      s.sources = null;
      if (session === s) send({ type: 'plcSourcesResult', requestId, error: ads.adsErrorText(err) });
    }
  }

  /**
   * Rebuild the PLC's project with the POUs edited here (plcBuild), in TwinCAT XAE on this computer; write it back when
   * asked (write: 'online' or 'activate', only without errors). Progress: plcBuildProgress { requestId, text }; the
   * result: plcBuildResult { requestId, ok, items, errors, warnings, fatal, written }. One at a time
   */
  let building = false;
  async function build(send, req) {
    const requestId = Number.isInteger(req?.requestId) ? req.requestId : 0;
    const s = session;
    if (!s || !s.connected) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'Not connected', items: [] });
    const bad = checkEdits(req);
    if (bad) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: bad, items: [] });
    if (building) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'A build is already running', items: [] });
    building = true;
    try {
      const r = await buildFromPlc(s.client, {
        edits: req.edits, plcProject: typeof req.plcProject === 'string' ? req.plcProject : '', write: req.write ?? null, netId: s.netId, adsPort: s.adsPort ?? 851,
        onStep: (text) => send({ type: 'plcBuildProgress', requestId, text }),
      });
      // (written: the PLC's code and sources change: read them again next time)
      if (r.written) s.sources = null;
      send({ type: 'plcBuildResult', requestId, ...r });
    } catch (err) {
      send({ type: 'plcBuildResult', requestId, ok: false, fatal: err?.message ?? String(err), items: [] });
    } finally {
      building = false;
    }
  }

  async function stop(notify, send) {
    sessionId++;
    const s = session;
    session = null;
    if (s) await release(s);
    if (notify && send) send({ type: 'liveStatus', state: 'stopped', message: 'Not connected' });
  }

  /** Close the XAE kept open for builds now (plcBuildClose → plcBuildClosed { closed }) */
  function closeBuild(send, req) {
    send({ type: 'plcBuildClosed', requestId: Number.isInteger(req?.requestId) ? req.requestId : 0, closed: closeXae() });
  }

  return { start, stop, watch, browse, sources, build, closeBuild };
}

module.exports = { createLiveSession, localIpTowards, defaultLocalNetId, localTwinCatNetId };
