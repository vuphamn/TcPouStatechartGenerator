// XAE stand-in (the extension keeps the POU's layout file, SM_TableManager.machinescope.json beside it): none at
// first; a state dragged and a note added: written a moment later, with the state's place and the note; the page
// opened again with that file: the state where it was dragged to, the note there; the status bar says where it is kept
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  const POU = 'C:\\proj\\SM_TableManager.TcPOU';
  let stored = null;
  const writes = [];
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  await page.exposeFunction('__hostPost', async (m) => {
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: POU, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'layoutRead') {
      await toApp({ type: 'layoutResult', requestId: m.requestId, text: m.path === POU ? stored : null });
    } else if (m.type === 'layoutWrite') {
      if (m.path === POU) {
        stored = m.text;
        writes.push(m.text);
      }
      await toApp({ type: 'layoutResult', requestId: m.requestId, written: m.path === POU, ...(m.path === POU ? {} : { error: 'Not a POU loaded' }) });
    } else if (m.type === 'projectPous') {
      await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
    }
  });
  await page.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  const S = 'TABLEMANAGER_HOMMING';
  const open = async () => {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S}"]`, { timeout: 60000 });
    await sleep(2500);
    await page.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  };
  // (the state's place in the drawing's own coordinates)
  const placeOf = () => page.evaluate((s) => { const n = document.querySelector(`#mermaid-diagram-svg-container svg g.node[data-state-id="${s}"]`); const m = n?.getCTM(); return m ? [Math.round(m.e), Math.round(m.f)] : null; }, S);
  const status = () => page.evaluate(() => { const e = document.getElementById('status-layout'); return e ? { state: e.getAttribute('data-state'), text: e.textContent.trim() } : null; });

  // 1. No layout file yet
  await open();
  let st = await status();
  expect(st?.state === 'new' && /SM_TableManager\.machinescope\.json/.test(st.text), `no file yet: said, its name (${JSON.stringify(st)})`);
  const before = await placeOf();

  // 2. The state dragged; a note added on it
  await page.evaluate((s) => document.getElementById(`btn-goto-state-${s}`)?.click(), S);
  await sleep(1500);
  const box = await page.evaluate((s) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`); const r = (n?.querySelector('rect, path') ?? n)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, S);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 8 * i, box.y + 5 * i);
  await page.mouse.up();
  await sleep(600);
  const moved = await placeOf();
  expect(!!before && !!moved && Math.hypot(moved[0] - before[0], moved[1] - before[1]) > 20, `${S} dragged (${before} → ${moved})`);
  await page.mouse.click(box.x + 80, box.y + 50, { button: 'right' });
  await page.waitForSelector('#context-menu-add-note-btn', { timeout: 4000 }).catch(() => {});
  await page.click('#context-menu-add-note-btn').catch(() => {});
  await page.waitForSelector('#note-textarea', { timeout: 4000 }).catch(() => {});
  await page.type('#note-textarea', 'Homing: waits for the reference switch');
  await page.click('#note-dialog-save-btn').catch(() => {});
  for (let i = 0; i < 20 && !(stored && /reference switch/.test(stored) && new RegExp(S).test(stored)); i++) await sleep(250);
  const j = stored ? JSON.parse(stored) : null;
  expect(!!j && j.format === 'kval-machinescope-layout' && !!j.states?.[S] && /reference switch/.test(j.notes?.nodes?.[S] ?? ''), `written beside the POU: the state's place and the note (${stored ? stored.slice(0, 200).replace(/\s+/g, ' ') : 'nothing written'})`);
  // A transition's label dragged aside: kept by the transition (FROM->TO), not by the drawing's path id
  const labelOf = () => page.evaluate(() => {
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    for (const l of document.querySelectorAll('#mermaid-diagram-svg-container svg g.edgeLabel')) {
      const r = l.getBoundingClientRect();
      if (!l.textContent.trim() || r.width < 20 || r.x < area.left + 60 || r.right > area.right - 60 || r.y < area.top + 60 || r.bottom > area.bottom - 60) continue;
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      if (!document.elementFromPoint(x, y)?.closest('g.edgeLabel')) continue;
      return { x, y, from: l.getAttribute('data-from'), to: l.getAttribute('data-to'), tf: l.getAttribute('transform') };
    }
    return null;
  });
  const lab = await labelOf();
  expect(!!lab, `a transition's label on screen (${lab ? `${lab.from} → ${lab.to}` : 'none'})`);
  let labelKey = null;
  if (lab) {
    await page.mouse.move(lab.x, lab.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(lab.x + 5 * i, lab.y + 4 * i);
    await page.mouse.up();
    for (let i = 0; i < 20 && !(stored && JSON.parse(stored).transitions && Object.keys(JSON.parse(stored).transitions).length); i++) await sleep(250);
    const t = stored ? JSON.parse(stored).transitions ?? {} : {};
    labelKey = Object.keys(t).find((k) => k.startsWith(`${lab.from}->${lab.to}`)) ?? null;
    expect(!!labelKey && /->/.test(labelKey) && !/mermaid-render/.test(JSON.stringify(t)) && (t[labelKey].labelDx || t[labelKey].labelDy), `its move written by the transition: ${JSON.stringify(t)}`);
  }
  const labelMoved = lab ? await page.evaluate((from, to) => [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.edgeLabel')].find((l) => l.getAttribute('data-from') === from && l.getAttribute('data-to') === to)?.getAttribute('transform'), lab.from, lab.to) : null;
  st = await status();
  expect(st?.state === 'saved', `the status bar: saved (${JSON.stringify(st)})`);
  const n = writes.length;
  await sleep(2000);
  expect(writes.length === n, `nothing written again while nothing changes (${writes.length - n} more)`);

  // 3. Opened again (this browser's storage cleared): the file gives it all back
  await open();
  const again = await placeOf();
  expect(!!again && Math.hypot(again[0] - moved[0], again[1] - moved[1]) <= 2, `opened again: ${S} where it was dragged to (${again} vs ${moved})`);
  const note = await page.evaluate((s) => !!document.getElementById(`note-overlay-${s}`) && !!document.querySelector(`#mermaid-diagram-svg-container svg g.node.has-diagram-note[data-state-id="${s}"]`), S);
  expect(note, 'its note on the canvas');
  if (lab && labelMoved) {
    const labelAgain = await page.evaluate((from, to) => [...document.querySelectorAll('#mermaid-diagram-svg-container svg g.edgeLabel')].find((l) => l.getAttribute('data-from') === from && l.getAttribute('data-to') === to)?.getAttribute('transform'), lab.from, lab.to);
    const xy = (tf) => (tf ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const [a1, b1] = xy(labelMoved);
    const [a2, b2] = xy(labelAgain);
    expect(Math.hypot(a1 - a2, b1 - b2) <= 2, `its label where it was dragged to (${labelMoved} vs ${labelAgain})`);
  }
  st = await status();
  expect(st?.state === 'loaded', `the status bar: loaded (${JSON.stringify(st)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
