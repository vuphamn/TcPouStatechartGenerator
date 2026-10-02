// Move start to… / Move end to… (a transition's menu): the state picked from a list, as dragging its end onto it
// (KAnalogMeasure: READY's "status_bError" transition to ERROR moved to start at DISABLED, then to go to READY)
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
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_DISABLED"]', { timeout: 60000 });
  await h.sleep(1500);
  const doState = async () => {
    await p.click('#dock-tab-method');
    await p.waitForSelector('#method-implementation-editor', { timeout: 10000 }).catch(() => {});
    await h.sleep(500);
    const v = await p.$eval('#method-implementation-editor', (e) => e.value).catch(() => '');
    await p.click('#dock-tab-diagram');
    await h.sleep(900);
    return v;
  };
  const branch = (code, state) => { const m = new RegExp(`\\n\\s*(?:\\w+\\.)?${state}\\s*:[\\s\\S]*?(?=\\n\\s*(?:\\w+\\.)?[A-Z][A-Z0-9_]+\\s*:(?!=)|\\n\\s*END_CASE)`).exec(code); return m ? m[0] : ''; };
  const has = (b, to) => new RegExp(`IF \\(?status_bError\\)? THEN\\s*\\n\\s*machineState := ${to}`).test(b);
  // The chart drawn and settled (an edit just made: drawn again a moment later, on a busy machine later still): the
  // same drawing for a while
  const settled = async () => {
    let last = '';
    for (let i = 0; i < 30; i++) {
      const now = await p.evaluate(() => { const svg = document.querySelector('#mermaid-diagram-svg-container svg'); return svg ? `${svg.id}|${svg.querySelectorAll('path.tc-edge-path').length}|${svg.getAttribute('viewBox')}` : ''; });
      if (now && now === last) return;
      last = now;
      await h.sleep(500);
    }
  };
  // A point of the edge's line, right-clicked; the menu's item picked; the state typed in the list
  const move = async (src, to, item, pick) => {
    await settled();
    const pt = await p.evaluate((src, to) => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].find((x) => x.getAttribute('data-source-id') === src && x.getAttribute('data-target-id') === to);
      if (!el) return null;
      const len = el.getTotalLength(); const m = el.getScreenCTM();
      for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
        const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
        if (document.elementFromPoint(x, y)?.closest('path')?.getAttribute('data-path-id') === el.getAttribute('data-path-id')) return { x, y };
      }
      return null;
    }, src, to);
    expect(!!pt, `the edge ${src} -> ${to} on screen`);
    if (!pt) return false;
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    const btn = await p.waitForSelector(`#context-menu-${item}`, { timeout: 5000 }).catch(() => null);
    expect(!!btn, `its menu has ${item}`);
    if (!btn) return false;
    await btn.click();
    const input = await p.waitForSelector('#edge-end-picker-input', { timeout: 5000 }).catch(() => null);
    expect(!!input, 'the list of states opens');
    if (!input) return false;
    const listed = await p.$$eval('#edge-end-picker [data-id]', (els) => els.map((e) => e.getAttribute('data-id')));
    expect(listed.includes(`edge-end:${pick}`) && !listed.includes(`edge-end:${item === 'move-start-btn' ? src : to}`), `${pick} listed, the end it has now not (${listed.length} states)`);
    await p.type('#edge-end-picker-input', pick);
    await h.sleep(200);
    await p.keyboard.press('Enter');
    await h.sleep(1500);
    expect(!(await p.$('#edge-end-picker')), 'the list closed');
    return true;
  };
  const before = await doState();
  expect(has(branch(before, 'KANALOGMEASURE_READY'), 'KANALOGMEASURE_ERROR') && !has(branch(before, 'KANALOGMEASURE_DISABLED'), 'KANALOGMEASURE_ERROR'), 'before: READY tests status_bError, DISABLED does not');
  // (READY is its only state, not marked final: the edge leaves from READY)
  if (await move('KANALOGMEASURE_READY', 'KANALOGMEASURE_ERROR', 'move-start-btn', 'KANALOGMEASURE_DISABLED')) {
    const after = await doState();
    expect(has(branch(after, 'KANALOGMEASURE_DISABLED'), 'KANALOGMEASURE_ERROR') && !has(branch(after, 'KANALOGMEASURE_READY'), 'KANALOGMEASURE_ERROR'), 'Move start to DISABLED: the IF moved into DISABLED\'s branch');
  }
  if (await move('KANALOGMEASURE_DISABLED', 'KANALOGMEASURE_ERROR', 'move-end-btn', 'KANALOGMEASURE_READY')) {
    const after = await doState();
    expect(has(branch(after, 'KANALOGMEASURE_DISABLED'), 'KANALOGMEASURE_READY'), 'Move end to READY: DISABLED\'s IF now goes to READY');
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
