const h = require('../lib/harness.cjs');
// Web edition through Kval StateScope Link: Live > Symbols, values, Watch (same POU: a new tab with the connection)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const APP = h.REPO;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const R = 'MAIN.mainStateMachine';
// (aDoors[1] then goes round its states every 2.5 s: DISABLED -> ENABLING -> ERROR -> DISABLED ...: a learned diagram sees them)
const cycle = [];
for (let i = 0; i < 80; i++) cycle.push({ hold: 2500, set: { [`${R}.aDoors[1].machineState`]: 7 } }, { hold: 2500, set: { [`${R}.aDoors[1].machineState`]: 0 } }, { hold: 2500, set: { [`${R}.aDoors[1].machineState`]: 1 } });
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-sym.json', cycle, { sources: true });

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48968', cfg], { stdio: ['ignore', fs.openSync(path.join(h.OUT, 'fake-ams2-sym-web.txt'), 'w'), 'ignore'] });
  const out = fs.openSync(path.join(h.OUT, 'link-sym-run.txt'), 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48964'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-appdata') }, stdio: ['ignore', out, out] });
  await sleep(2500);
  const code = (await h.waitForText(path.join(h.OUT, 'link-sym-run.txt'), /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const row = (p, pth) => p.evaluate((pth) => { const r = document.querySelector(`.symbol-row[data-path="${pth}"]`); return r ? { text: r.textContent, value: r.querySelector('.symbol-value')?.textContent ?? null, watch: !!r.querySelector('.symbol-watch') } : null; }, pth);
  const waitRow = async (p, pth, test = () => true) => { let r = null; for (let i = 0; i < 50 && !(r && test(r)); i++) { await sleep(200); r = await row(p, pth); } return r; };
  const pages = async () => (await browser.pages()).filter((p) => p.url().startsWith(h.APP_ORIGIN));

  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await a.click('#live-token-remember');
  await set(a, 'live-link-port-input', '48964');
  await set(a, 'live-netid-input', '127.0.0.1.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48968');
  await set(a, 'live-instance-input', `${R}.smTable1`);
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-symbols-btn', { timeout: 20000 }).catch(() => {});
  await a.click('#live-symbols-btn');
  // The type filter: at first the loaded POU's type, the instances of it found under the root in one list
  await a.waitForSelector('#symbol-browser-type-filter', { timeout: 10000 }).catch(() => {});
  const instances = async () => {
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      const s = await a.$eval('#symbol-browser-search-status', (e) => e.textContent).catch(() => '');
      if (/^\d+ instances? of/.test(s)) break;
    }
    return a.$$eval('.symbol-instance-row', (r) => r.map((x) => `${x.getAttribute('data-path').split('.').pop()}${x.querySelector('.symbol-open-other') ? ':open' : x.querySelector('.symbol-watch') ? ':watch' : ':here'}`));
  };
  const typeValue = await a.$eval('#symbol-browser-type-filter', (e) => e.value).catch(() => '');
  const mine = await instances();
  expect(typeValue === 'SM_TableManager' && mine.join() === 'smTable1:here,smTable2:watch', `type filter "${typeValue}": ${mine.join(', ')} (${await a.$eval('#symbol-browser-search-status', (e) => e.textContent).catch(() => '-')})`);
  // (remembered for this PLC: shown at once next time, while it searches again)
  const kept = await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kss.symbols.found.')).map((k) => k + '=' + JSON.parse(localStorage.getItem(k)).map((c) => c.path.split('.').pop()).join(',')));
  expect(kept.includes('kss.symbols.found.127.0.0.1.1.1:851|main.mainstatemachine|sm_tablemanager=smTable1,smTable2'),`the results kept for the PLC: ${kept.join(' ')}`);
  await set(a, 'symbol-browser-type-filter', 'SM_DoorDasher');
  const doors = await instances();
  expect(doors.join() === 'aDoors[1]:open,aDoors[2]:open', `another type: ${doors.join(', ')} (Open: a new StateScope)`);
  await a.click('#symbol-browser-type-clear');
  await sleep(300);
  expect(!(await a.$('#symbol-browser-instances')) && !!(await a.$('#symbol-browser-tree .symbol-row')), 'cleared: the whole tree');
  const n = await waitRow(a, `${R}.nCount`, (r) => /^4[23]$/.test(r.value));
  const t2 = await row(a, `${R}.smTable2`);
  expect(/^4[23]$/.test(n?.value ?? '') && t2?.watch, `through Link: nCount=${n?.value}, smTable2 has Watch`);
  const watchTitle = await a.$eval('.symbol-watch', (e) => e.getAttribute('title'));
  expect(/new tab/.test(watchTitle), `Watch says "tab": ${watchTitle}`);

  // Watch smTable2 (the same POU, a sample here): a new tab with the connection, live on it
  await a.evaluate((p) => document.querySelector(`.symbol-row[data-path="${p}"] .symbol-watch`).click(), `${R}.smTable2`);
  let b;
  for (let i = 0; i < 40 && !b; i++) { await sleep(300); b = (await pages()).find((p) => p !== a); }
  let s2 = '';
  if (b) {
    b.on('pageerror', (e) => errors.push(e.message));
    await b.bringToFront();
    await b.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 }).catch(() => {});
    await b.click('#dock-tab-live').catch(() => {});
    for (let i = 0; i < 60 && !s2; i++) { await sleep(300); s2 = await b.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
  }
  const title = b ? await b.title() : '';
  expect(/SM_TableManager \(MAIN\.mainStateMachine\.smTable2\)/.test(title) && /TABLEMANAGER_HOMMING$/.test(s2), `a new tab: "${title}", live ${s2}`);

  // SM_DoorDasher (its source not at hand): Open offers to learn its diagram live; a new tab with the PLC's states,
  // live on aDoors[1], its transitions added as the PLC takes them
  await a.bringToFront();
  await set(a, 'symbol-browser-type-filter', 'SM_DoorDasher');
  for (let i = 0; i < 40 && !(await a.$(`.symbol-instance-row[data-path="${R}.aDoors[1]"] .symbol-open-other`)); i++) await sleep(250);
  await a.click(`.symbol-instance-row[data-path="${R}.aDoors[1]"] .symbol-open-other`);
  await a.waitForSelector('#text-prompt-learn-btn', { timeout: 5000 }).catch(() => {});
  const offer = await a.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
  expect(/Learn it live/.test(offer) && /Choose SM_DoorDasher\.TcPOU/.test(offer) && /3 states from the PLC/.test(offer) && /SM_DoorDasher is in the library Tc3_Doors/.test(offer), `Open SM_DoorDasher (no source): choose its .TcPOU or learn it live (${offer.replace(/\s+/g, ' ').slice(0, 90)})`);
  const before = (await pages()).length;
  // (seen before, with what changed just before it: bEnable twice; a candidate for its condition)
  await a.evaluate(() => localStorage.setItem('kss.seen.SM_DoorDasher', JSON.stringify({ 'DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING': { n: 2, last: 1, before: { bEnable: 2 } } })));
  await a.click('#text-prompt-learn-btn');
  let c;
  for (let i = 0; i < 40 && !c; i++) { await sleep(300); const all = await pages(); if (all.length > before) c = all[all.length - 1]; }
  let learned = { banner: '', states: [], edges: 0, live: '' };
  if (c) {
    c.on('pageerror', (e) => errors.push(e.message));
    await c.bringToFront();
    await c.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 }).catch(() => {});
    // (a few rounds of the PLC's states: each transition seen is added)
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      learned = await c.evaluate(() => ({
        banner: document.getElementById('canvas-learned-banner')?.textContent ?? '',
        states: [...new Set([...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')).filter((s) => /^DOOR_DASHER_/.test(s)))].sort(),
        edges: document.querySelectorAll('#mermaid-canvas-area path[data-source-id^="DOOR_DASHER_"]').length,
        live: document.getElementById('live-current-state')?.textContent ?? '',
      }));
      // (the banner first, the diagram drawn again after it)
      if (/[2-9]\d* transitions seen/.test(learned.banner) && learned.edges >= 2) break;
    }
  }
  expect(!!c && learned.states.join() === 'DOOR_DASHER_DISABLED,DOOR_DASHER_ENABLING,DOOR_DASHER_ERROR', `a new tab with the PLC's states: ${learned.states.join(', ')}`);
  expect(/^Learned live: no source\. ([2-9]|\d\d+) transitions seen so far/.test(learned.banner) && learned.edges >= 2, `live on it, the transitions it takes added: "${learned.banner.slice(0, 60)}" (${learned.edges} drawn)`);
  if (c) await c.screenshot({ path: h.out('learned-live.png') });
  const dirty = c ? await c.evaluate(() => /unsaved|Save \(\d/.test(document.getElementById('save-sources-btn')?.textContent ?? '')) : true;
  expect(!dirty, 'drawn again as they come: not an edit (nothing to save)');
  const notIn = c ? await c.evaluate(() => { document.getElementById('dock-tab-live')?.click(); return new Promise((r) => setTimeout(() => r(/d+ not in diagram/.test(document.body.innerText)), 600)); }) : true;
  expect(!notIn, 'the Live tab: its transitions are in the diagram (none "not in diagram")');
  // What changed just before a transition, as its condition: chosen from the state's menu, drawn on the diagram
  if (c) {
    await c.bringToFront();
    const chose = await c.evaluate(async () => {
      const node = document.querySelector('#mermaid-canvas-area g.node[data-state-id="DOOR_DASHER_DISABLED"]');
      const r = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.max(50, Math.min(innerWidth - 50, r.x + r.width / 2)), clientY: Math.max(50, Math.min(innerHeight - 50, r.y + r.height / 2)), button: 2 }));
      await new Promise((res) => setTimeout(res, 400));
      const btn = document.getElementById('context-menu-use-candidate-DOOR_DASHER_ENABLING-0-btn');
      const label = btn?.textContent.trim() ?? '';
      btn?.click();
      return label;
    });
    let drawn = false;
    for (let i = 0; i < 20 && !drawn; i++) {
      await sleep(300);
      drawn = await c.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area .edgeLabel')].some((l) => /\bbEnable\b/.test(l.textContent)));
    }
    const kept = await c.evaluate(() => JSON.parse(localStorage.getItem('kss.seen.SM_DoorDasher') || '{}')['DOOR_DASHER_DISABLED->DOOR_DASHER_ENABLING']?.condition);
    expect(/Its condition \(→ DOOR_DASHER_ENABLING\): bEnable/.test(chose) && drawn && kept === 'bEnable', `its condition chosen: "${chose}", on the diagram: ${drawn}, kept: ${kept}`);
  }
  // A transition seen by mistake: Forget (its menu); the learned diagram as a source to finish: Save as source
  if (c) {
    await c.bringToFront();
    const before = await c.evaluate(() => document.querySelectorAll('#mermaid-canvas-area path[data-source-id^="DOOR_DASHER_"]').length);
    // (a state's menu: each transition seen from it; the diagram may draw it to a group)
    const forgot = await c.evaluate(async () => {
      const seenKeys = Object.keys(JSON.parse(localStorage.getItem('kss.seen.SM_DoorDasher') || '{}'));
      const key = seenKeys[0];
      if (!key) return '';
      const [from, to] = key.split('->');
      const node = document.querySelector('#mermaid-canvas-area g.node[data-state-id="' + from + '"]');
      const r = node.getBoundingClientRect();
      node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.max(50, Math.min(innerWidth - 50, r.x + r.width / 2)), clientY: Math.max(50, Math.min(innerHeight - 50, r.y + r.height / 2)), button: 2 }));
      await new Promise((res) => setTimeout(res, 400));
      const btn = document.getElementById('context-menu-forget-seen-' + to + '-btn');
      if (!btn) return 'no Forget in ' + key;
      btn.click();
      return key;
    });
    await sleep(1500);
    const seenNow = await c.evaluate((k) => Object.values(JSON.parse(localStorage.getItem('kss.seen.SM_DoorDasher') || '{}')).length + '|' + Object.keys(JSON.parse(localStorage.getItem('kss.seen.SM_DoorDasher') || '{}')).includes(k), forgot);
    expect(/->/.test(forgot) && !/^no Forget/.test(forgot) && seenNow.endsWith('|false'), `Forget this transition (${forgot}): out of what was seen (${seenNow}), ${before} drawn before`);
    const saveBtn = await c.$('#canvas-learned-save-btn');
    await c.evaluate(() => document.getElementById('canvas-learned-save-btn')?.click());
    await sleep(1500);
    const after = await c.evaluate(() => ({ banner: !!document.getElementById('canvas-learned-banner'), file: document.getElementById('status-file')?.textContent ?? '' }));
    expect(!!saveBtn && !after.banner && /SM_DoorDasher/.test(after.file), `Save as source: a source now, not learned (banner ${after.banner ? "still shown" : "gone"}, ${after.file.trim()})`);
  }
  await set(a, 'symbol-browser-type-filter', '');

  // Here: another type's instance in this tab instead (its POU replaces this one; SM_DoorDasher's learned, live on
  // aDoors[2]), no new tab
  await a.bringToFront();
  await set(a, 'symbol-browser-type-filter', 'SM_DoorDasher');
  for (let i = 0; i < 40 && !(await a.$(`.symbol-instance-row[data-path="${R}.aDoors[2]"] .symbol-open-other-here`)); i++) await sleep(250);
  const pagesBefore = (await pages()).length;
  await a.click(`.symbol-instance-row[data-path="${R}.aDoors[2]"] .symbol-open-other-here`).catch(() => {});
  await a.waitForSelector('#text-prompt-learn-btn', { timeout: 8000 }).catch(() => {});
  await a.click('#text-prompt-learn-btn').catch(() => {});
  let here = '';
  for (let i = 0; i < 60 && !/SM_DoorDasher \(MAIN\.mainStateMachine\.aDoors\[2\]\)/.test(here); i++) { await sleep(300); here = await a.title(); }
  await a.evaluate(() => document.getElementById('dock-tab-live')?.click());
  let hereLive = '';
  for (let i = 0; i < 40 && !hereLive; i++) { await sleep(300); hereLive = await a.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
  expect(/SM_DoorDasher \(MAIN\.mainStateMachine\.aDoors\[2\]\)/.test(here) && /DOOR_DASHER_ERROR/.test(hereLive) && (await pages()).length === pagesBefore, `Here: "${here}", live ${hereLive}, no new tab (${(await pages()).length})`);

  // Closing the window stops following its values; a bad root is reported
  await a.bringToFront();
  await set(a, 'symbol-browser-root', 'MAIN.nothingHere');
  await a.click('#symbol-browser-root');
  await a.keyboard.press('Enter');
  let err = '';
  for (let i = 0; i < 40 && !err; i++) { await sleep(200); err = await a.$eval('#symbol-browser-error', (e) => e.textContent).catch(() => ''); }
  expect(/not in the PLC/.test(err), `unknown root: "${err}"`);
  await set(a, 'symbol-browser-root', R);
  await a.click('#symbol-browser-root');
  await a.keyboard.press('Enter');
  await waitRow(a, `${R}.nCount`);

  // From PLC (the Live tab): the PLC project's POUs, from its boot folder; one opened here
  await a.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(400);
  await a.click('#live-open-from-plc-btn');
  await a.waitForSelector('#plc-pou-picker', { timeout: 20000 }).catch(() => {});
  const pous = await a.$$eval('#plc-pou-picker .command-palette-item', (r) => r.map((x) => x.textContent.trim())).catch(() => []);
  expect(pous.length === 4 && /MAIN/.test(pous[0]) && /SM_Conveyor.*POUs\/Conveyor/.test(pous[1]) && /SM_TableManager/.test(pous[2]) && /Line2.*ADS port 852/.test(pous[3]), `From PLC: ${pous.join(' | ')}`);
  const staleShown = await a.evaluate(() => /differs from its sources \(SM_Conveyor/.test(document.body.innerText));
  expect(staleShown, 'the sources are older than the running code: said');
  // Another PLC project on the target: its POUs
  await a.type('#plc-pou-picker-input', 'line2', { delay: 5 });
  await sleep(200);
  await a.keyboard.press('Enter');
  let line2 = [];
  for (let i = 0; i < 40 && !line2.some((x) => /SM_Line2/.test(x)); i++) { await sleep(250); line2 = await a.$$eval('#plc-pou-picker .command-palette-item', (r) => r.map((x) => x.textContent.trim())).catch(() => []); }
  expect(line2.length === 2 && /SM_Line2/.test(line2[0]) && /Plant/.test(line2[1]), `Line2 chosen: ${line2.join(' | ')}`);
  await a.keyboard.press('Escape');
  await sleep(300);
  await a.click('#live-open-from-plc-btn');
  await a.waitForSelector('#plc-pou-picker', { timeout: 20000 }).catch(() => {});
  await a.type('#plc-pou-picker-input', 'conveyor', { delay: 5 });
  await sleep(200);
  await a.keyboard.press('Enter');
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="CONVEYOR_RUNNING"]', { timeout: 20000 }).catch(() => {});
  const conv = await a.evaluate(() => ({ states: [...new Set([...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id^="CONVEYOR_"]')].map((n) => n.getAttribute('data-state-id')))].sort().join(), file: document.body.innerText.match(/SM_Conveyor\.TcPOU/)?.[0] ?? '' }));
  expect(conv.states === 'CONVEYOR_RUNNING,CONVEYOR_STOPPED' && !!conv.file, `SM_Conveyor opened from the PLC's sources, with its enum: ${conv.states}`);
  await a.screenshot({ path: h.out('from-plc.png') });
  // Code help from the rest of the PLC's sources: Go to Symbol lists their types
  await a.evaluate(() => document.activeElement?.blur());
  await a.keyboard.down('Control'); await a.keyboard.press('KeyT'); await a.keyboard.up('Control');
  await a.waitForSelector('#symbol-search-input', { timeout: 5000 }).catch(() => {});
  await a.keyboard.type('SM_TableMan', { delay: 5 });
  await sleep(200);
  const syms = await a.$$eval('#symbol-search .command-palette-item', (r) => r.map((x) => x.textContent.trim())).catch(() => []);
  expect(syms.some((x) => /SM_TableManager/.test(x)), `Go to Symbol: the PLC project's other types (${syms.slice(0, 3).join(' | ')})`);
  await a.keyboard.press('Escape');
  await sleep(200);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  await browser.close().catch(() => {});
  edge.kill();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
