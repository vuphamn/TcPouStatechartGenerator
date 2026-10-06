// A transition drawn from a composite's border (KAnalogMeasure: KANALOGMEASURE_READY is the only state in
// KAnalogMeasureEnabled, so its "status_bError" transition to ERROR leaves the composite): its start dragged onto
// KANALOGMEASURE_DISABLED moves the IF into DISABLED's branch of doState() (not "no CASE branch" for the composite).
// (READY is marked final first: only a final state's transitions leave from the border)
// Collapse error-sink edges is off by default
// (KAnalogMeasure's sub-machine, readDiagnostics() in KANALOGMEASURE_ENABLING, collapsed: the layout it was written for)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const SRC = 'KAnalogMeasureEnabled';
const TO = 'KANALOGMEASURE_ERROR';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem('kss.collapsed.SM_KAnalogMeasure', JSON.stringify(['-KANALOGMEASURE_ENABLING'])); });
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  expect(await p.$eval('#collapse-errors-checkbox', (e) => !e.checked).catch(() => false), 'Collapse error-sink edges: off by default');
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_DISABLED"]', { timeout: 60000 });
  await h.sleep(1500);
  const doState = async () => {
    await p.click('#dock-tab-method');
    await p.waitForSelector('#method-implementation-editor', { timeout: 10000 }).catch(() => {});
    await h.sleep(500);
    const v = await p.$eval('#method-implementation-editor', (e) => e.value).catch(() => '');
    await p.click('#dock-tab-diagram');
    await h.sleep(700);
    return v;
  };
  // (a state's branch in the CASE: from its label to the next one)
  const branch = (code, state) => { const m = new RegExp(`\\n\\s*(?:\\w+\\.)?${state}\\s*:[\\s\\S]*?(?=\\n\\s*(?:\\w+\\.)?[A-Z][A-Z0-9_]+\\s*:(?!=)|\\n\\s*END_CASE)`).exec(code); return m ? m[0] : ''; };
  // (the transition: its IF on status_bError, to ERROR)
  const has = (b) => /IF \(?status_bError\)? THEN\s*\n\s*machineState := KANALOGMEASURE_ERROR/.test(b);
  const before = await doState();
  expect(has(branch(before, 'KANALOGMEASURE_READY')) && !has(branch(before, 'KANALOGMEASURE_DISABLED')), 'before: READY tests status_bError, DISABLED does not');

  // READY marked final (its menu): its transitions out leave from the composite's border
  const ready = await p.evaluate(() => { const r = document.querySelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_READY"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(ready.x, ready.y, { button: 'right' });
  const fin = await p.waitForSelector('#context-menu-toggle-final-btn', { timeout: 5000 }).catch(() => null);
  expect(!!fin, 'READY\'s menu: Mark as final state');
  if (fin) await fin.click();
  await p.waitForFunction((src, to) => [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].some((x) => x.getAttribute('data-source-id') === src && x.getAttribute('data-target-id') === to), { timeout: 15000 }, SRC, TO).catch(() => {});
  await h.sleep(1200);

  // The edge from the composite, selected; its start dragged onto DISABLED (looked for until it is on screen: on a busy
  // machine the chart is drawn again a while after the edit)
  const find = () => p.evaluate((src, to) => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].find((x) => x.getAttribute('data-source-id') === src && x.getAttribute('data-target-id') === to);
    if (!el) return null;
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('path')?.getAttribute('data-path-id') === el.getAttribute('data-path-id')) return { x, y };
    }
    return null;
  }, SRC, TO);
  let pt = null;
  for (let i = 0; i < 30 && !(pt = await find()); i++) await h.sleep(500);
  const there = await p.evaluate((src, to) => [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].some((x) => x.getAttribute('data-source-id') === src && x.getAttribute('data-target-id') === to), SRC, TO);
  expect(!!pt, `the edge ${SRC} -> ${TO} on screen${pt ? '' : ` (drawn: ${there})`}`);
  if (pt) {
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(700);
    const hs = await p.evaluate(() => { const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]')].find((x) => x.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const target = await p.evaluate(() => { const r = document.querySelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_DISABLED"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    expect(!!hs, 'its start handle');
    if (hs) {
      await p.mouse.move(hs.x, hs.y);
      await p.mouse.down();
      for (let i = 1; i <= 16; i++) await p.mouse.move(hs.x + ((target.x - hs.x) * i) / 16, hs.y + ((target.y - hs.y) * i) / 16);
      await h.sleep(200);
      await p.mouse.up();
      await h.sleep(1500);
    }
  }
  const toast = await p.evaluate(() => document.body.innerText.match(/no CASE branch[^\n]*/)?.[0] ?? '');
  const after = await doState();
  expect(!toast && has(branch(after, 'KANALOGMEASURE_DISABLED')) && !has(branch(after, 'KANALOGMEASURE_READY')), `its start dropped on DISABLED: the IF moved into DISABLED's branch${toast ? ` (said: "${toast}")` : ''}`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
