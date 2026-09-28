// Save All in one window saves the app's other windows too (web edition: two tabs; the desktop app's windows and
// XAE's tabs the same way): the other one's Method Editor edit goes into its POU and is saved; this one says so
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const ID = 'method-implementation-editor';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const open = async () => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(h.APP_URL, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await h.sleep(800);
    return p;
  };
  const a = await open();
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  const b = await open();

  // b: an edit in its Method Editor, not put into the POU yet
  await b.bringToFront();
  await b.click('#dock-tab-method');
  await b.waitForSelector(`#${ID}`);
  await h.sleep(500);
  await b.evaluate((id) => { const ta = document.getElementById(id); ta.focus(); ta.setSelectionRange(0, 0); }, ID);
  await b.keyboard.type('// from the other window\n', { delay: 3 });
  await h.sleep(300);
  const pendingB = await b.$eval('#header-save-all-count', (e) => e.textContent).catch(() => '');

  // a: Save All
  await a.bringToFront();
  await a.click('#header-save-all-btn');
  let toast = '';
  for (let i = 0; i < 40 && !toast; i++) {
    await h.sleep(150);
    toast = await a.evaluate(() => document.body.innerText.match(/Save All: also saved in [^\n]*/)?.[0] ?? '');
  }
  // (the other window draws itself again a moment later)
  let leftB = true;
  for (let i = 0; i < 20 && leftB; i++) {
    leftB = !!(await b.$('#header-save-all-count'));
    if (leftB) await h.sleep(150);
  }
  const inPou = await b.evaluate(() => {
    // (the POU Editor shows the POU: doState's code is in its methods, so look through the Method Editor again)
    const ta = document.getElementById('method-implementation-editor');
    return ta ? ta.value.startsWith('// from the other window') : false;
  });
  expect(pendingB === '1' && !leftB && inPou, `the other window's edit put into its POU (had ${pendingB || 'none'} editor with edits; now ${leftB ? 'still' : 'none'})`);
  expect(/^Save All: also saved in 1 other window \(SM_TableManager\.TcPOU\)/.test(toast), `this window says so: "${toast}"`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
