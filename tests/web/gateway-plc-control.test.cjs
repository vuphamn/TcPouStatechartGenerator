const h = require('../lib/harness.cjs');
// Web edition through a gateway (allowWrite, the tester among writeUsers), never live first: signed in as soon as the
// token is there, its two PLCs listed with their states (All PLCs); one chosen there: its state (read every few
// seconds); Stop PLC asked first, then stopped: its badge Stop, marked as changed (was Run); Start PLC again; its
// History (the gateway's audit log): both, by the tester. From PLC before going live: SM_TableManager has two
// instances there: which one before connecting; the second picked: live on it
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8473;
const PLC = 48930;

(async () => {
  const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-gw-control.json', [], { sources: true });
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(PLC), cfg], { stdio: 'ignore' });
  const gwDir = h.out('gw-control');
  fs.rmSync(gwDir, { recursive: true, force: true });
  fs.mkdirSync(gwDir, { recursive: true });
  const gwConfig = path.join(gwDir, 'config.json');
  fs.writeFileSync(gwConfig, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [h.APP_ORIGIN, h.APP_ORIGIN.replace('localhost', '127.0.0.1')],
    allowWrite: true, writeUsers: ['tester'],
    plcs: [{ id: 'line', name: 'Line', netId: '127.0.0.1.1.1', ip: `127.0.0.1:${PLC}`, port: 851 }, { id: 'line2', name: 'Line 2', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48927', port: 851 }], tokens: [],
  }, null, 1));
  const token = execFileSync(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', gwConfig], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const gwLog = h.out('gw-control-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', gwConfig], { env: { ...process.env, KSS_SERVICE_DRYRUN: '1' }, stdio: ['ignore', fs.openSync(gwLog, 'w'), fs.openSync(gwLog, 'a')] });
  await sleep(1500);
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  try {
    const errors = [];
    const a = await browser.newPage();
    a.on('pageerror', (e) => errors.push(e.message));
    const set = async (id, v) => {
      await a.waitForSelector(`#${id}`, { timeout: 10000 }).catch(() => {});
      return a.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
    };
    await a.goto(h.APP_URL, { waitUntil: 'load' });
    await a.evaluate(() => localStorage.clear());
    await a.reload({ waitUntil: 'load' });
    await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await a.click('#dock-tab-live');
    await sleep(400);
    await a.click('#live-via-gateway').catch(() => {});
    await sleep(200);
    await set('live-gateway-input', `http://localhost:${PORT}`);
    await set('live-token-input', token);
    await a.click('#live-guards-off').catch(() => {});
    // Signed in, not live: its PLCs listed, each with its state (Line 2: nothing there)
    await a.waitForSelector('#live-gw-overview .live-gw-overview-row[data-plc="line"] .live-plc-state', { timeout: 20000 }).catch(() => {});
    await a.waitForSelector('#live-gw-overview .live-gw-overview-row[data-plc="line2"] .live-plc-state', { timeout: 15000 }).catch(() => {});
    const overview = await a.$$eval('#live-gw-overview .live-gw-overview-row', (rows) => rows.map((r) => `${r.getAttribute('data-plc')}:${r.querySelector('.live-plc-state')?.getAttribute('data-state') ?? ''}`).join(' '));
    const statusText = await a.$eval('#live-status', (e) => e.textContent).catch(() => '');
    expect(overview === 'line:Run line2:error' && !!(await a.$('#live-start-btn')), `signed in, never live: all its PLCs (${overview}; "${statusText.trim().slice(0, 50)}")`);
    // One chosen there
    await a.click('#live-gw-overview .live-gw-overview-row[data-plc="line"]').catch(() => {});
    const row =await a.waitForSelector('#live-gw-plc-state', { timeout: 15000 }).catch(() => null);
    const badge = () => a.$eval('#live-gw-plc-state', (e) => `${e.getAttribute('data-state')}|${e.getAttribute('data-changed') ?? ''}|${e.textContent}`).catch(() => '');
    const waitBadge = async (re, ms) => {
      let b = '';
      for (let t = 0; t < ms && !re.test(b); t += 250) { await sleep(250); b = await badge(); }
      return b;
    };
    const run = await waitBadge(/^Run\|/, 8000);
    const offered = await a.$$eval('.live-gw-plc-control', (els) => els.map((e) => e.getAttribute('data-mode')).join(','));
    expect(!!row && /^Run\|\|Run · Plant/.test(run) && offered === 'stop,restart', `not live: the chosen PLC's state (${run}); offered: ${offered}`);
    // Stop PLC: asked first, then stopped
    await a.click('.live-gw-plc-control[data-mode="stop"]').catch(() => {});
    const asked = await a.$eval('#live-gw-plc-control-form', (e) => e.textContent).catch(() => '');
    expect(/Stop the PLC on Line\?/.test(asked) && /^Run/.test(await badge()), `asked first: "${asked.slice(0, 60)}"`);
    await a.click('#live-gw-plc-control-confirm').catch(() => {});
    await a.waitForSelector('#live-gw-plc-control-result', { timeout: 15000 }).catch(() => {});
    const said = await a.$eval('#live-gw-plc-control-result', (e) => `${e.getAttribute('data-ok')}|${e.textContent}`).catch(() => '');
    const stopped = await waitBadge(/^Stop\|true\|/, 8000);
    expect(/^true\|Its PLC is stopped/.test(said) && /^Stop\|true\|.*was Run/.test(stopped), `stopped: "${said}"; its badge ${stopped}`);
    expect(/plc: tester stopped line: Stop/.test(fs.readFileSync(gwLog, 'utf8')), 'the gateway logs who stopped it');
    // Start PLC again
    await a.click('.live-gw-plc-control[data-mode="plc"]').catch(() => {});
    await a.click('#live-gw-plc-control-confirm').catch(() => {});
    const again = await waitBadge(/^Run\|/, 12000);
    expect(/^Run\|/.test(again), `started again: ${again}`);
    // Its history: the gateway's audit log, newest first
    await a.click('#live-gw-plc-history-btn').catch(() => {});
    await a.waitForSelector('#live-gw-plc-history .plc-action-entry', { timeout: 10000 }).catch(() => {});
    const past = await a.$$eval('#live-gw-plc-history .plc-action-entry', (els) => els.map((e) => `${e.getAttribute('data-mode')}:${e.getAttribute('data-ok')}:${e.textContent.includes('tester')}`).join(' '));
    expect(past === 'plc:true:true stop:true:true', `its history: ${past}`);

    // From PLC before going live: which instance, before connecting
    await a.click('#live-open-from-plc-btn').catch(() => {});
    await a.waitForSelector('#plc-pou-picker-input', { timeout: 20000 }).catch(() => {});
    await a.type('#plc-pou-picker-input', 'tablemanager', { delay: 5 });
    await sleep(200);
    await a.keyboard.press('Enter');
    const which = await a.waitForSelector('#live-instance-picker', { timeout: 30000 }).catch(() => null);
    const asks = which ? await a.$eval('#live-instance-picker input', (e) => e.placeholder).catch(() => '') : '';
    const notLive = !!(await a.$('#live-start-btn'));
    expect(!!which && /go live on/.test(asks) && notLive, `through the gateway, not live: which one first ("${asks.slice(0, 70)}")`);
    if (which) {
      await a.type('#live-instance-picker input', 'smTable2', { delay: 5 });
      await sleep(200);
      await a.keyboard.press('Enter');
      let on = '';
      for (let i = 0; i < 60 && !/smTable2/.test(on); i++) { await sleep(300); on = await a.$eval('#live-status', (e) => e.getAttribute('title') ?? e.textContent).catch(() => ''); }
      expect(/smTable2/.test(on), `the second picked: live on it (${on.slice(0, 80)})`);
    }
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    gw.kill();
    plc.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
