const h = require('../lib/harness.cjs');
// From PLC before going live (web edition through Link): a Target entered, not live: the Live tab offers From PLC; its
// list from the PLC's boot folder (fake-ams2.cjs with the project's sources); SM_Conveyor picked opens here from the
// PLC's sources, and live on its one instance there (read before connecting). A sample with no instance on the PLC no
// longer stands in the way. From PLC again for SM_TableManager (two instances on the PLC), while live: which one once
// live again; the second picked: live on it. Stopped, From PLC for it once more: which one before connecting (Escape:
// opened, not live); then picked: live on it
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-from-plc-offline.json', [], { sources: true });

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48958', cfg], { stdio: 'ignore' });
  const outFile = path.join(h.OUT, 'link-from-plc-offline.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48965'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata-fromplc') }, stdio: ['ignore', fs.openSync(outFile, 'w'), 'ignore'] });
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  try {
    const code = (await h.waitForText(outFile, /Pairing code:\s+(\S+)/))?.[1];
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
    expect(!(await a.$('#live-open-from-plc-btn')), 'no Target yet: no From PLC');
    await set('live-token-input', code);
    await set('live-link-port-input', '48965');
    await set('live-netid-input', '127.0.0.1.1.1');
    await set('live-ip-input', '127.0.0.1:48958');
    await set('live-local-netid-input', '127.0.0.1.1.1').catch(() => {});
    await sleep(400);
    const offered = await a.waitForSelector('#live-open-from-plc-btn', { timeout: 5000 }).catch(() => null);
    const state = await a.$eval('#live-status', (e) => e.textContent).catch(() => '');
    expect(!!offered && !/^\s*(connected|live)/i.test(state), `a Target entered, not live: From PLC offered (${state.trim().slice(0, 60)})`);
    if (offered) {
      await a.click('#live-open-from-plc-btn');
      const picker = await a.waitForSelector('#plc-pou-picker-input', { timeout: 20000 }).catch(() => null);
      const listed = await a.evaluate(() => document.body.innerText.match(/SM_Conveyor|SM_TableManager/g) ?? []);
      expect(!!picker && listed.includes('SM_Conveyor'), `the PLC's POUs listed, read from its boot folder (${[...new Set(listed)].join(', ')})`);
      if (picker) {
        await a.type('#plc-pou-picker-input', 'conveyor', { delay: 5 });
        await sleep(200);
        await a.keyboard.press('Enter');
        const opened = await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="CONVEYOR_RUNNING"]', { timeout: 20000 }).catch(() => null);
        const said = await a.$eval('#status-message', (e) => e.textContent).catch(() => '');
        expect(!!opened && /from the PLC|differs from its sources/.test(said), `SM_Conveyor opened from the PLC's sources (${said.trim().slice(0, 90)})`);
        // Live on it by itself: its one instance on the PLC, read before connecting
        await a.click('#dock-tab-live').catch(() => {});
        let live = '';
        for (let i = 0; i < 60 && !/CONVEYOR_/.test(live); i++) { await sleep(300); live = await a.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
        const followed1 = await a.$eval('#live-status', (e) => e.getAttribute('title') ?? e.textContent).catch(() => '');
        expect(/CONVEYOR_/.test(live) && !(await a.$('#live-instance-picker')), `live on its one instance, nothing asked (${live.trim()}; ${followed1.slice(0, 60)})`);
        // From PLC again: SM_TableManager, two instances on the PLC: which one
        await a.click('#live-open-from-plc-btn').catch(() => {});
        await a.waitForSelector('#plc-pou-picker-input', { timeout: 20000 }).catch(() => {});
        await a.type('#plc-pou-picker-input', 'tablemanager', { delay: 5 });
        await sleep(200);
        await a.keyboard.press('Enter');
        const which = await a.waitForSelector('#live-instance-picker', { timeout: 30000 }).catch(() => null);
        const offered = which ? await a.evaluate(() => document.getElementById('live-instance-picker').innerText) : '';
        expect(!!which && /smTable1/.test(offered) && /smTable2/.test(offered), `once live, which instance (${offered.split('\n').filter((l) => /smTable/.test(l)).join(' | ')})`);
        if (which) {
          await a.type('#live-instance-picker input', 'smTable2', { delay: 5 }).catch(() => {});
          await sleep(200);
          await a.keyboard.press('Enter');
          let followed = '';
          for (let i = 0; i < 60 && !/smTable2/.test(followed); i++) { await sleep(300); followed = await a.$eval('#live-status', (e) => e.getAttribute('title') ?? e.textContent).catch(() => ''); }
          expect(/smTable2/.test(followed), `the second picked: live on it (${followed.slice(0, 80)})`);
        }
        // Stopped: From PLC for it once more: which one, before connecting
        await a.click('#live-stop-btn').catch(() => {});
        await a.waitForSelector('#live-start-btn', { timeout: 10000 }).catch(() => {});
        const fromPlc = async () => {
          await a.click('#live-open-from-plc-btn').catch(() => {});
          await a.waitForSelector('#plc-pou-picker-input', { timeout: 20000 }).catch(() => {});
          await a.type('#plc-pou-picker-input', 'tablemanager', { delay: 5 });
          await sleep(200);
          await a.keyboard.press('Enter');
          return a.waitForSelector('#live-instance-picker', { timeout: 30000 }).catch(() => null);
        };
        let before = await fromPlc();
        const notLive = await a.$eval('#live-status', (e) => e.textContent).catch(() => '');
        const asks = before ? await a.$eval('#live-instance-picker input', (e) => e.placeholder).catch(() => '') : '';
        expect(!!before && /go live on/.test(asks) && !/^\s*(connected|live)/i.test(notLive), `not live: which one, before connecting ("${asks.slice(0, 80)}"; ${notLive.trim().slice(0, 30)})`);
        if (before) {
          // (Escape: the POU opened all the same, not live)
          await a.keyboard.press('Escape');
          await sleep(1500);
          // (the window's title: the POU open)
          const title = await a.title();
          const still = await a.$('#live-start-btn');
          expect(/^SM_TableManager/.test(title) && !!still, `Escape: opened, not live ("${title}"; ${still ? 'Go live offered' : 'live'})`);
          before = await fromPlc();
          if (before) {
            await a.type('#live-instance-picker input', 'smTable1', { delay: 5 }).catch(() => {});
            await sleep(200);
            await a.keyboard.press('Enter');
            let on = '';
            for (let i = 0; i < 60 && !/smTable1/.test(on); i++) { await sleep(300); on = await a.$eval('#live-status', (e) => e.getAttribute('title') ?? e.textContent).catch(() => ''); }
            const picker = await a.$('#live-instance-picker');
            expect(/smTable1/.test(on) && !picker, `picked before connecting: live on it (${on.slice(0, 80)})`);
          }
        }
      }
    }
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    link.kill();
    plc.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
