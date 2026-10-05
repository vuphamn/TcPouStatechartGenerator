// Composites nested by dragging (DoorDasher: its composites in Enabled): one dragged by its title out of Enabled's box
// moves its {region} block out of Enabled (its states with it); dragged into Enabled again, back in it. Collapse
// (the composite's menu): one box, its transitions its own; Expand (the box's menu): drawn with its states again
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1700, height: 1050 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'door-dasher-237');
  await h.sleep(3500);
  await p.addStyleTag({ content: '#diagram-minimap-container, #diagram-minimap-collapsed { visibility: hidden !important; }' });

  // The enum's text (the Enum Editor)
  const dut = async () => {
    await p.click('#dock-tab-enum');
    await p.waitForSelector('#st-dut-editor', { timeout: 10000 });
    await h.sleep(400);
    const t = await p.$eval('#st-dut-editor', (x) => x.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(800);
    return t;
  };
  // Is a region inside another one in the enum (its {region} between the other's {region} and {endregion})
  const isIn = (text, inner, outer) => {
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes(`{region "${inner}"`));
    const start = lines.findIndex((l) => l.includes(`{region "${outer}"`));
    if (at < 0 || start < 0) return null;
    let depth = 0;
    for (let i = start; i < lines.length; i++) {
      if (/\{region/.test(lines[i])) depth++;
      else if (/\{endregion/.test(lines[i]) && --depth === 0) return at > start && at < i;
    }
    return false;
  };
  const before = await dut();
  // (the inner composite: one of Enabled's)
  const names = ['CrossTransfer', 'InlineTransfer', 'DoordashSeq'];
  const inner = names.find((n) => isIn(before, n, 'Enabled'));
  expect(!!inner, `a composite in Enabled: ${inner}`);
  if (!inner) throw new Error('no nested composite');

  const box = (name) => p.evaluate((name) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim() === name);
    if (!c) return null;
    const r = (c.querySelector(':scope > rect') ?? c).getBoundingClientRect();
    const l = c.querySelector('.cluster-label')?.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, title: l ? { x: l.x + l.width / 2, y: l.y + l.height / 2 } : null };
  }, name);
  const dragTitle = async (name, to) => {
    const b = await box(name);
    if (!b?.title) return false;
    await p.mouse.move(b.title.x, b.title.y);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(b.title.x + ((to.x - b.title.x) * i) / 20, b.title.y + ((to.y - b.title.y) * i) / 20);
    await p.mouse.up();
    await h.sleep(2500);
    return true;
  };

  // Out of Enabled: released left of its box (or above it)
  const en = await box('Enabled');
  const area = await p.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  const outside = en.l - area.l > 160 ? { x: en.l - 80, y: (en.t + en.b) / 2 } : { x: (en.l + en.r) / 2, y: Math.max(area.t + 60, en.t - 60) };
  expect(await dragTitle(inner, outside), `${inner} dragged by its title out of Enabled`);
  const afterOut = await dut();
  expect(isIn(afterOut, inner, 'Enabled') === false, `out: its {region} after Enabled's (${isIn(afterOut, inner, 'Enabled')})`);
  // Into Enabled again: released in its box
  const en2 = await box('Enabled');
  expect(await dragTitle(inner, { x: (en2.l + en2.r) / 2, y: en2.b - 30 }), `${inner} dragged into Enabled`);
  const afterIn = await dut();
  expect(isIn(afterIn, inner, 'Enabled') === true, 'in: its {region} in Enabled again');

  // Collapse (its menu): one box; Expand (the box's menu); a state of it in view first (Go to State)
  const dutLines = afterIn.split(/\r?\n/);
  const firstIn = dutLines
    .slice(dutLines.findIndex((l) => l.includes(`{region "${inner}"`)) + 1)
    // (its members: written with a comma before or after them)
    .map((l) => l.trim().replace(/^,\s*/, ''))
    .find((l) => /^[A-Za-z_]\w*/.test(l))
    ?.match(/^[A-Za-z_]\w*/)?.[0];
  await p.evaluate((s) => [...(document.getElementById('state-list-item-' + s)?.querySelectorAll('button') ?? [])].find((b) => /Go to State/.test(b.textContent))?.click(), firstIn);
  await h.sleep(1500);
  const b = await box(inner);
  if (b?.title) await p.mouse.click(b.title.x, b.title.y, { button: 'right' });
  const collapse = await p.waitForSelector('#context-menu-composite-collapse-btn', { timeout: 3000 }).catch(() => null);
  expect(!!collapse, `its menu: Collapse to one box (${JSON.stringify(b?.title)}; ${await p.evaluate(() => [...document.querySelectorAll('[id^=context-menu-]')].map((e) => e.id).slice(0, 12).join(', '))})`);
  if (collapse) await collapse.click();
  await h.sleep(2500);
  const node = await p.$(`#mermaid-canvas-area g.node[data-state-id="${inner}"]`);
  expect(!!node && !(await box(inner)), `collapsed: one box ${inner}, no composite drawn`);
  if (node) {
    // (the box may be off the screen, small on the wide chart: its right-click sent to it)
    const r = await node.boundingBox();
    await node.evaluate((el) => {
      const q = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: q.x + q.width / 2, clientY: q.y + q.height / 2 }));
    });
    const expand = await p.waitForSelector('#context-menu-composite-expand-btn', { timeout: 3000 }).catch(() => null);
    expect(!!expand, `the box's menu: Expand (${JSON.stringify(r)}; ${await p.evaluate(() => [...document.querySelectorAll('[id^=context-menu-]')].map((e) => e.id).slice(0, 10).join(', '))})`);
    // (clicked in the page: the menu opens where the box is, which may be below the window, out of the mouse's reach)
    if (expand) await expand.evaluate((el) => el.click());
    // (drawn again: a busy machine takes longer)
    for (let i = 0; i < 60 && !(await box(inner)); i++) await h.sleep(200);
    const shown = await box(inner);
    expect(!!shown, `expanded: the composite drawn again${shown ? '' : ` (still a box: ${!!(await p.$(`#mermaid-canvas-area g.node[data-state-id="${inner}"]`))}; a menu open: ${!!(await p.$('#context-menu-composite-expand-btn'))})`}`);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
