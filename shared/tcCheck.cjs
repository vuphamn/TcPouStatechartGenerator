// The Live tab's Check: why a PLC does not answer, step by step, the way one would look by hand (all read-only):
//   this computer's side: the adapter towards the PLC and its Windows network profile (Public blocks incoming);
//   the network: ping, TwinCAT's search port (UDP 48899: its name, AMS NetId, TwinCAT version), the ADS port (TCP
//   48898); the NetId entered against the one the PLC gives; this computer's TwinCAT router (a route it has);
//   ADS itself: the PLC's state, with this computer's NetId (its route on the PLC).
// Used by the desktop app and Link (the PLCs are reached from the computer they run on).
const net = require('net');
const { execFile } = require('child_process');
const { Client } = require('ads-client');
const discovery = require('./tcDiscovery.cjs');
const { localIpTowards, defaultLocalNetId, localTwinCatNetId } = require('./liveSession.cjs');

const NETID = /^\d{1,3}(\.\d{1,3}){5}$/;
const run = (cmd, args, timeout = 6000) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? '') })));

/** Does the host answer a ping (ICMP; many firewalls drop it, so only a hint)? */
async function ping(host) {
  const r = await run('ping', process.platform === 'win32' ? ['-n', '1', '-w', '1500', host] : ['-c', '1', '-W', '2', host]);
  return r.ok && /TTL=|ttl=/i.test(r.out);
}

