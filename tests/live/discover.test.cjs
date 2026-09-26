const h = require('../lib/harness.cjs');
// shared/tcAds.cjs discoverInstances against fake-ams.cjs
const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('ads-client');
const ads = require(path.join(h.REPO, 'shared/tcAds.cjs'));
(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams.cjs'), '48952', 'MAIN.mainStateMachine.smTableManager.machineState', '1:10'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));
  let fails = 0;
  const client = new Client({ targetAmsNetId: '127.0.0.1.1.1', targetAdsPort: 851, routerAddress: '127.0.0.1', routerTcpPort: 48952, localAmsNetId: '10.9.9.9.1.1', localAdsPort: 32905, rawClient: true, autoReconnect: false, hideConsoleWarnings: true });
  await client.connect();
  const paths = await ads.discoverInstances(client, 'SM_TableManager');
  const expected = ['MAIN.mainStateMachine.smTableManager', 'MAIN.mainStateMachine.smHinge.smInner', 'MAIN.mainStateMachine.smHinge.smFromBase', 'GVL_Test.aTables[1]', 'GVL_Test.aTables[2]', 'GVL_Test.cfg.aSpare[0]', 'GVL_Test.cfg.aSpare[1]'];
  console.log(paths);
  const same = JSON.stringify([...paths].sort()) === JSON.stringify([...expected].sort());
  if (!same) fails++;
  console.log(same ? 'ok   discovery matches' : 'FAIL discovery');
  const valid = ['MAIN.a.b', 'GVL.aT[2].x', 'MAIN'].every(ads.isSymbolPath) && !['MAIN;x', 'a..b', 'x]', '1abc', 'a.b ', 'a[x]'].some(ads.isSymbolPath);
  if (!valid) fails++;
  console.log(valid ? 'ok   path validation' : 'FAIL path validation');
  await client.disconnect(true);
  plc.kill();
  process.exit(fails ? 1 : 0);
})();
