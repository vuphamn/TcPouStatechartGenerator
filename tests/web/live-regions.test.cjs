// Live parallel regions (web edition through Link, simulated PLC): a fork / join made on the canvas in smTable1's
// state; live, the state (a cluster) glows and each region's current state is marked, from the region variables the
// PLC has; a region moving on moves its mark
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { R, config } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;
const MIME = 'application/x-kss-statechart-element';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const a = await browser.newPage();
  const errors = [];
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  const F = S('HOMMING_READY_TO_START');

  // The fork on F: regions A (A_RUN, A_DONE) and B (B_RUN, B_DONE), then HOMMING
  await a.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), F);
  await h.sleep(1200);
  const b = await a.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, F);
  await a.evaluate((x, y, MIME) => {
    const dt = new DataTransfer();
    dt.setData(MIME, 'forkjoin');
    const el = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, b.x, b.y, MIME);
  await a.waitForSelector('#forkjoin-dialog', { timeout: 5000 });
  await a.select('#forkjoin-target', S('HOMMING'));
  await a.click('#forkjoin-submit');
  await h.sleep(1500);

  // The enum's values (implicit: in order) of the regions' states
  await a.click('#dock-tab-enum');
  await a.waitForSelector('#st-dut-editor');
  await h.sleep(400);
  const dut = await a.$eval('#st-dut-editor', (e) => e.value);
  await a.click('#dock-tab-diagram');
  const members = dut
    .slice(dut.indexOf('(') + 1, dut.lastIndexOf(')'))
    .replace(/\(\*[\s\S]*?\*\)/g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\{[^}]*\}/g, '')
    .split(',')
    .map((x) => x.trim().match(/^([A-Za-z_]\w*)/)?.[1])
    .filter(Boolean);
  const value = (n) => members.indexOf(n);
  const A_RUN = `${F}_A_RUN`, A_DONE = `${F}_A_DONE`, B_DONE = `${F}_B_DONE`;
  expect(value(A_RUN) > 0 && value(B_DONE) > value(A_RUN), `the regions' states in the enum: ${A_RUN} = ${value(A_RUN)}, ${B_DONE} = ${value(B_DONE)}`);

  // The PLC: smTable1 in F (2), its regions in A_RUN and B_DONE; region A to A_DONE after 3 s
  const cfg = JSON.parse(JSON.stringify(config));
  cfg.symbols[`${R}.smTable1.regionA`] = { type: 'E_TableManager_States', dataType: 2, size: 2, value: value(A_RUN) };
  cfg.symbols[`${R}.smTable1.regionB`] = { type: 'E_TableManager_States', dataType: 2, size: 2, value: value(B_DONE) };
  cfg.script = [{ hold: 3000, set: { [`${R}.smTable1.regionA`]: value(A_DONE) } }];
  const cfgFile = h.out('fake-ams2-regions.json');
  fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48979', cfgFile], { stdio: 'ignore' });
  const linkOut = h.out('link-regions-run.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48980'], { env: { ...process.env, APPDATA: h.out('link-appdata') }, stdio: ['ignore', fs.openSync(linkOut, 'w'), fs.openSync(linkOut, 'a')] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');

  const set = (id, v) => a.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  await a.click('#dock-tab-live');
  await h.sleep(300);
  await set('live-token-input', code);
  await set('live-link-port-input', '48980');
  await set('live-netid-input', '127.0.0.1.1.1');
  await set('live-ip-input', '127.0.0.1:48979');
  await set('live-instance-input', `${R}.smTable1`);
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-current-state', { timeout: 20000 });
  const cls = () => a.evaluate((F, A_RUN, A_DONE, B_DONE) => {
    const node = (id) => document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    const cluster = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((c) => c.id.endsWith(`-${F}`) || c.id === F);
    return { cluster: !!cluster?.classList.contains('live-active-cluster'), aRun: !!node(A_RUN)?.classList.contains('live-region-node'), aDone: !!node(A_DONE)?.classList.contains('live-region-node'), bDone: !!node(B_DONE)?.classList.contains('live-region-node') };
  }, F, A_RUN, A_DONE, B_DONE);
  let c = {};
  for (let i = 0; i < 30; i++) { c = await cls(); if (c.cluster && c.aRun && c.bDone) break; await h.sleep(300); }
  expect(c.cluster, `live: ${F} (a cluster) glows`);
  expect(c.aRun && c.bDone && !c.aDone, `each region's state marked: ${JSON.stringify(c)}`);
  for (let i = 0; i < 30; i++) { c = await cls(); if (c.aDone) break; await h.sleep(300); }
  expect(c.aDone && !c.aRun && c.bDone, `region A moved on: ${JSON.stringify(c)}`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
