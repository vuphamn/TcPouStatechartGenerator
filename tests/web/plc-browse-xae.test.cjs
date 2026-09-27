const h = require('../lib/harness.cjs');
// The Live tab's Browse inside XAE, with a stand-in bridge answering discoverPlcs as the extension does (plcList: the
// project's target, routes, devices found; route / no route); a pick fills in the target; Remember keeps it, but a POU
// without a target keeps XAE's project target (empty) instead of the remembered one
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m);
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const load = (name) => toApp({ type: 'loadPou', source: { name, path: `C:\\\\proj\\\\${name}`, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\\\proj\\\\E_TableManager_States.TcDUT', content: sample.dut }] } });
  await page.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await load('SM_TableManager.TcPOU');
    else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'addRoute') {
      await toApp({ type: 'addRouteResult', requestId: m.requestId, ok: m.password === 'pw', message: m.password === 'pw' ? `Route added to ${m.name} (${m.netId}), both ways` : 'Not added: wrong password' });
    } else if (m.type === 'discoverPlcs') {
      setTimeout(() => toApp({
        type: 'plcList', requestId: m.requestId, projectTarget: '5.1.2.3.1.1', errors: [],
        devices: [
          { netId: '5.9.9.9.1.1', ip: '192.168.1.20', name: 'CX-Line202', twincat: '3.1.4026', os: 'Windows 10.0.17763', route: true, source: 'network' },
          { netId: '5.8.8.8.1.1', ip: '192.168.1.21', name: 'CX-<i>New</i>', twincat: '3.1.4024', os: '', route: false, source: 'network' },
          { netId: '5.7.7.7.1.1', ip: '10.0.0.7', name: 'Remote-Line', route: true, source: 'route' },
        ],
      }).catch(() => {}), 300);
    }
  });
  await page.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await h.sleep(800);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(500);

  await page.click('#live-plc-browse');
  await page.waitForFunction(() => document.querySelectorAll('.live-plc-found').length >= 4, { timeout: 5000 }).catch(() => {});
  const ask = sent.filter((m) => m.type === 'discoverPlcs').pop();
  expect(!!ask && Array.isArray(ask.addresses), 'discoverPlcs sent to the extension');
  const rows = await page.$$eval('.live-plc-found', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  expect(rows.length === 4 && /The project's target 5\.1\.2\.3\.1\.1 route/.test(rows[0]) && /CX-Line202 .* route$/.test(rows[1]) && /CX-<i>New<\/i> .* no route$/.test(rows[2]) && /Remote-Line 5\.7\.7\.7\.1\.1 10\.0\.0\.7 route/.test(rows[3]), `listed, route / no route marked: ${rows.join(' | ')}`);
  expect(!(await page.$('#live-plc-browser i')), 'a device name with markup: shown as text');
  // Add Route: offered only where XAE has none; sent to XAE with the credentials; then searched again
  const routeButtons = await page.$$eval('.live-plc-add-route', (b) => b.map((x) => x.getAttribute('data-netid')));
  expect(routeButtons.join() === '5.8.8.8.1.1', `Add route only for the device without a route: ${routeButtons.join()}`);
  const searches = sent.filter((m) => m.type === 'discoverPlcs').length;
  await page.click('.live-plc-add-route[data-netid="5.8.8.8.1.1"]');
  await page.waitForSelector('#live-route-password');
  await page.type('#live-route-password', 'pw');
  await page.click('#live-route-add');
  await page.waitForSelector('#live-route-result', { timeout: 5000 }).catch(() => {});
  const routeAsk = sent.filter((m) => m.type === 'addRoute').pop();
  expect(routeAsk?.netId === '5.8.8.8.1.1' && routeAsk.ip === '192.168.1.21' && routeAsk.user === 'Administrator' && routeAsk.password === 'pw', `addRoute sent to XAE: ${routeAsk?.netId} ${routeAsk?.ip} as ${routeAsk?.user}`);
  await h.sleep(800);
  expect(/Route added to CX-<i>New<\/i> \(5\.8\.8\.8\.1\.1\), both ways/.test(await page.$eval('#live-route-result', (e) => e.textContent).catch(() => '')) || sent.filter((m) => m.type === 'discoverPlcs').length > searches, 'added: the answer shown, and the list searched again');
  await page.waitForFunction(() => document.querySelectorAll('.live-plc-found').length >= 4, { timeout: 5000 }).catch(() => {});
  await page.click('.live-plc-found[data-netid="5.9.9.9.1.1"]');
  await h.sleep(300);
  expect((await page.$eval('#live-netid-input', (e) => e.value)) === '5.9.9.9.1.1' && !(await page.$('#live-ip-input')), 'picked: the target NetId (XAE has no PLC IP field)');
  await page.click('#live-plc-remember');
  await h.sleep(200);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kss.live.plcs') || '[]'));
  expect(stored.length === 1 && stored[0].name === 'CX-Line202', `remembered: ${stored.map((p) => p.name).join(', ')}`);

  // Go live: the picked target goes to the extension
  await page.click('#live-start-btn');
  await h.sleep(400);
  const start = sent.filter((m) => m.type === 'liveStart').pop();
  expect(start?.netId === '5.9.9.9.1.1', `liveStart with it: ${start?.netId}`);
  await toApp({ type: 'liveStatus', state: 'stopped', message: 'Not connected' });

  // Another POU without a target: XAE's project target stays (empty), not the remembered PLC
  await load('SM_Other.TcPOU');
  await h.sleep(1500);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(300);
  expect((await page.$eval('#live-netid-input', (e) => e.value)) === '', 'another POU: the project target (empty), not the remembered one');
  await page.click('#live-plc-browse');
  await page.waitForSelector('.live-plc-remembered', { timeout: 3000 }).catch(() => {});
  expect((await page.$$('.live-plc-remembered')).length === 1, 'the remembered PLC is offered in Browse');
  await page.screenshot({ path: h.out('plc-browse-xae.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
