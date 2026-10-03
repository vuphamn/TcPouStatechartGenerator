// A State from the palette dropped in a composite with the canvas zoomed in (the side panels hidden): drawn where it
// was dropped, in the composite's box (it was put where the layout chose, often off screen); a second one dropped on
// it: put clear of it, close by; with Snap to Grid on (its default), a third one: its center on the grid
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MIME = 'application/x-kss-statechart-element';
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1280, height: 800 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1500);
  await p.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  const box = (id) => p.evaluate((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    const r = (n?.querySelector(':scope > rect, :scope > .label-container, :scope > polygon') ?? n)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, id);
  // Go to a state in the composite (TableManagerEnabled), the panels hidden, zoomed in at it
  await p.evaluate((id) => document.getElementById(`btn-goto-state-${id}`)?.click(), S('AUTOFEED_START_DOOR_IN'));
  await h.sleep(1500);
  await p.click('#toggle-sidebar-btn');
  await p.click('#toggle-right-panel-btn');
  await h.sleep(1200);
  let b = await box(S('AUTOFEED_START_DOOR_IN'));
  await p.mouse.move(b.x, b.y);
  for (let i = 0; i < 10; i++) {
    await p.mouse.wheel({ deltaY: -120 });
    await h.sleep(120);
  }
  await h.sleep(800);
  const zoom = await p.$eval('#zoom-label-button', (e) => e.textContent.trim());
  b = await box(S('AUTOFEED_START_DOOR_IN'));
  // An empty spot in the composite, right of the state
  const spot = await p.evaluate((x0, y0) => {
    const area = document.getElementById('mermaid-canvas-area');
    const r = area.getBoundingClientRect();
    const free = (x, y) => [[0, 0], [70, 0], [-70, 0], [0, 30], [0, -30], [70, 30], [-70, -30], [70, -30], [-70, 30]].every(([dx, dy]) => {
      const e = document.elementFromPoint(x + dx, y + dy);
      return e && area.contains(e) && !e.closest('g.node, g.edgeLabel, g.edgePaths, path, #statechart-palette, button');
    });
    for (let rad = 0; rad < 400; rad += 20) for (let a = 0; a < 360; a += 30) {
      const x = x0 + rad * Math.cos((a * Math.PI) / 180);
      const y = y0 + rad * Math.sin((a * Math.PI) / 180);
      if (x > r.left + 120 && x < r.right - 80 && y > r.top + 60 && y < r.bottom - 80 && free(x, y)) return { x, y };
    }
    return null;
  }, b.x + 260, b.y - 60);
  expect(!!spot, `zoomed in (${zoom}): an empty spot in the composite`);
  const drop = async (x, y, name) => {
    await p.evaluate((x, y, MIME) => {
      const dt = new DataTransfer();
      dt.setData(MIME, 'state');
      const el = document.elementFromPoint(x, y);
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    }, x, y, MIME);
    await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
    const prompt = await p.$eval('#text-prompt-dialog', (e) => e.innerText);
    await p.evaluate(() => document.getElementById('text-prompt-input').select());
    await p.keyboard.type(name);
    await p.keyboard.press('Enter');
    for (let i = 0; i < 30 && !(await box(name)); i++) await h.sleep(200);
    await h.sleep(1200);
    return prompt;
  };
  if (spot) {
    const prompt = await drop(spot.x, spot.y, S('WAIT_DOOR'));
    expect(/in TableManagerEnabled/.test(prompt), 'a state in the composite (the prompt says so)');
    const nb = await box(S('WAIT_DOOR'));
    const off = nb ? Math.hypot(nb.x - spot.x, nb.y - spot.y) : Infinity;
    expect(off < 30, `drawn where it was dropped (${Math.round(off)} px off; at ${nb ? `${Math.round(nb.x)},${Math.round(nb.y)}` : 'none'}, dropped at ${Math.round(spot.x)},${Math.round(spot.y)})`);
    const cluster = await p.evaluate(() => {
      const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim() === 'TableManagerEnabled');
      const r = (c?.querySelector(':scope > rect') ?? c)?.getBoundingClientRect();
      return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
    });
    expect(!!nb && !!cluster && nb.left >= cluster.left - 2 && nb.right <= cluster.right + 2 && nb.top >= cluster.top - 2 && nb.bottom <= cluster.bottom + 2, 'in the composite\'s box');
    // A second one dropped on it: clear of it, close by
    if (nb) {
      await drop(nb.x, nb.y, S('WAIT_DOOR2'));
      const b1 = await box(S('WAIT_DOOR'));
      const b2 = await box(S('WAIT_DOOR2'));
      const overlap = b1 && b2 && b2.left < b1.right && b2.right > b1.left && b2.top < b1.bottom && b2.bottom > b1.top;
      const h1 = b1 ? b1.bottom - b1.top : 0;
      expect(!!b2 && !overlap && Math.hypot(b2.x - b1.x, b2.y - b1.y) < 4 * h1 + (b1.right - b1.left), `dropped on it: put close by, not over it (${b2 ? `${Math.round(b2.x)},${Math.round(b2.y)}` : 'none'}; it at ${Math.round(b1.x)},${Math.round(b1.y)})`);
      // Snap to Grid on: a third one, its center on the grid (in the drawing's units)
      // (on by default; switched on when it is not: the button is sky blue while on)
      if (!(await p.$eval('#toolbar-snap-btn', (e) => e.className.includes('text-sky-300')))) await p.click('#toolbar-snap-btn');
      await h.sleep(400);
      const grid = await p.$eval('#toolbar-snap-size-select', (e) => Number(e.value)).catch(() => 20);
      const area = await p.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
      const spot3 = { x: Math.max(area.l + 150, Math.min(area.r - 100, b1.x - 2.5 * (b1.right - b1.left))), y: Math.max(area.t + 80, Math.min(area.b - 80, b1.y - 2 * h1)) };
      await drop(spot3.x, spot3.y, S('WAIT_DOOR3'));
      const c3 = await p.evaluate((id) => {
        const svg = document.querySelector('#mermaid-diagram-svg-container svg');
        const n = svg?.querySelector(`g.node[data-state-id="${id}"]`);
        const shape = n?.querySelector(':scope > rect, :scope > .label-container, :scope > polygon') ?? n;
        const frame = svg?.querySelector('g.edgePaths');
        if (!shape || !frame) return null;
        const r = shape.getBoundingClientRect();
        const q = new DOMPoint(r.x + r.width / 2, r.y + r.height / 2).matrixTransform(frame.getScreenCTM().inverse());
        return { x: q.x, y: q.y };
      }, S('WAIT_DOOR3'));
      const off = (v) => Math.min(((v % grid) + grid) % grid, grid - (((v % grid) + grid) % grid));
      expect(!!c3 && off(c3.x) < 1.5 && off(c3.y) < 1.5, `Snap to Grid (${grid}): its center on the grid (${c3 ? `${c3.x.toFixed(1)}, ${c3.y.toFixed(1)}` : 'none'})`);
    }
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
