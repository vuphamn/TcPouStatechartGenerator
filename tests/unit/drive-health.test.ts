// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The drive health board's pieces (gateway): drive profiles (which boxes are drives: Lenze i550 of any firmware, any
// maker's CiA 402 drive; not valve terminals, robots or Beckhoff's own), a CoE value decoded by its own size; the
// health rules (in fault, the heatsink near its limit, warmer than its own past and its siblings, more current at the
// same speed, i²t, new short circuits); and the shared notifications (sharedVars.cjs): one subscription per variable
// whoever wants it, released by the last one
/* eslint-disable @typescript-eslint/no-require-imports */
const { profilesOf, profileFor, decodeValue } = require('../../gateway/driveProfiles.cjs');
const { locateDrives } = require('../../gateway/drives.cjs');
const { evaluate, dayStats, baselineOf } = require('../../gateway/driveHealth.cjs');
const { SharedVars } = require('../../gateway/sharedVars.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const profiles = profilesOf([], () => {});
  const box = (name: string, vendorId: number, type: string) => ({ name, info: { vendorId, type, productCode: '#x69055000' } });
  const ids = [
    box('Face Inner Router VFD (Inverter i550 Cabinet)', 0x3b, 'i550 Inverter FW V05.02.xx'),
    box('Table 1 VFD (Inverter i550 Cabinet)', 0x3b, 'i550 Cabinet V06.04.xx'),
    box('HSD ES951 Spindle (ES95x)', 0x129, 'ES95x'),
    box('Saw Drive (Acme Inverter X2)', 0x777, 'Acme Inverter X2'),
    box('Q-A.0 to Q-A.19 (EX260-SEC1)', 0x114, 'EX260-SEC1 EtherCAT SI Unit (32DO_PNP) Rev1.2'),
    box('Robot Arm (FANUC R-30iB Plus)', 0x691, 'FANUC R-30iB Plus'),
    box('Edge X Axis (AX5112-0000-0203)', 2, 'AX5112 servo drive'),
  ].map((b) => profileFor(b, profiles)?.id ?? '-');
  expect(ids.join(' ') === 'lenze-i550 lenze-i550 hsd-es951 cia402 - - -', `which boxes are drives: ${ids.join(' ')}`);
  const own = profilesOf([{ id: 'acme', name: 'Acme', match: { vendorId: 0x999 }, params: [{ key: 'heatsink', index: '0x2001', sub: 1, size: 2, signed: true, scale: 0.1, unit: '°C' }] }], () => {});
  expect(profileFor({ name: 'X', info: { vendorId: 0x999 } }, own)?.id === 'acme' && own.length === 4, 'a profile of config.json\'s added');
  const p16 = { signed: true, size: 2, scale: 0.1 };
  expect(decodeValue(Buffer.from([0x34, 0x02, 0xff, 0xff]), p16)?.value === 56.400000000000006 || Math.abs(decodeValue(Buffer.from([0x34, 0x02, 0xff, 0xff]), p16).value - 56.4) < 1e-9, 'decoded by its own size (the padding left out)');
  expect(decodeValue(Buffer.from([0xfe, 0xff]), p16)?.raw === -2 && decodeValue(Buffer.from([0x10, 0x0e, 0, 0]), { signed: false, size: 4, scale: 1 / 3600 })?.raw === 3600, 'signed, unsigned, 4 bytes');

  // Health
  const lenze = profiles.find((p: { id: string }) => p.id === 'lenze-i550');
  const run = (heatsink: number, current = 5, freq = 50) => ({ t: 0, values: { heatsink, current, freq, dcBus: 560 } });
  const day = (hs: number, cur = 5) => dayStats([run(hs, cur), run(hs + 1, cur), run(hs - 1, cur), { t: 0, values: { heatsink: 25, current: 0, freq: 0, dcBus: 560 } }], lenze);
  const d = day(42);
  expect(d.heatsink.median === 42 && d.heatsink.n === 3 && Math.abs(d.currentPerHz.median - 0.1) < 1e-9, `a day: running samples only (the stopped one left out): heatsink ${d.heatsink.median}, current per Hz ${d.currentPerHz.median}`);
  const past = { '2026-10-01': day(41), '2026-10-02': day(42), '2026-10-03': day(43), '2026-10-04': day(42) };
  expect(baselineOf(past, 'heatsink')?.median === 42 && baselineOf({ a: day(1) }, 'heatsink') === null, 'its baseline: the median of its days, at least 3 days');
  const latest = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, t: 0 }]));
  const healthy = evaluate({ latest: latest({ heatsink: 42, heatsinkLimit: 80, error: 0, motorI2t: 30 }), today: day(42), past, peers: [{ today: day(43) }, { today: day(41) }], profile: lenze });
  expect(healthy.level === 'ok' && healthy.score === 100 && !healthy.findings.length, `healthy: ${healthy.level} ${healthy.score}`);
  const hot = evaluate({ latest: latest({ heatsink: 56, heatsinkLimit: 80, error: 0 }), today: day(56), past, peers: [{ today: day(43) }, { today: day(42) }], profile: lenze });
  expect(hot.level === 'warn' && hot.findings.some((f: { text: string }) => /14 °C warmer than its last 4 days/.test(f.text)) && hot.findings.some((f: { text: string }) => /hotter than its 2 siblings/.test(f.text)), `warmer than its past and its siblings: ${hot.findings.map((f: { text: string }) => f.text).join(' | ')}`);
  const fault = evaluate({ latest: latest({ heatsink: 77, heatsinkLimit: 80, error: 0x2250, motorI2t: 96, shortCircuits: 2 }), today: day(42), past, counters7d: { shortCircuits: 1 }, peers: [], profile: lenze });
  const texts = fault.findings.map((f: { text: string }) => f.text).join(' | ');
  expect(fault.level === 'alarm' && /In fault: error 0x2250/.test(texts) && /near its warning threshold/.test(texts) && /i²t 96 %: about to trip/.test(texts) && /1 new short circuit in 7 days/.test(texts) && fault.score === 0, `in fault: ${texts}`);
  const more = evaluate({ latest: latest({ heatsink: 42 }), today: day(42, 6.5), past, peers: [], profile: lenze });
  expect(more.findings.some((f: { level: string; text: string }) => f.level === 'warn' && /30 % more current at the same speed/.test(f.text)), `more current at the same speed: ${more.findings.map((f: { text: string }) => f.text).join(' | ')}`);
  // (no mains: not judged; its DC-bus error not a fault, another one is; most values not answering: not healthy)
  const noMains = evaluate({ latest: latest({ heatsink: 0, dcBus: 0, current: 0, error: 0x3222 }), today: {}, past, peers: [], profile: lenze });
  const noMainsFault = evaluate({ latest: latest({ heatsink: 0, dcBus: 2, error: 0x2250 }), today: {}, past, peers: [], profile: lenze });
  const partly = evaluate({ latest: { ...latest({ error: 0, opHours: 10 }), heatsink: { v: null, error: 'Invalid index offset' }, current: { v: null, error: 'Invalid index offset' }, dcBus: { v: null, error: 'Invalid index offset' } }, today: {}, past: {}, peers: [], profile: lenze });
  expect(noMains.level === 'off' && /No mains: DC bus 0 V \(error 0x3222/.test(noMains.findings[0]?.text) && noMains.findings.length === 1 && noMainsFault.level === 'alarm' && /0x2250/.test(noMainsFault.findings[0].text) && partly.level === 'watch' && /Only 1 of its 10 values answer/.test(partly.findings[0]?.text), `no mains: ${noMains.level} "${noMains.findings[0]?.text}"; with another fault: ${noMainsFault.level}; most not answering: ${partly.level} "${partly.findings[0]?.text}"`);
  // (the drives at their addresses: the master listing its slaves' addresses, or not: a scan; alike ones in order)
  const I550 = { vendorId: 0x3b, productCode: 0x69055000 };
  const bus: Record<number, { vendorId: number; productCode: number }> = { 1021: { vendorId: 2, productCode: 0x44c2c52 }, 1105: I550, 1106: I550, 1030: I550 };
  const read = async (_n: string, a: number) => {
    if (!bus[a]) throw new Error('Port not connected');
    return bus[a];
  };
  const drive = (name: string, address: number, slave: number) => ({ name, netId: 'm', address, slave, ...I550 });
  const scanned = [drive('Hinge 1 Router', 1021, 3), drive('Hinge 2 Router', 1087, 4), drive('Feed', 1030, 5)];
  await locateDrives({ list: scanned, slaves: null, maxAddress: 1110, read });
  const listed = [drive('Hinge 1 Router', 1021, 1), drive('Feed', 1030, 2)];
  await locateDrives({ list: listed, slaves: [{ address: 1001 }, { address: 1106 }, { address: 1030 }], maxAddress: 1110, read });
  const gone = [{ ...drive('Gone', 1099, 0), productCode: 0x1234 }];
  await locateDrives({ list: gone, slaves: null, maxAddress: 1050, read });
  const where = (l: { identity?: string; address: number }[]) => l.map((d) => `${d.address}:${d.identity}`).join(' | ');
  expect(where(scanned) === '1105:found at 1105, not 1021 (by order: alike ones) | 1106:found at 1106, not 1087 | 1030:checked' && where(listed) === '1106:found at 1106, not 1021 | 1030:checked' && /at none of the addresses 1001 to 1082 \(the master gives no addresses\); at its address 1099: Port not connected/.test((gone[0] as { notFound?: string }).notFound ?? ''), `the drives' addresses: a scan ${where(scanned)}; by their place on the bus ${where(listed)}; not found: ${(gone[0] as { notFound?: string }).notFound}`);
  const unread = evaluate({ latest: { heatsink: { v: null, error: 'timeout' } }, today: {}, past: {}, peers: [], profile: lenze });
  expect(unread.level === 'unknown' && /Not read: timeout/.test(unread.findings[0]?.text ?? ''), 'nothing read: unknown, with why');

  // Shared notifications: two users of one variable, one subscription; the last one releases it
  const calls: string[] = [];
  let notify: ((s: { t: number; v: unknown }) => void) | null = null;
  const ads = {
    probe: async (_c: unknown, p: string) => (/missing/.test(p) ? null : { size: 2, type: 'INT' }),
    isSimpleValue: () => true,
    createHandle: async (_c: unknown, p: string) => (calls.push(`handle ${p}`), 7),
    readTyped: async () => 1,
    subscribeTyped: async (_c: unknown, _h: number, _i: unknown, fn: (s: { t: number; v: unknown }) => void) => (calls.push('subscribe'), (notify = fn), { id: 1 }),
    releaseHandle: async () => calls.push('release'),
    dataTypeInfo: async () => null,
    adsErrorText: (e: Error) => e.message,
    findMember: async () => null,
  };
  const client = { unsubscribe: async () => calls.push('unsubscribe') };
  const shared = new SharedVars(client, ads);
  const a = shared.watcher(() => {});
  const b = shared.watcher(() => {});
  await a.set([{ id: 'x', candidates: ['MAIN.m.machineState'] }]);
  await b.set([{ id: 'machine', candidates: ['MAIN.M.MACHINESTATE'] }, { id: 'gone', candidates: ['MAIN.missing'] }]);
  expect(calls.filter((c) => c === 'subscribe').length === 1 && shared.stats().notifications === 1 && shared.stats().uses === 2, `one subscription for two users: ${calls.join(', ')}; ${JSON.stringify(shared.stats())}`);
  notify!({ t: 5, v: 3 });
  const ga = a.drain() ?? [];
  const gb = b.drain() ?? [];
  expect(ga.some((s: { id: string; v: unknown }) => s.id === 'x' && s.v === 3) && gb.some((s: { id: string; v: unknown }) => s.id === 'machine' && s.v === 3) && ga[0].v === 1, 'each user gets its first value and the changes, by its own id');
  await a.close();
  expect(!calls.includes('unsubscribe') && shared.stats().notifications === 1, 'one user gone: still followed for the other');
  await b.set([]);
  expect(calls.includes('unsubscribe') && calls.includes('release') && shared.stats().notifications === 0, 'the last one gone: unsubscribed, its handle released');

  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
