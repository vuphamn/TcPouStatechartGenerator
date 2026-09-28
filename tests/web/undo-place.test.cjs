// A state that goes and comes back with Undo / Redo keeps its place on the canvas (and its style): moved, deleted,
// Ctrl+Z: back where it was moved to, not where the layout would put it
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
  const S = 'TABLEMANAGER_HALT_FEED';
  // (a close look at it: Go to State)
  await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), S);
  await h.sleep(1500);
  const at = () => p.evaluate((s) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`); const r = n?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, S);

  // Moved
  const a0 = await at();
  await p.mouse.move(a0.x, a0.y);
  await p.mouse.down();
  await p.mouse.move(a0.x + 90, a0.y + 50, { steps: 8 });
  await p.mouse.up();
  await h.sleep(600);
  const a1 = await at();
  expect(Math.hypot(a1.x - a0.x, a1.y - a0.y) > 40, `${S} moved (${(a1.x - a0.x).toFixed(0)},${(a1.y - a0.y).toFixed(0)})`);

  // Deleted (Delete, confirmed)
  await p.mouse.click(a1.x, a1.y);
  await h.sleep(200);
  await p.keyboard.press('Delete');
  await p.waitForSelector('#text-prompt-submit', { timeout: 4000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(1500);
  expect(!(await at()), `${S} deleted`);

  // Ctrl+Z: back, where it was moved to
  // (the canvas's focus: a click on an empty spot of it)
  const empty = await p.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { x: r.x + r.width - 30, y: r.y + r.height - 30 }; });
  await p.mouse.click(empty.x, empty.y);
  await p.evaluate(() => document.getElementById('mermaid-canvas-area')?.focus());
  await p.keyboard.down('Control'); await p.keyboard.press('z'); await p.keyboard.up('Control');
  await h.sleep(1800);
  const a2 = await at();
  expect(!!a2 && Math.hypot(a2.x - a1.x, a2.y - a1.y) < 4, `Ctrl+Z: ${S} back where it was moved to (${a2 ? `${(a2.x - a1.x).toFixed(1)},${(a2.y - a1.y).toFixed(1)} off` : 'not back'})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
