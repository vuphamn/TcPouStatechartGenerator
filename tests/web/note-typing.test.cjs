// The note dialog keeps what is typed at once: typing that starts as the dialog opens (and lasts past its first
// 50 ms) is not selected and replaced (it was, on slow machines: the GitHub runner lost the start of the text)
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
  await h.sleep(800);
  const pt = await p.evaluate(() => {
    const area = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    for (const n of document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')) {
      const r = n.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x > area.left + 20 && x < area.right - 20 && y > area.top + 60 && y < area.bottom - 20 && n.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  });
  const text = 'Check the door sensor and the clamp';
  for (const [i, delay] of [[1, 0], [2, 8], [3, 25]]) {
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    await h.sleep(300);
    await p.click('#context-menu-add-note-btn');
    // Typing starts the moment the dialog is there
    await p.waitForSelector('#note-textarea', { timeout: 5000 });
    await p.type('#note-textarea', `${text} ${i}`, { delay });
    await h.sleep(150);
    const value = await p.$eval('#note-textarea', (e) => e.value);
    expect(value === `${text} ${i}`, `typed ${delay} ms apart: "${value}"`);
    await p.keyboard.press('Escape');
    await h.sleep(300);
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
