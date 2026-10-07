// Extract to sub-machine on the canvas (the K-Test Station sample): TESTING and DONE selected (a click, Ctrl+click),
// their menu's Extract to sub-machine…, the method's name (Test): drawn as a new state, KTESTSTATION_TEST, with them
// inside it (their own names); the enum without them; Ctrl+Z: as before
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-test-station');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="KTESTSTATION_TESTING"]', { timeout: 30000 }).catch(() => {});
  await h.sleep(1500);
  const at = (id) => p.evaluate((id) => {
    const n = document.querySelector(`#mermaid-diagram-svg-container svg g.node[data-state-id="${id}"]`);
    const r = n?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, id);
  const waitFor = async (get, ok, ms = 10000) => {
    let v = await get();
    for (let t = 0; t < ms && !ok(v); t += 250) { await h.sleep(250); v = await get(); }
    return v;
  };

  const a = await at('KTESTSTATION_TESTING');
  const b = await at('KTESTSTATION_DONE');
  expect(!!a && !!b, 'TESTING and DONE on screen');
  if (a && b) {
    await p.mouse.click(a.x, a.y);
    await h.sleep(300);
    await p.keyboard.down('Control');
    await p.mouse.click(b.x, b.y);
    await p.keyboard.up('Control');
    await h.sleep(400);
    await p.mouse.click(a.x, a.y, { button: 'right' });
    await p.waitForSelector('#context-menu-multi-extract-sub-machine-btn', { timeout: 4000 }).catch(() => {});
    expect(!!(await p.$('#context-menu-multi-extract-sub-machine-btn')), 'their menu: Extract to sub-machine…');
    await p.click('#context-menu-multi-extract-sub-machine-btn').catch(() => {});
    await p.waitForSelector('#text-prompt-input', { timeout: 4000 }).catch(() => {});
    await p.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.focus(); i.select(); });
    await p.keyboard.type('Test');
    await p.keyboard.press('Enter');
  }
  const drawn = () => p.evaluate(() => ({
    sub: [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.node[data-state-id^="KTESTSTATION_TEST__Test__"]')].map((n) => n.getAttribute('data-state-id').split('__').pop()).sort(),
    old: !!document.querySelector('#mermaid-diagram-svg-container svg g.node[data-state-id="KTESTSTATION_TESTING"]'),
    err: /Mermaid Render Error/.test(document.body.innerText),
  }));
  const d1 = await waitFor(drawn, (x) => x.sub.length >= 2);
  expect(d1.sub.join() === 'KTESTSTATION_DONE,KTESTSTATION_TESTING' && !d1.old && !d1.err, `drawn: KTESTSTATION_TEST, TESTING and DONE inside it (${JSON.stringify(d1)})`);
  const enumText = async () => {
    await p.click('#dock-tab-enum');
    await p.waitForSelector('#st-dut-editor', { timeout: 8000 }).catch(() => {});
    await h.sleep(600);
    const t = await p.$eval('#st-dut-editor', (e) => e.value).catch(() => '');
    await p.click('#dock-tab-diagram');
    await h.sleep(400);
    return t;
  };
  const e1 = await enumText();
  expect(/KTESTSTATION_TEST\b/.test(e1) && !/KTESTSTATION_TESTING\b/.test(e1), 'the enum: KTESTSTATION_TEST, without TESTING and DONE');

  // Ctrl+Z: as before
  await p.click('#mermaid-canvas-area', { offset: { x: 30, y: 30 } }).catch(() => {});
  await p.keyboard.down('Control'); await p.keyboard.press('KeyZ'); await p.keyboard.up('Control');
  const d2 = await waitFor(drawn, (x) => x.old && !x.sub.length);
  expect(d2.old && d2.sub.length === 0, `Ctrl+Z: TESTING back, no sub-machine (${JSON.stringify(d2)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
