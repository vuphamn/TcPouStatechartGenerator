#!/usr/bin/env node
// Read-only check of a PLC's EtherCAT masters, with the app's own code (shared/tcEcat.cjs): the TwinCAT system's
// state, the PLC's, and each I/O device's slaves (their count, states, addresses, CRC counters) as the I/O tab reads
// them. Nothing is written. Needs an ADS route between this computer and the target (TwinCAT's router, or a route
// added on the target), as the app does.
//
//   node scripts/ecat-check.cjs --target 10.10.10.231.1.1 [--project <folder of its .tsproj, or of its solution>]
//                               [--device 10.10.10.231.2.1 ...] [--port 851] [--router 127.0.0.1:48898] [--json]
//
// The devices' AmsNetIds: --device, else the project's I/O devices (--project: read offline, as From project does),
// else the PLC's own (its boot folder's TwinCAT project, as the I/O tab reads it), else the usual first ones
// (x.x.x.x.2.1 … .5.1). Each device's boxes as configured are said beside what its master answers.
const path = require('path');
const { Client } = require('ads-client');
const { readMasters } = require('../shared/tcEcat.cjs');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const target = opt('target');
const NETID = /^\d+\.\d+\.\d+\.\d+\.\d+\.\d+$/;
if (!target || !NETID.test(target)) {
  console.error('Usage: node scripts/ecat-check.cjs --target <AmsNetId> [--project <folder>] [--device <AmsNetId> ...] [--port 851] [--router host:port] [--json]');
  process.exit(2);
}
const [routerHost, routerPort] = (opt('router') || '127.0.0.1:48898').split(':');
const plcPort = Number(opt('port')) || 851;
const asJson = args.includes('--json');

const client = (port) =>
  new Client({ targetAmsNetId: target, targetAdsPort: port, routerAddress: routerHost, routerTcpPort: Number(routerPort) || 48898, rawClient: true, autoReconnect: false, timeoutDelay: 4000, hideConsoleWarnings: true });
const errorOf = (e) => e?.adsError?.errorStr ?? e?.parent?.adsError?.errorStr ?? e?.message ?? String(e);

(async () => {
  const out = { target, system: null, plc: null, devices: [], configured: {}, devicesFrom: null, masters: {} };
  // (each device as configured: its name, its boxes; from the project or the PLC's own)
  const configure = (tree) => {
    const count = (boxes) => (boxes ?? []).reduce((n, b) => n + 1 + count(b.boxes), 0);
    for (const d of tree.devices ?? []) if (d.netId) out.configured[d.netId] = { name: d.name, boxes: count(d.boxes), disabled: !!d.disabled };
    return (tree.devices ?? []).filter((d) => d.netId && !d.disabled).map((d) => d.netId);
  };
  let devices = all('device').filter((d) => NETID.test(d));
  if (devices.length) out.devicesFrom = 'given';
  if (!devices.length && opt('project')) {
    const { readIoFolder } = require('../shared/tcIoTree.cjs');
    const tree = await readIoFolder(path.resolve(opt('project')));
    if (tree.error) console.error(`The project: ${tree.error}`);
    devices = configure(tree);
    out.project = tree.project;
    if (devices.length) out.devicesFrom = 'project';
  }

  const sys = client(10000);
  try {
    await sys.connect();
    const s = await sys.readState();
    out.system = s.adsStateStr ?? String(s.adsState);
    // (its TwinCAT build: the system service's device info, as the app reads it to choose the XAE)
    const info = await sys.readDeviceInfo({ adsPort: 10000 }).catch(() => null);
    out.twinCatBuild = info?.majorVersion === 3 && info.minorVersion === 1 ? info.versionBuild : null;
    // (the PLC's own I/O devices: its boot folder's project, read as the I/O tab does)
    if (!devices.length) {
      try {
        const { readIoTree } = require('../shared/tcIoTree.cjs');
        const { readBootFile } = require('../shared/tcSources.cjs');
        const tree = await readIoTree((rel) => readBootFile(sys, rel));
        if (tree.error && !tree.devices?.length) console.error(`The PLC's I/O: ${tree.error}`);
        devices = configure(tree);
        out.project ??= tree.project;
        if (devices.length) out.devicesFrom = 'plc';
      } catch (e) {
        console.error(`The PLC's I/O: ${errorOf(e)}`);
      }
    }
    // (devices configured, all of them disabled: no master runs to ask; else none configured: the usual first ones)
    if (!devices.length && Object.keys(out.configured).length) out.devicesFrom = 'disabled';
    else if (!devices.length) {
      const base = target.split('.').slice(0, 4).join('.');
      devices = [2, 3, 4, 5].map((n) => `${base}.${n}.1`);
      out.devicesFrom = 'guessed';
    }
    out.devices = devices;
    Object.assign(out, await readMasters(sys, target, devices));
  } catch (e) {
    out.system = { error: errorOf(e) };
  } finally {
    await sys.disconnect().catch(() => {});
  }
  const plc = client(plcPort);
  try {
    await plc.connect();
    const s = await plc.readState();
    out.plc = s.adsStateStr ?? String(s.adsState);
  } catch (e) {
    out.plc = { error: errorOf(e) };
  } finally {
    await plc.disconnect().catch(() => {});
  }

  if (asJson) return console.log(JSON.stringify(out, null, 2));
  const text = (v) => (typeof v === 'string' ? v : v?.error ? `error: ${v.error}` : '—');
  console.log(`${target}${out.project ? ` (${out.project})` : ''}: TwinCAT${out.twinCatBuild ? ` 3.1.${out.twinCatBuild}` : ''} ${text(out.system)}, PLC (port ${plcPort}) ${text(out.plc)}${out.devicesFrom ? `; devices ${{ given: 'as given', project: "from the project", plc: "from the PLC's own I/O", guessed: 'guessed (none configured)', disabled: 'all disabled in its configuration' }[out.devicesFrom]}` : ''}`);
  if (out.devicesFrom === 'disabled') {
    for (const [id, d] of Object.entries(out.configured)) console.log(`  ${id} (${d.name}, ${d.boxes} boxes configured): disabled in the configuration, no EtherCAT master runs for it`);
  }
  for (const id of out.devices) {
    const m = out.masters?.[id];
    if (!m) continue;
    const conf = out.configured[id];
    const label = conf ? `${id} (${conf.name}, ${conf.boxes} boxes configured)` : id;
    if (m.error) {
      console.log(`  ${label}: ${m.error}`);
      continue;
    }
    const notOp = m.slaves.filter((s) => !s.ok);
    console.log(`  ${label}: ${m.count} slaves, ${notOp.length ? `${notOp.length} not in OP` : 'all in OP'}${m.slaves.some((s) => s.address !== undefined) ? ' (addresses read)' : ''}${m.slaves.some((s) => s.crc) ? ' (CRC counters read)' : ''}`);
    for (const s of m.slaves) {
      const crc = s.crc && s.crc.some((n) => n) ? `  CRC ${s.crc.join('/')}` : '';
      if (!s.ok || crc) console.log(`    #${s.index}${s.address !== undefined ? ` @${s.address}` : ''}: ${s.name}${s.link ? ` (${s.link})` : ''}${crc}`);
    }
  }
})().catch((e) => {
  console.error(errorOf(e));
  process.exit(1);
});
