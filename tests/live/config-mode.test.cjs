// A PLC whose TwinCAT is in Config mode (no PLC runtime: every ADS port but its system service is "not found"): going
// live and the Live tab's Check say so, not that a route is missing (the fake PLC's configMode)
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
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
