// Live (web edition through Link, simulated PLC changing state): the current state is marked on the canvas, in
// Identified States, in the Method Editor and in the Enum Editor, and nothing is moved to it (Follow is off by
// default); ticking Follow pans the canvas again
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = h.sleep;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const I = 'MAIN.smTable1';
// E_TableManager_States (the sample's .TcDUT): 0 DISABLED, 2 HOMMING_READY_TO_START, 3 HOMMING
const cfg = h.out('fake-ams2-nopan.json');
fs.writeFileSync(cfg, JSON.stringify({
  symbols: { [`${I}.machineState`]: { type: 'E_TableManager_States', dataType: 2, size: 2, value: 2 } },
  script: [3, 0, 2, 3, 0, 2, 3, 0, 2, 3].map((v) => ({ hold: 1500, set: { [`${I}.machineState`]: v } })),
}));
const NAME = { 0: 'TABLEMANAGER_DISABLED', 2: 'TABLEMANAGER_HOMMING_READY_TO_START', 3: 'TABLEMANAGER_HOMMING' };

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48967', cfg], { stdio: 'ignore' });
  const linkOut = h.out('link-nopan-run.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48968'], { env: { ...process.env, APPDATA: h.out('link-appdata') }, stdio: ['ignore', fs.openSync(linkOut, 'w'), fs.openSync(linkOut, 'a')] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');

  const browser = await h.launchBrowser();
  const a = await browser.newPage();
  const errors = [];
  a.on('pageerror', (e) => errors.push(e.message));
  const set = (id, v) => a.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await sleep(600);

  // Where things are before going live
  const snapshot = () => a.evaluate(() => {
    const node = (id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? `${Math.round(r.x)},${Math.round(r.y)}` : null; };
    const list = document.querySelector('#state-list-item-TABLEMANAGER_DISABLED')?.closest('.overflow-y-auto, .overflow-auto');
    return {
      nodes: ['TABLEMANAGER_DISABLED', 'TABLEMANAGER_HOMMING', 'TABLEMANAGER_CLAMPED'].map(node).join(' '),
      listScroll: list ? Math.round(list.scrollTop) : null,
      sidebar: Math.round(document.getElementById('source-files-sidebar')?.scrollTop ?? 0),
      canvasLive: document.querySelector('#mermaid-canvas-area g.node.live-active-node')?.getAttribute('data-state-id') ?? null,
      listLive: document.querySelector('[id^="state-list-item-"][data-live="true"]')?.id.replace('state-list-item-', '') ?? null,
    };
  });
  const before = await snapshot();

  await a.click('#dock-tab-live');
  await sleep(300);
  expect(!(await a.$eval('#live-follow-toggle', (e) => e.checked)), 'Follow is off by default');
  expect(await a.evaluate(() => { const el = document.getElementById('states-live-follow-toggle'); return !!el && el.offsetParent !== null; }), 'Identified States shows Follow before going live');
  await set('live-token-input', code);
  await set('live-link-port-input', '48968');
  await set('live-netid-input', '127.0.0.1.1.1');
  await set('live-ip-input', '127.0.0.1:48967');
  await set('live-instance-input', I);
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-current-state', { timeout: 20000 });

  // Several transitions: the marks follow the state, the positions do not change
  const seen = new Set();
  let same = true;
  let marks = true;
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const cur = (await a.$eval('#live-current-state', (e) => e.textContent).catch(() => '')).trim();
    const s = await snapshot();
    if (cur) seen.add(cur);
    if (s.nodes !== before.nodes || s.listScroll !== before.listScroll || s.sidebar !== before.sidebar) same = false;
    if (cur && (s.canvasLive !== cur || s.listLive !== cur)) marks = false;
  }
  expect(seen.size >= 2, `the state changed: ${[...seen].join(' > ')}`);
  expect(marks, 'the canvas and Identified States mark the current state');
  expect(same, 'the canvas and Identified States did not move');

  // Method Editor: the current state's CASE label is marked; the code does not scroll to it
  await a.click('#dock-tab-method');
  await a.waitForSelector('#method-implementation-editor');
  await sleep(600);
  const editorState = (id) => a.evaluate((id) => {
    const ta = document.getElementById(id);
    const row = ta.closest('.relative.flex-1.min-h-0.flex').querySelector('[data-live-line]');
    const lines = ta.value.split('\n');
    return { scroll: Math.round(ta.scrollTop), band: !!document.getElementById(`${id}-live-line`), line: row ? parseInt(row.textContent.replace(/\D+/g, ''), 10) : null, text: row ? lines[parseInt(row.textContent.replace(/\D+/g, ''), 10) - 1] ?? '' : '' };
  }, id);
  let m0 = await editorState('method-implementation-editor');
  let mStill = true;
  let mMarks = true;
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    const cur = (await a.$eval('#live-current-state', (e) => e.textContent).catch(() => '')).trim();
    const m = await editorState('method-implementation-editor');
    if (m.scroll !== m0.scroll) mStill = false;
    if (cur && !(m.band && new RegExp(`\\b${cur}\\s*:`).test(m.text))) mMarks = false;
  }
  expect(mMarks, `the Method Editor marks the current state's CASE label (e.g. line ${m0.line}: "${m0.text.trim()}")`);
  expect(mStill, 'the Method Editor did not scroll');

  // Enum Editor: the current member is marked; the code does not scroll to it
  await a.click('#dock-tab-enum');
  await a.waitForSelector('#st-dut-editor');
  await sleep(600);
  const e0 = await editorState('st-dut-editor');
  let eStill = true;
  let eMarks = true;
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    const cur = (await a.$eval('#live-current-state', (e) => e.textContent).catch(() => '')).trim();
    const e = await editorState('st-dut-editor');
    if (e.scroll !== e0.scroll) eStill = false;
    if (cur && !(e.band && new RegExp(`\\b${cur}\\b`).test(e.text))) eMarks = false;
  }
  expect(eMarks, `the Enum Editor marks the current member (e.g. "${e0.text.trim()}")`);
  expect(eStill, 'the Enum Editor did not scroll');
  await a.screenshot({ path: h.out('live-no-pan.png') });

  // Follow, from Identified States (the same setting as the Live tab's): the list and the canvas follow the state
  await a.click('#dock-tab-diagram');
  await a.click('#dock-tab-live');
  await sleep(300);
  expect(!!(await a.$('#states-live-follow-toggle')) && !(await a.$eval('#states-live-follow-toggle', (e) => e.checked)), 'Identified States has Follow (off)');
  // The list scrolled away from the live state first
  await a.evaluate(() => {
    const list = document.querySelector('#state-list-item-TABLEMANAGER_DISABLED')?.closest('.overflow-y-auto, .overflow-auto');
    if (list) list.scrollTop = list.scrollHeight;
  });
  await sleep(300);
  await a.click('#states-live-follow-toggle');
  await sleep(300);
  expect(await a.$eval('#live-follow-toggle', (e) => e.checked), 'ticking it there ticks Follow in the Live tab too');
  let inView = false;
  for (let i = 0; i < 12 && !inView; i++) {
    await sleep(500);
    inView = await a.evaluate(() => {
      const item = document.querySelector('[id^="state-list-item-"][data-live="true"]');
      const list = item?.closest('.overflow-y-auto, .overflow-auto');
      if (!item || !list) return false;
      const r = item.getBoundingClientRect(), l = list.getBoundingClientRect();
      return r.top >= l.top - 1 && r.bottom <= l.bottom + 1;
    });
  }
  expect(inView, 'with Follow the list shows the live state');
  const b1 = await snapshot();
  let moved = false;
  for (let i = 0; i < 12 && !moved; i++) {
    await sleep(500);
    if ((await snapshot()).nodes !== b1.nodes) moved = true;
  }
  expect(moved, 'with Follow ticked the canvas pans to the state');
  expect(await a.evaluate(() => localStorage.getItem('kss.liveFollow')) === '1', 'Follow is remembered');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  await browser.close();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
