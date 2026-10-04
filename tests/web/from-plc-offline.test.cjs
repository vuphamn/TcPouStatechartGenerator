const h = require('../lib/harness.cjs');
// From PLC before going live (web edition through Link): a Target entered, not live: the Live tab offers From PLC; its
// list from the PLC's boot folder (fake-ams2.cjs with the project's sources); SM_Conveyor picked opens here from the
// PLC's sources, not live; then Go live on it. A sample with no instance on the PLC no longer stands in the way
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
        // Then live on it: the PLC's instance found
        await a.click('#dock-tab-live').catch(() => {});
        await sleep(300);
        await a.click('#live-start-btn').catch(() => {});
        let live = '';
        for (let i = 0; i < 60 && !/CONVEYOR_/.test(live); i++) { await sleep(300); live = await a.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
        expect(/CONVEYOR_/.test(live), `then Go live: on it (${live.trim()})`);
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
