// A transition nested in IFs (KAnalogMeasure: ENABLING → ERROR, inside "ELSIF status_bDeviceCommReady"): its start
// endpoint dragged onto DISABLED moves its code there, inside the IF it was in; the Method Editor's Diff (no edits of
// its own) shows the POU's change; Dagre: the handle under the pointer while dragged
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const FROM = 'KANALOGMEASURE_ENABLING';
const TO = 'KANALOGMEASURE_ERROR';
const NEW = 'KANALOGMEASURE_DISABLED';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // (a reload with the POU changed: the page asks first; yes)
  p.on('dialog', (d) => void d.accept().catch(() => {}));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${NEW}"]`, { timeout: 60000 });
  await h.sleep(2500);

  // The transition selected, its start handle dragged onto a state; where the handle is while dragged
  const dragStart = async (onto) => {
    const key = `${FROM}->${TO}`;
    const pt = await p.evaluate((key) => {
      for (const el of document.querySelectorAll(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`)) {
        const len = el.getTotalLength(); const m = el.getScreenCTM();
        for (const f of [0.3, 0.5, 0.7, 0.2, 0.8]) {
          const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
          if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
        }
      }
      return null;
    }, key);
    if (!pt) return null;
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(800);
    const hd = await p.evaluate(() => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]')].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return e && x.contains(e); });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!hd) return null;
    const tgt = await p.evaluate((s) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, onto);
    await p.mouse.move(hd.x, hd.y);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(hd.x + ((tgt.x - hd.x) * i) / 20, hd.y + ((tgt.y - hd.y) * i) / 20);
    await h.sleep(200);
    const during = await p.evaluate(() => {
      const el = document.querySelector('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]');
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, drop: document.querySelector('.edge-drop-target')?.getAttribute('data-state-id') } : null;
    });
    await p.mouse.up();
    await h.sleep(1500);
    return { during, tgt };
  };
  const edgesTo = () => p.evaluate((to) => [...new Set([...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].map((x) => x.getAttribute('data-edge-key')).filter((k) => k?.endsWith(`->${to}`)))], TO);

  // ELK: dropped on DISABLED, the code moved
  const r = await dragStart(NEW);
  expect(!!r && r.during?.drop === NEW, `dragged onto ${NEW} (${r?.during?.drop})`);
  const status = await p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  expect(/inside the IF it was in: status_bDeviceCommReady/.test(status), `moved, inside its IF: ${status}`);
  const keys = await edgesTo();
  expect(keys.includes(`${NEW}->${TO}`) && !keys.includes(`${FROM}->${TO}`), `the chart: ${keys.join(', ')}`);

  // The Method Editor: DISABLED's branch has it; its Diff shows the POU's change
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  const code = await p.$eval('#method-implementation-editor', (t) => t.value);
  const branch = code.slice(code.indexOf(`${NEW}:`), code.indexOf(`${FROM}:`));
  expect(/IF status_bDeviceCommReady THEN[\s\S]*IF \(bCoeError OR bCoeChannelError\) THEN[\s\S]*machineState := KANALOGMEASURE_ERROR;/.test(branch), "doState(): in DISABLED's branch, inside its IF");
  expect(!(await p.$eval('#method-diff-btn', (b) => b.disabled)), 'its Diff: enabled (the POU changed)');
  await p.click('#method-diff-btn');
  await p.waitForSelector('#diff-dialog', { timeout: 3000 }).catch(() => {});
  const shown = await p.evaluate(() => ({ title: document.querySelector('#diff-dialog [role="dialog"], #diff-dialog')?.getAttribute('aria-label'), added: [...document.querySelectorAll('#diff-dialog .diff-add')].length }));
  expect(/since it was saved/.test(shown.title || '') && shown.added > 0, `the Diff: ${shown.title}, ${shown.added} lines put in`);
  await p.keyboard.press('Escape');
  await h.sleep(300);

  // Dagre: the handle stays under the pointer (the sample loaded afresh)
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-analog-measure');
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${NEW}"]`, { timeout: 60000 });
  await h.sleep(2000);
  await p.click('#layout-engine-dagre');
  await h.sleep(3000);
  const d = await dragStart(NEW);
  const off = d?.during ? Math.hypot(d.during.x - d.tgt.x, d.during.y - d.tgt.y) : Infinity;
  expect(off < 4, `Dagre: the handle under the pointer while dragged (${off.toFixed(1)} px off)`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
