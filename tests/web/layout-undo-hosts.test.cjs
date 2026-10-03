// Undo with the layout file kept by the host: the desktop app (its window.tcDesktop: the POU at start-up, the layout
// file's read and write) and XAE (the WebView bridge's messages), each a stand-in. A transition laid out again: its
// route written; Ctrl+Z: written without it, the line as before; Ctrl+Y: written again; a state moved: its offset
// written, Ctrl+Z: as before in the file
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const POU = 'C:\\proj\\SM_TableManager.TcPOU';
const S = (n) => `TABLEMANAGER_${n}`;

async function host(browser, kind) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  const state = { stored: null, writes: 0 };
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const s = (await import('/src/samples/samplesData.ts')).SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const source = { name: 'SM_TableManager.TcPOU', path: POU, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] };
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  // (the host's file: read and written by the test's side)
  await page.exposeFunction('__layoutRead', (p) => (p === POU ? state.stored : null));
  await page.exposeFunction('__layoutWrite', (p, t) => {
    if (p !== POU) return false;
    state.stored = t;
    state.writes++;
    return true;
  });
  if (kind === 'xae') {
    await page.exposeFunction('__hostPost', async (m) => {
      if (m.type === 'ready') await toApp({ type: 'loadPou', source });
      else if (m.type === 'layoutRead') await toApp({ type: 'layoutResult', requestId: m.requestId, text: m.path === POU ? state.stored : null });
      else if (m.type === 'layoutWrite') {
        if (m.path === POU) {
          state.stored = m.text;
          state.writes++;
        }
        await toApp({ type: 'layoutResult', requestId: m.requestId, written: m.path === POU });
      } else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
    });
    await page.evaluateOnNewDocument(() => {
      const listeners = [];
      window.chrome = window.chrome || {};
      window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
      window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
    });
  } else {
    await page.evaluateOnNewDocument((source) => {
      window.tcDesktop = {
        isDesktop: true,
        startupPou: async () => source,
        onOpenPouFile: () => () => {},
        readLayout: async (p) => ({ text: await window.__layoutRead(p) }),
        writeLayout: async (p, t) => ({ written: await window.__layoutWrite(p, t) }),
      };
    }, source);
  }
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S('HOMMING')}"]`, { timeout: 60000 });
  await sleep(2500);
  await page.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  const status = await page.evaluate(() => document.getElementById('status-layout')?.getAttribute('data-state'));
  expect(status === 'new', `${kind}: the layout file kept by the host (${status})`);

  const file = () => (state.stored ? JSON.parse(state.stored) : null);
  const KEY = `${S('HOMMING_READY_TO_START')}->${S('ERROR')}`;
  const routeInFile = () => file()?.transitions?.elk?.[KEY]?.route ?? null;
  const lineOf = () => page.evaluate((from, to) => document.querySelector(`#mermaid-diagram-svg-container svg path.tc-edge-path[data-source-id="${from}"][data-target-id="${to}"]:not(.tc-edge-hitbox)`)?.getAttribute('d'), S('HOMMING_READY_TO_START'), S('ERROR'));
  const waitFor = async (fn, ms = 5000) => { for (let t = 0; t < ms && !(await fn()); t += 200) await sleep(200); return fn(); };

  // A transition laid out again: its route written
  const before = await lineOf();
  await page.evaluate((from, to) => {
    const p = document.querySelector(`#mermaid-diagram-svg-container svg path.tc-edge-path[data-source-id="${from}"][data-target-id="${to}"]:not(.tc-edge-hitbox)`);
    const q = p.getPointAtLength(p.getTotalLength() / 2);
    const at = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM());
    (document.querySelector(`path.tc-edge-hitbox[data-path-id="${p.getAttribute('data-path-id')}"]`) ?? p).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 }));
  }, S('HOMMING_READY_TO_START'), S('ERROR'));
  await page.waitForSelector('#context-menu-relayout-edge', { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('context-menu-relayout-edge')?.click());
  expect(!!(await waitFor(() => routeInFile())), `${kind}: laid out again, its route written`);
  const laid = await lineOf();
  // Ctrl+Z (the canvas' keys): the route out of the file, the line as before
  await page.click('#mermaid-canvas-area', { offset: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  expect(!(await waitFor(async () => !routeInFile()).then(() => routeInFile())) && (await lineOf()) === before, `${kind}: Ctrl+Z: written without its route, the line as before`);
  // Ctrl+Y: again
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyY');
  await page.keyboard.up('Control');
  expect(!!(await waitFor(() => routeInFile())) && (await lineOf()) === laid, `${kind}: Ctrl+Y: laid out again, written again`);

  // A state moved: its offset written; Ctrl+Z: as before in the file
  await page.evaluate((id) => document.getElementById(`btn-goto-state-${id}`)?.click(), S('HOMMING'));
  await sleep(1500);
  const offsetInFile = () => file()?.states?.[S('HOMMING')] ?? null;
  const was = JSON.stringify(offsetInFile());
  const b = await page.evaluate((id) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`); const r = (n?.querySelector('rect, path') ?? n).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, S('HOMMING'));
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 8 * i, b.y + 5 * i);
  await page.mouse.up();
  expect(await waitFor(() => JSON.stringify(offsetInFile()) !== was), `${kind}: a state moved: its offset written (${JSON.stringify(offsetInFile())})`);
  await page.click('#mermaid-canvas-area', { offset: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  expect(await waitFor(() => JSON.stringify(offsetInFile()) === was), `${kind}: Ctrl+Z: its offset as before in the file (${JSON.stringify(offsetInFile())})`);
  expect(errors.length === 0, `${kind}: no page errors ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  await host(browser, 'desktop');
  await host(browser, 'xae');
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
