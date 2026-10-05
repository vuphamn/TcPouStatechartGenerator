const h = require('../lib/harness.cjs');
// Browse (web edition through Link): a found PLC whose PLC is stopped offers Start PLC; asked first (what it drives may
// move), then started (fake-ams2.cjs: its state written); its badge Run. Its state read again while Browse is open:
// stopped from elsewhere (an ADS client of the test's own), the badge says Stop again within a few seconds
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('ads-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PLC = 48939;
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-browse-start.json', [], { adsState: 6 });

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(PLC), cfg], { stdio: 'ignore' });
  const finder = spawn(process.execPath, [path.join(h.FAKES, 'fake-discovery.cjs'), '48938'], { stdio: 'ignore' });
  const linkOut = path.join(h.OUT, 'link-browse-start.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48937'], {
    env: { ...process.env, APPDATA: path.join(h.OUT, 'link-browse-start-appdata'), KSS_DISCOVERY_PORT: '48938', KSS_DISCOVERY_BROADCAST: '0', KSS_DISCOVERY_ADS_PORT: String(PLC), KSS_LINK_UPDATES: 'off' },
    stdio: ['ignore', fs.openSync(linkOut, 'w'), fs.openSync(linkOut, 'a')],
  });
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  try {
    const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
    if (!code) throw new Error('Link did not start (no pairing code)');
    const a = await browser.newPage();
    const errors = [];
    a.on('pageerror', (e) => errors.push(e.message));
    const set = (id, v) => a.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
    await a.goto(h.APP_URL, { waitUntil: 'load' });
    await a.evaluate(() => localStorage.clear());
    await a.reload({ waitUntil: 'load' });
    await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await a.click('#dock-tab-live');
    await sleep(400);
    await set('live-token-input', code);
    await set('live-link-port-input', '48937');
    await set('live-local-netid-input', '127.0.0.1.1.1').catch(() => {});
    await a.click('#live-plc-browse');
    await a.waitForSelector('#live-plc-browser');
    await a.waitForSelector('#live-plc-none', { timeout: 8000 }).catch(() => {});
    await a.type('#live-plc-addresses', '127.0.0.1');
    await a.click('#live-plc-rescan');
    const row = '.live-plc-found[data-netid="127.0.0.2.1.1"]';
    const badge = () => a.$eval(`${row} .live-plc-state`, (e) => e.getAttribute('data-state')).catch(() => '');
    const waitBadge = async (want, ms) => {
      let b = '';
      for (let t = 0; t < ms && b !== want; t += 250) { await sleep(250); b = await badge(); }
      return b;
    };
    const stopped = await waitBadge('Stop', 10000);
    const start = await a.$('.live-plc-start[data-netid="127.0.0.2.1.1"]');
    const how = start ? await start.evaluate((e) => `${e.getAttribute('data-mode')}: ${e.textContent}`) : '';
    expect(stopped === 'Stop' && how === 'plc: Start PLC', `a stopped PLC: Start PLC offered (${stopped}; ${how})`);
    if (start) {
      await start.click();
      const form = await a.waitForSelector('#live-plc-start-form', { timeout: 3000 }).catch(() => null);
      const asked = form ? await form.evaluate((e) => e.textContent) : '';
      expect(/Start the PLC on CX-203\? .*may move/.test(asked), `asked first: "${asked.slice(0, 90)}"`);
      // (not started until confirmed)
      await sleep(600);
      expect((await badge()) === 'Stop', 'not started before it is confirmed');
      await a.click('#live-plc-start-confirm');
      await a.waitForSelector('#live-plc-start-result', { timeout: 20000 }).catch(() => {});
      const said = await a.$eval('#live-plc-start-result', (e) => `${e.getAttribute('data-ok')}|${e.textContent}`).catch(() => '');
      const run = await waitBadge('Run', 8000);
      expect(/^true\|Its PLC runs/.test(said) && run === 'Run' && !(await a.$('#live-plc-start-form')), `started: "${said}"; its badge ${run}`);
    }
    // Stopped from elsewhere: Browse shows it within a few seconds (read again every 5 s)
    const other = new Client({ targetAmsNetId: '127.0.0.1.1.1', targetAdsPort: 851, routerAddress: '127.0.0.1', routerTcpPort: PLC, localAmsNetId: '127.0.0.9.1.1', localAdsPort: 32911, rawClient: true, autoReconnect: false, hideConsoleWarnings: true });
    await other.connect();
    await other.writeControl('Stop', 0);
    await other.disconnect().catch(() => {});
    const again = await waitBadge('Stop', 12000);
    const marked = await a.$eval(`${row} .live-plc-state`, (e) => `${e.getAttribute('data-changed')}|${e.textContent}`).catch(() => '');
    expect(again === 'Stop' && !!(await a.$('.live-plc-start[data-netid="127.0.0.2.1.1"][data-mode="plc"]')), `stopped from elsewhere: shown again (${again}), Start PLC offered again`);
    expect(/^true\|Stop.*\(was Run\)/.test(marked), `marked as changed: "${marked}"`);
    // Started again: Stop PLC and Restart offered; Restart asked first, then done
    await a.click('.live-plc-start[data-netid="127.0.0.2.1.1"][data-mode="plc"]');
    await a.click('#live-plc-start-confirm').catch(() => {});
    await waitBadge('Run', 10000);
    const modes = await a.$$eval('.live-plc-start[data-netid="127.0.0.2.1.1"]', (els) => els.map((e) => e.getAttribute('data-mode')).join(','));
    expect(modes === 'stop,restart', `running: Stop PLC and Restart offered (${modes})`);
    await a.click('.live-plc-start[data-netid="127.0.0.2.1.1"][data-mode="restart"]').catch(() => {});
    const askedRestart = await a.$eval('#live-plc-start-form', (e) => e.textContent).catch(() => '');
    await a.click('#live-plc-start-confirm').catch(() => {});
    await a.waitForFunction(() => /restarted/.test(document.getElementById('live-plc-start-result')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
    const restarted = await a.$eval('#live-plc-start-result', (e) => e.textContent).catch(() => '');
    expect(/Restart the PLC on CX-203\? Its variables go back/.test(askedRestart) && /restarted and runs/.test(restarted), `Restart: asked, then "${restarted}"`);
    // History: what was done from here, newest first (kept in this browser)
    await a.click('#live-plc-history-btn').catch(() => {});
    const past = await a.$$eval('#live-plc-history .plc-action-entry', (els) => els.map((e) => `${e.getAttribute('data-mode')}:${e.getAttribute('data-ok')}`).join(' ')).catch(() => '');
    const pastText = await a.$eval('#live-plc-history', (e) => e.textContent).catch(() => '');
    expect(past === 'restart:true plc:true plc:true' && /CX-203/.test(pastText), `History: ${past}`);
    // Go live from its row: its Target set, and live
    await a.click('.live-plc-go-live[data-netid="127.0.0.2.1.1"]').catch(() => {});
    await a.waitForSelector('#live-stop-btn', { timeout: 20000 }).catch(() => {});
    // (the Target's field hidden while live: its status names it)
    const status = await a.$eval('#live-status', (e) => `${e.getAttribute('title') ?? ''} ${e.textContent}`).catch(() => '');
    expect(/127.0.0.2.1.1/.test(status) && !!(await a.$('#live-stop-btn')) && !(await a.$('#live-plc-browser')), `Go live from Browse: "${status.trim().slice(0, 120)}"`);
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    link.kill();
    plc.kill();
    finder.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
