#!/usr/bin/env node
// Read-only check of a PLC's EtherCAT masters, with the app's own code (shared/tcEcat.cjs): the TwinCAT system's
// state, the PLC's, and each I/O device's slaves (their count, states, addresses, CRC counters) as the I/O tab reads
// them. Nothing is written. Needs an ADS route between this computer and the target (TwinCAT's router, or a route
// added on the target), as the app does.
//
//   node scripts/ecat-check.cjs --target 10.10.10.231.1.1 [--project <folder of its .tsproj, or of its solution>]
//                               [--device 10.10.10.231.2.1 ...] [--port 851] [--router 127.0.0.1:48898] [--json]
//
// The devices' AmsNetIds: --device, else the project's I/O devices (read offline, as From project does), else the
// usual first ones (x.x.x.x.2.1 … .5.1).
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
  const out = { target, system: null, plc: null, devices: [], masters: {} };
  // (the devices: given, the project's, or the usual first ones)
  let devices = all('device').filter((d) => NETID.test(d));
  if (!devices.length && opt('project')) {
    const { readIoFolder } = require('../shared/tcIoTree.cjs');
    const tree = await readIoFolder(path.resolve(opt('project')));
    if (tree.error) console.error(`The project: ${tree.error}`);
    devices = (tree.devices ?? []).filter((d) => d.netId && !d.disabled).map((d) => d.netId);
    out.project = tree.project;
  }
  if (!devices.length) {
    const base = target.split('.').slice(0, 4).join('.');
    devices = [2, 3, 4, 5].map((n) => `${base}.${n}.1`);
  }
  out.devices = devices;

  const sys = client(10000);
  try {
    await sys.connect();
    const s = await sys.readState();
    out.system = s.adsStateStr ?? String(s.adsState);
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
  console.log(`${target}${out.project ? ` (${out.project})` : ''}: TwinCAT ${text(out.system)}, PLC (port ${plcPort}) ${text(out.plc)}`);
  for (const id of devices) {
    const m = out.masters?.[id];
    if (!m) continue;
    if (m.error) {
      console.log(`  ${id}: ${m.error}`);
      continue;
    }
    const notOp = m.slaves.filter((s) => !s.ok);
    console.log(`  ${id}: ${m.count} slaves, ${notOp.length ? `${notOp.length} not in OP` : 'all in OP'}${m.slaves.some((s) => s.address !== undefined) ? ' (addresses read)' : ''}${m.slaves.some((s) => s.crc) ? ' (CRC counters read)' : ''}`);
    for (const s of m.slaves) {
      const crc = s.crc && s.crc.some((n) => n) ? `  CRC ${s.crc.join('/')}` : '';
      if (!s.ok || crc) console.log(`    #${s.index}${s.address !== undefined ? ` @${s.address}` : ''}: ${s.name}${s.link ? ` (${s.link})` : ''}${crc}`);
    }
  }
})().catch((e) => {
  console.error(errorOf(e));
  process.exit(1);
});
