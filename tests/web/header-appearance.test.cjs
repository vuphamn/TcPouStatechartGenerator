// The header's Theme & Preset (together, out of the canvas' Options): its panel holds the theme and the presets; the
// canvas' grid (its dots) off by default, on from the toolbar (kept after a reload)
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
  await h.sleep(1000);

  // Theme & Preset: in the header, together
  const where = await p.evaluate(() => {
    const panel = document.getElementById('header-appearance-panel');
    return {
      btn: !!document.querySelector('header #header-appearance-btn, #header-row-1 #header-appearance-btn'),
      theme: !!panel?.querySelector('#mermaid-theme-select'),
      preset: !!panel?.querySelector('#diagram-presets-toggle-btn'),
      hidden: panel?.classList.contains('hidden'),
    };
  });
  expect(where.btn && where.theme && where.preset && where.hidden, `the header: Theme & Preset, its panel holds both (${JSON.stringify(where)})`);
  await p.click('#header-appearance-btn');
  await h.sleep(300);
  expect(await p.$eval('#header-appearance-panel', (e) => !e.classList.contains('hidden') && e.getBoundingClientRect().width > 100), 'a click: its panel shown');
  await p.select('#mermaid-theme-select', 'neutral');
  await h.sleep(600);
  expect((await p.evaluate(() => document.documentElement.getAttribute('data-app-theme'))) === 'neutral', 'its Theme: the app');
  await p.select('#mermaid-theme-select', 'dark');
  await h.sleep(400);
  await p.mouse.click(800, 600);
  await h.sleep(300);
  expect(await p.$eval('#header-appearance-panel', (e) => e.classList.contains('hidden')), 'a click elsewhere: closed');

  // The grid: off by default; on from the toolbar; kept
  const grid = () => p.evaluate(() => {
    const area = document.querySelector('[data-grid]');
    return { flag: area?.getAttribute('data-grid'), image: area ? getComputedStyle(area).backgroundImage : null };
  });
  let g = await grid();
  expect(g.flag === 'off' && !/gradient/.test(g.image || ''), `the grid: off by default (${JSON.stringify(g)})`);
  // (snapping on: its dots too only with the grid on)
  const snapOn = await p.evaluate(() => localStorage.getItem('kss.snap') ?? 'default');
  expect(!(await p.$('#diagram-snap-grid-svg')), `the grid off: no snap dots either (snap: ${snapOn})`);
  // (the toolbar: Grid beside Snap to grid)
  const order = await p.evaluate(() => {
    const items = [...document.querySelectorAll('[data-toolbar-item]')].map((e) => e.getAttribute('data-toolbar-item'));
    return { items, ok: Math.abs(items.indexOf('grid') - items.indexOf('snap')) === 1 };
  });
  expect(order.ok || !order.items.includes('grid') || !order.items.includes('snap'), `Grid beside Snap to grid (${order.items.join(', ')})`);
  if (await p.$('#toolbar-grid-btn')) await p.click('#toolbar-grid-btn');
  else {
    await p.click('#toolbar-hidden-controls-btn');
    await p.waitForSelector('#hidden-grid-btn', { timeout: 3000 });
    await p.click('#hidden-grid-btn');
    await p.keyboard.press('Escape');
  }
  await h.sleep(300);
  g = await grid();
  expect(g.flag === 'on' && /radial-gradient/.test(g.image || ''), `on: its dots (${g.flag})`);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  expect((await grid()).flag === 'on', 'after a reload: still on');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
