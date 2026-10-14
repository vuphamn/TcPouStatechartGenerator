const h = require('../lib/harness.cjs');
// One theme for every window of the app on a browser (XAE's MachineScope windows share one WebView2 profile, the desktop
// app's windows, a browser's tabs): chosen in one, the others follow at once (kss.appTheme, the storage event); kept
// for the next time (a reload)
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
  const errors = [];
  const open = async () => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(h.APP_URL, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    return p;
  };
  const a = await open();
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const b = await open();
  const look = (p) => p.evaluate(() => ({ ide: document.documentElement.getAttribute('data-ide-theme'), app: document.documentElement.getAttribute('data-app-theme') }));
  const choose = async (p, theme) => {
    if (!(await p.$('#mermaid-theme-select'))) await p.click('#header-appearance-btn');
    await p.waitForSelector('#mermaid-theme-select', { timeout: 5000 });
    await p.select('#mermaid-theme-select', theme);
  };
  const start = await look(b);

  // 1. Chosen in the first window: the second follows
  await choose(a, 'vscode-light');
  const b1 = await h.until(() => look(b).then((x) => (x.ide === 'vscode-light' ? x : null)), 4000);
  expect(!start.ide && !!b1 && b1.app === 'default', `the other window follows: ${JSON.stringify(start)} → ${JSON.stringify(b1)}`);

  // 2. Chosen in the second: the first follows (both ways); a plain Mermaid theme too
  await choose(b, 'jetbrains-darcula');
  const a2 = await h.until(() => look(a).then((x) => (x.ide === 'jetbrains-darcula' ? x : null)), 4000);
  await choose(b, 'forest');
  const a3 = await h.until(() => look(a).then((x) => (!x.ide && x.app === 'forest' ? x : null)), 4000);
  const select = await a.$eval('#mermaid-theme-select', (s) => s.value).catch(() => null);
  expect(!!a2 && !!a3 && select === 'forest', `and back: darcula, then forest (its Theme list says ${select})`);

  // 3. Kept: a window opened again starts with it
  await choose(a, 'vs-dark');
  await h.sleep(300);
  await b.reload({ waitUntil: 'load' });
  await b.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const kept = await look(b);
  expect(kept.ide === 'vs-dark' && (await b.evaluate(() => localStorage.getItem('kss.appTheme'))) === 'vs-dark', `kept for the next time: ${JSON.stringify(kept)}`);

  expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
