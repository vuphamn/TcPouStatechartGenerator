const h = require('../lib/harness.cjs');
// Browse (web edition through Link): the remembered PLCs each with their state, read when it opens and every few
// seconds: one runs; one runs no program because its TwinCAT trial license ran out (fake-ams2.cjs: ADS state 0, its
// license file five hours past): "license ran out", and Renew license: the steps, Open XAE, Check again (not clicked
// here: it would start XAE)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const OLD = 48926;
const GOOD = 48925;

(async () => {
  const plcs = [
    [OLD, writeSymbolsPlc('fake-ams2-renew-old.json', [], { adsState: 0, license: -5 })],
    [GOOD, writeSymbolsPlc('fake-ams2-renew-good.json', [], { license: 100 })],
  ].map(([port, cfg]) => spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(port), cfg], { stdio: 'ignore' }));
  const linkOut = path.join(h.OUT, 'link-renew.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48924'], {
    env: { ...process.env, APPDATA: path.join(h.OUT, 'link-renew-appdata'), KSS_DISCOVERY_PORT: '48923', KSS_DISCOVERY_BROADCAST: '0', KSS_LINK_UPDATES: 'off', KSS_BUILD_DRYRUN: '1' },
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
    await a.evaluate((OLD, GOOD) => {
      localStorage.clear();
      localStorage.setItem('kss.live.plcs', JSON.stringify([
        { name: 'Old line', netId: '127.0.0.3.1.1', ip: `127.0.0.1:${OLD}`, port: '851', localNetId: '', used: Date.now() },
        { name: 'Good line', netId: '127.0.0.4.1.1', ip: `127.0.0.1:${GOOD}`, port: '851', localNetId: '', used: Date.now() - 1000 },
      ]));
    }, OLD, GOOD);
    await a.reload({ waitUntil: 'load' });
    await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await a.click('#dock-tab-live');
    await sleep(400);
    await set('live-token-input', code);
    await set('live-link-port-input', '48924');
    // (paired: Link known, then Browse)
    await a.click('#live-plc-check').catch(() => {});
    await a.waitForSelector('#live-check-panel[data-state="done"]', { timeout: 30000 }).catch(() => {});
    await a.click('#live-plc-browse');
    await a.waitForSelector('#live-plc-browser');
    const badge = (netId) => a.$eval(`.live-plc-remembered[data-netid="${netId}"] .live-plc-state`, (e) => e.getAttribute('data-state')).catch(() => '');
    let old = '';
    let good = '';
    for (let i = 0; i < 60 && (!old || !good); i++) {
      await sleep(250);
      old = await badge('127.0.0.3.1.1');
      good = await badge('127.0.0.4.1.1');
    }
    expect(old === 'license ran out' && good === 'Run', `the remembered PLCs with their states: Old line ${old}, Good line ${good}`);
    const renew = await a.$('.live-plc-renew[data-netid="127.0.0.3.1.1"]');
    expect(!!renew && !(await a.$('.live-plc-renew[data-netid="127.0.0.4.1.1"]')), 'Renew license next to the one whose license ran out only');
    if (renew) {
      await renew.click();
      const steps = await a.waitForSelector('#live-plc-renew-steps', { timeout: 3000 }).catch(() => null);
      const text = steps ? await steps.evaluate((e) => e.textContent) : '';
      const buttons = `${!!(await a.$('#live-plc-renew-open-xae'))},${!!(await a.$('#live-plc-renew-recheck'))}`;
      expect(/SYSTEM › License/.test(text) && /7 Days Trial License/.test(text) && buttons === 'true,true', `the steps, Open XAE and Check again (${buttons})`);
      await a.click('#live-plc-renew-recheck').catch(() => {});
      await sleep(1500);
      expect((await badge('127.0.0.3.1.1')) === 'license ran out', 'checked again: still ran out');
    }
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    link.kill();
    plcs.forEach((p) => p.kill());
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
