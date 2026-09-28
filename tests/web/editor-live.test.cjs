// XAE stand-in: while live, the Method Editor shows the values of the POU's variables each line uses at the line's
// end; right-click a name for "Watch x in Live": it is listed at the top of the Live tab with its value, kept per POU;
// Stop watching there takes it out
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const ID = 'method-implementation-editor';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  // (the PLC: booleans TRUE, numbers 7)
  const valueOf = (id) => (/(^|\.)(cmd|status)_b/i.test(id) ? true : 7);
  await page.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
      await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
    } else if (m.type === 'liveWatch') {
      const vars = m.vars.filter((v) => !/^(sym|ov):/.test(v.id));
      await toApp({ type: 'liveWatchResult', vars: vars.map((v) => ({ id: v.id, symbol: v.candidates[0], type: valueOf(v.id) === true ? 'BOOL' : 'INT' })) });
      await toApp({ type: 'liveVars', values: vars.map((v) => ({ id: v.id, t: Date.now(), v: valueOf(v.id) })) });
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
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await sleep(800);

  // 1. Live, then doState() in the Method Editor: the values at the lines' ends
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(400);
  await page.click('#live-start-btn');
  await sleep(1500);
  await page.evaluate(() => document.getElementById('dock-tab-method')?.click());
  await page.waitForSelector(`#${ID}`, { timeout: 10000 });
  let inline = [];
  for (let i = 0; i < 30 && !inline.length; i++) {
    await sleep(200);
    inline = await page.$$eval(`#${ID}-inline-values .st-inline-values`, (n) => n.map((x) => x.textContent.trim()));
  }
  const cmdHome = inline.find((t) => /cmd_bHome = TRUE/.test(t));
  expect(inline.length > 3 && !!cmdHome, `live: values at the lines' ends (${inline.length} lines; ${cmdHome ?? inline.slice(0, 3).join(' | ')})`);
  const watchMsg = sent.filter((m) => m.type === 'liveWatch').pop();
  expect(!!watchMsg && watchMsg.vars.some((v) => v.id === 'cmd_bhome' && v.candidates[0] === `${I}.cmd_bHome`), 'the names the code uses asked for, with the instance');
  await page.screenshot({ path: h.out('editor-live-values.png') });

  // 2. Right-click cmd_bHome: Watch cmd_bHome in Live; listed in the Live tab with its value
  const rightClickOn = async (word) => {
    for (let i = 0; i < 4 && !(await page.$('#editor-menu-watch')); i++) {
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.evaluate((id, word) => {
      const ta = document.getElementById(id);
      const at = ta.value.indexOf(word) + 2;
      ta.focus();
      ta.setSelectionRange(at, at);
      ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 }));
    }, ID, word);
    await sleep(400);
    }
  };
  await rightClickOn('cmd_bHome');
  const label = await page.$eval('#editor-menu-watch', (e) => e.textContent.trim()).catch(() => '');
  expect(label === 'Watch cmd_bHome in Live', `the menu: ${label}`);
  await page.click('#editor-menu-watch').catch(() => {});
  await sleep(400);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(600);
  const row = await page.$eval('#live-watch-list .live-watch-row[data-name="cmd_bHome"]', (e) => e.querySelector('.live-watch-value')?.textContent.trim()).catch(() => null);
  const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kss.live.watch.')).map((k) => `${k}=${localStorage.getItem(k)}`).join(' '));
  expect(row === 'TRUE' && /cmd_bHome/.test(kept), `the Live tab lists it: cmd_bHome = ${row} (kept: ${kept})`);
  // The menu now says Stop watching; that takes it out
  await page.evaluate(() => document.getElementById('dock-tab-method')?.click());
  await sleep(500);
  await rightClickOn('cmd_bHome');
  const label2 = await page.$eval('#editor-menu-watch', (e) => e.textContent.trim()).catch(() => '');
  await page.click('#editor-menu-watch').catch(() => {});
  await sleep(400);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(400);
  expect(label2 === 'Stop watching cmd_bHome' && !(await page.$('#live-watch-list .live-watch-row[data-name="cmd_bHome"]')), `"${label2}": taken out of the list`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