/** Does host:port accept a TCP connection (nothing sent)? */
function tcpOpen(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Windows' network profile (Public / Private / Domain) of the adapter with this address; null elsewhere */
async function networkProfile(address) {
  if (process.platform !== 'win32' || !address) return null;
  const script = `$i = (Get-NetIPAddress -IPAddress '${address.replace(/[^\d.]/g, '')}' -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex; if ($i) { $p = Get-NetConnectionProfile -InterfaceIndex $i -ErrorAction SilentlyContinue; if ($p) { [string]$p.InterfaceAlias + '|' + [string]$p.NetworkCategory } }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 8000);
  const [alias, category] = r.out.trim().split('|');
  return category ? { alias, category } : null;
}

/** The PLC's ADS state, through a client (one read); { ok, state } or { ok: false, error } */
async function adsState(options) {
  const c = new Client({ ...options, rawClient: true, autoReconnect: false, timeoutDelay: 2500, hideConsoleWarnings: true });
  try {
    await c.connect();
    const s = await c.readState();
    return { ok: true, state: s.adsStateStr ?? String(s.adsState) };
  } catch (err) {
    return { ok: false, error: err?.adsError?.errorStr ?? err?.message ?? String(err) };
  } finally {
    await c.disconnect().catch(() => {});
  }
}

/**
 * Checks the way to a PLC: { steps: [{ id, ok: true | false | null (not known / a hint), title, detail, fix? }],
 * verdict: the first failing step's advice (or that all is well), suggest?: { netId } (the PLC's own NetId) }
 */
async function checkConnection({ netId = '', ip = '', adsPort = 851, localNetId = '', discoveryPort = 48899 } = {}) {
  const steps = [];
  const add = (s) => steps.push(s);
  const [host, tcp] = (ip || String(netId).split('.').slice(0, 4).join('.')).trim().split(':');
  const tcpPort = Number(tcp) || 48898;
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host || '')) return { steps, verdict: 'Enter the PLC\'s IP address (or its AMS NetId)' };
  // (the PLC on this computer, through its TwinCAT router: not a simulated one on another port)
  const local = /^(127\.\d+\.\d+\.\d+|localhost)$/i.test(host) && tcpPort === 48898;

  // 1. This computer: the adapter towards the PLC, its network profile
  const myIp = localIpTowards(host);
  const myNetId = (localNetId || '').trim() || defaultLocalNetId(myIp);
  const profile = local ? null : await networkProfile(myIp);
  add({
    id: 'adapter', ok: profile?.category === 'Public' ? null : true,
    title: `This computer: ${myIp}${profile ? ` (${profile.alias}, ${profile.category} network)` : ''}, AMS NetId ${myNetId}`,
    detail: profile?.category === 'Public'
      ? 'Windows treats this network as Public: it blocks connections coming in. StateScope connects out, so it is not stopped by it, but XAE\'s routes (the PLC connecting back) are. Set it to Private: Settings > Network > the network > Private.'
      : 'The address the PLC sees, and the NetId its route must name.',
  });
  if (local) {
    const s = await adsState({ targetAmsNetId: netId || '127.0.0.1.1.1', targetAdsPort: adsPort, routerAddress: '127.0.0.1', routerTcpPort: 48898 });
    add({ id: 'ads', ok: s.ok, title: s.ok ? `The PLC on this computer answers (${s.state})` : 'The PLC on this computer does not answer', detail: s.ok ? '' : `${s.error}. Is TwinCAT running here (in Run mode), with a PLC on ADS port ${adsPort}?` });
    return { steps, verdict: s.ok ? 'All good: go live.' : steps[steps.length - 1].detail };
  }

  // 2. The network: ping, TwinCAT's search, the ADS port
  const [pinged, found, open] = await Promise.all([
    ping(host),
    discovery.discover({ localNetId: myNetId, addresses: [host], broadcast: false, port: discoveryPort, timeoutMs: 1800 }).then((r) => r.devices[0] ?? null).catch(() => null),
    tcpOpen(host, tcpPort),
  ]);
  add({ id: 'ping', ok: pinged ? true : null, title: pinged ? `${host} answers a ping` : `${host} does not answer a ping`, detail: pinged ? '' : 'Many firewalls drop pings: only a hint. The next steps tell more.' });
  add({
    id: 'search', ok: !!found, title: found ? `TwinCAT answers on ${host}: ${found.name || 'a device'}${found.twincat ? `, TwinCAT ${found.twincat}` : ''}, AMS NetId ${found.netId}` : `TwinCAT does not answer its search on ${host} (UDP 48899)`,
    detail: found ? '' : 'Either TwinCAT is not running there, or a firewall blocks UDP 48899 (Windows\' Public profile does). On that computer: set its network to Private, or allow UDP 48899 in.',
  });
  add({
    id: 'port', ok: open, title: open ? `The ADS port is open (TCP ${tcpPort})` : `The ADS port is closed (TCP ${tcpPort})`,
    detail: open ? '' : 'Nothing listens there or a firewall blocks it. On that computer: TwinCAT running, and TCP 48898 allowed in (the Private profile).',
  });

  // 3. The NetId entered against the PLC's own (a PC set up on another network keeps its old one)
  let suggest;
  if (found?.netId && NETID.test(netId) && found.netId !== netId) {
    suggest = { netId: found.netId };
    add({ id: 'netid', ok: false, title: `The AMS NetId does not match: ${host} is ${found.netId}, not ${netId}`, detail: `TwinCAT's NetId need not match the IP (it keeps the one it was set up with). Use ${found.netId} as the Target.`, fix: suggest });
  } else if (found?.netId && !NETID.test(netId)) {
    suggest = { netId: found.netId };
    add({ id: 'netid', ok: null, title: `${host}'s AMS NetId is ${found.netId}`, detail: 'Enter it as the Target.', fix: suggest });
  }
  const target = suggest?.netId ?? netId;

  // 4. This computer's TwinCAT router: a route it already has (XAE's) serves StateScope too
  const routerNetId = !(localNetId || '').trim() && tcpPort === 48898 ? localTwinCatNetId() : null;
  let viaRouter = null;
  if (routerNetId && NETID.test(target)) {
    viaRouter = await adsState({ targetAmsNetId: target, targetAdsPort: adsPort, routerAddress: '127.0.0.1', routerTcpPort: 48898 });
    add({
      id: 'router', ok: viaRouter.ok ? true : null,
      title: viaRouter.ok ? `This computer's TwinCAT router reaches it (${viaRouter.state}): StateScope uses its route` : 'This computer\'s TwinCAT router has no route to it',
      detail: viaRouter.ok ? '' : `Not needed: StateScope connects directly with ${myNetId}. (XAE's Add Route would make one here and on the PLC.)`,
    });
  }

  // 5. ADS: the PLC's state, with this computer's NetId (the route on the PLC)
  if (open && NETID.test(target) && !viaRouter?.ok) {
    const s = await adsState({ targetAmsNetId: target, targetAdsPort: adsPort, routerAddress: host, routerTcpPort: tcpPort, localAmsNetId: myNetId, localAdsPort: 32905 });
    add({
      id: 'ads', ok: s.ok, title: s.ok ? `The PLC answers (${s.state}) on ADS port ${adsPort}` : `The PLC does not answer ADS (port ${adsPort})`,
      detail: s.ok ? '' : `It has no route for this computer, or not on this port: add one on the PLC for AMS NetId ${myNetId}, IP ${myIp} (Browse > Add route, or TwinCAT's Router > Edit Routes there). ${s.error ? `(${s.error})` : ''}`.trim(),
    });
  }
  const failing = steps.find((s) => s.ok === false);
  const verdict = failing ? `${failing.title}. ${failing.detail}`.trim() : steps.some((s) => s.id === 'ads' || (s.id === 'router' && s.ok)) ? 'All good: go live.' : 'The PLC is reachable; enter its AMS NetId to check ADS.';
  return { steps, verdict, ...(suggest ? { suggest } : {}) };
}

module.exports = { checkConnection, tcpOpen, networkProfile };
