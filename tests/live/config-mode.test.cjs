// A PLC whose TwinCAT is in Config mode (no PLC runtime: every ADS port but its system service is "not found"): going
// live and the Live tab's Check say so, not that a route is missing (the fake PLC's configMode); a PLC only on port 852:
// its port told; an address on another network: the router between said
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  process.env.KSS_LOCAL_TWINCAT_NETID = 'none';
  const cfg = h.out('fake-ams2-configmode.json');
  fs.writeFileSync(cfg, JSON.stringify({ symbols: {}, configMode: true }));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48992', cfg], { stdio: 'ignore' });
  await h.sleep(600);
  const { createLiveSession } = require('../../shared/liveSession.cjs');
  const session = createLiveSession();
  const statuses = [];
  await session.start((m) => m.type === 'liveStatus' && statuses.push(m), { netId: '127.0.0.2.1.1', ip: '127.0.0.1:48992', stateVar: 'machineState', typeName: 'SM_X' });
  await session.stop(false);
  const error = statuses.find((m) => m.state === 'error')?.message ?? '';
  expect(/TwinCAT on 127\.0\.0\.2\.1\.1 answers, but nothing is on ADS port 851: TwinCAT there is in Config mode, so no PLC runs/.test(error) && !/Without a route/.test(error), `going live: "${error.slice(0, 120)}"`);

  const { checkConnection } = require('../../shared/tcCheck.cjs');
  const r = await checkConnection({ netId: '127.0.0.2.1.1', ip: '127.0.0.1:48992', discoveryPort: 48993 });
  const ads = r.steps.find((s) => s.id === 'ads');
  expect(ads?.ok === false && /Nothing on ADS port 851: TwinCAT there is in Config/.test(ads.title) && /Activate a configuration/.test(r.verdict), `the Check: "${ads?.title}"; verdict "${r.verdict.slice(0, 80)}"`);

  plc.kill();

  // A PLC only on ADS port 852: going live on 851 says which port it runs on (Use port), Check too
  const cfg2 = h.out('fake-ams2-port852.json');
  fs.writeFileSync(cfg2, JSON.stringify({ symbols: {}, plcPorts: [852] }));
  const plc2 = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48994', cfg2], { stdio: 'ignore' });
  await h.sleep(600);
  const statuses2 = [];
  const session2 = createLiveSession();
  await session2.start((m) => m.type === 'liveStatus' && statuses2.push(m), { netId: '127.0.0.2.1.1', ip: '127.0.0.1:48994', stateVar: 'machineState', typeName: 'SM_X' });
  await session2.stop(false);
  const err2 = statuses2.find((m) => m.state === 'error');
  expect(/nothing is on ADS port 851: its PLC runs on port 852 \(Run\)/.test(err2?.message ?? '') && JSON.stringify(err2?.ports) === '[{"port":852,"state":"Run"}]', `going live on 851, its PLC on 852: "${(err2?.message ?? '').slice(0, 110)}" (${JSON.stringify(err2?.ports)})`);
  const r2 = await checkConnection({ netId: '127.0.0.2.1.1', ip: '127.0.0.1:48994', discoveryPort: 48993 });
  expect(r2.suggest?.port === 852 && /its PLC runs on port 852/.test(r2.steps.find((s) => s.id === 'ads')?.title ?? '') && !r2.steps.some((s) => s.id === 'network'), `the Check: use port ${r2.suggest?.port} (no "other network" hint for this computer's own address)`);
  plc2.kill();

  // An address on no network of this computer's (TEST-NET-3, nothing there): the Check says the way goes through a router
  const r3 = await checkConnection({ ip: '203.0.113.5', discoveryPort: 48993 });
  expect(r3.steps.some((s) => s.id === 'network' && s.ok === null) && /goes through a router/.test(r3.verdict), `another network: "${r3.verdict.slice(0, 140)}"`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
