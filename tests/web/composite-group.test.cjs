// Shift + a box drawn around states (KPowerSupply: DISABLED and ENABLING): they are selected, and offered as a new
// composite. "Just select them" keeps the selection only; Group writes {region "Startup"} around their enum lines
// and the chart draws the composite. A state dragged into its box (no key held) moves into it, dragged out, out of it
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
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="RESET"]', { timeout: 60000 });
  await h.sleep(1800);
  // (the minimap out of the way: the chart's states are dragged under where it floats)
  await p.addStyleTag({ content: '#diagram-minimap-container, #diagram-minimap-collapsed { visibility: hidden !important; }' });
  // (ENABLING and DISABLED in the middle of the canvas: the chart's top is under the toolbar at first)
  await p.evaluate(() => [...document.getElementById('state-list-item-ENABLING').querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click());
  await h.sleep(1500);
  const box = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; }, id);
  const cluster = (label) => p.evaluate((label) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area svg g.cluster')].find((x) => (x.querySelector('.cluster-label')?.textContent ?? '').trim() === label);
    const r = c && (c.querySelector(':scope > rect') ?? c).getBoundingClientRect();
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, label);
  const enumText = async () => {
    await p.click('#dock-tab-enum');
    await p.waitForSelector('#st-dut-editor');
    await h.sleep(400);
    const v = await p.$eval('#st-dut-editor', (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(900);
    return v;
  };
  const status = () => p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  const selected = () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node.multi-selected')].map((n) => n.getAttribute('data-state-id')).sort().join(','));
  // A box around DISABLED and ENABLING, drawn with Shift from the empty canvas
  const shiftBox = async () => {
    const a = await box('DISABLED');
    const b = await box('ENABLING');
    const l = Math.min(a.left, b.left) - 14;
    const t = Math.min(a.top, b.top) - 14;
    const r = Math.max(a.right, b.right) + 14;
    const bt = Math.max(a.bottom, b.bottom) + 14;
    await p.mouse.move(l, t);
    await p.keyboard.down('Shift');
    await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(l + ((r - l) * i) / 12, t + ((bt - t) * i) / 12);
    await p.mouse.up();
    await p.keyboard.up('Shift');
    return p.waitForSelector('#text-prompt-submit', { timeout: 5000 }).catch(() => null);
  };

  let ask = await shiftBox();
  const title = ask ? await p.evaluate(() => document.querySelector('#text-prompt-submit')?.closest('.fixed, [role="dialog"]')?.textContent ?? '') : '';
  expect(!!ask && /Group 2 states into a composite/.test(title), `Shift + a box: offered as a composite (${title.slice(0, 80)})`);
  expect((await selected()) === 'DISABLED,ENABLING', `... and they are selected (${await selected()})`);
  const cancel = ask ? await p.$eval('#text-prompt-cancel', (e) => e.textContent.trim()) : '';
  expect(cancel === 'Just select them', `its other choice: ${cancel}`);
  if (ask) await p.click('#text-prompt-cancel');
  await h.sleep(500);
  let dut = await enumText();
  expect(!/\{region "Startup"\}/.test(dut) && (await selected()) === 'DISABLED,ENABLING', 'Just select them: the selection only, nothing written');

  // Again: Group, named Startup
  ask = await shiftBox();
  if (ask) {
    await p.evaluate(() => document.getElementById('text-prompt-input').select());
    await p.keyboard.type('Startup');
    await p.keyboard.press('Enter');
    await h.sleep(2000);
  }
  dut = await enumText();
  expect(/\{region "Startup"\}\s*\n\s*DISABLED,\s*\n\s*ENABLING,\s*\n\s*\{endregion\}\s*\n\s*\{region "KPowerSupplyEnabled"\}/.test(dut), `Group: {region "Startup"} around them (${(dut.match(/\(\s*\n[\s\S]*?\)/) ?? [''])[0].replace(/\s+/g, ' ')})`);
  expect(!!(await cluster('Startup')) && /Startup: 2 states in it/.test(await status()), `the composite drawn: ${await status()}`);

  // ERROR dragged into Startup's box, then out of it
  const drag = async (from, to) => {
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20);
    await h.sleep(150);
    await p.mouse.up();
    await h.sleep(2000);
  };
  // (Startup and ERROR in view: zoomed out, the canvas panned up, dragged on its empty part)
  for (let i = 0; i < 2; i++) { await p.click('#zoom-out-button'); await h.sleep(300); }
  await h.sleep(900);
  const pan = await p.evaluate(() => {
    const a = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    for (let x = a.left + 200; x < a.right - 300; x += 40) {
      const y = a.bottom - 30;
      const e = document.elementFromPoint(x, y);
      if (e && !e.closest('g.node, g.cluster, g.edgeLabel, path, button, [id^="diagram-minimap"]')) return { x, y };
    }
    return null;
  });
  if (pan) {
    await p.mouse.move(pan.x, pan.y);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(pan.x, pan.y - 25 * i);
    await p.mouse.up();
    await h.sleep(800);
  }
  let c = await cluster('Startup');
  const en = await box('ENABLING');
  const er = await box('ERROR');
  const area = await p.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  expect(!!c && !!er && c.top > area.top && er.bottom < area.bottom, `Startup and ERROR in view (${JSON.stringify({ c, er, area })})`);
  await drag(await box('ERROR'), { x: Math.min(c.right - 8, en.right + 30), y: Math.min(c.bottom - 8, en.bottom + 12) });
  const inStartup = async () => /\{region "Startup"\}[^{]*ERROR[^{]*\{endregion\}/.test(await enumText());
  // (on a busy machine the chart is still being drawn when the drop lands, or the edit takes a moment: waited for,
  // then measured again and dropped once more)
  for (let i = 0; i < 10 && !(await inStartup()); i++) await h.sleep(300);
  if (!(await inStartup())) {
    console.log(`(not in Startup after the drop: "${await status()}"; once more)`);
    await h.sleep(1500);
    c = await cluster('Startup');
    const en2 = await box('ENABLING');
    if (c && en2) await drag(await box('ERROR'), { x: Math.min(c.right - 8, en2.right + 30), y: Math.min(c.bottom - 8, en2.bottom + 12) });
    for (let i = 0; i < 10 && !(await inStartup()); i++) await h.sleep(300);
  }
  dut = await enumText();
  expect(/\{region "Startup"\}[^{]*ERROR[^{]*\{endregion\}/.test(dut) && /ERROR is in Startup/.test(await status()), `ERROR dropped in its box: in Startup (${await status()})`);
  // (an empty spot of the canvas outside every composite)
  const free = await p.evaluate(() => {
    const a = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('#mermaid-canvas-area svg g.cluster, #mermaid-canvas-area svg g.node')].map((e) => e.getBoundingClientRect());
    for (let y = a.top + 60; y < a.bottom - 60; y += 30)
      for (let x = a.left + 120; x < a.right - 280; x += 30) {
        const e = document.elementFromPoint(x, y);
        if (e && e.closest('#mermaid-canvas-area') && !e.closest('button, [id^="diagram-minimap"], g.edgeLabel') && boxes.every((r) => x < r.left - 30 || x > r.right + 30 || y < r.top - 30 || y > r.bottom + 30)) return { x, y };
      }
    return null;
  });
  expect(!!free, `an empty spot outside the composites (${JSON.stringify(free)})`);
  // (a spot of ERROR's own box: not under an edge's label or badge)
  const grip = await p.evaluate(() => {
    const n = document.querySelector('#mermaid-canvas-area g.node[data-state-id="ERROR"]');
    const r = n.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (document.elementFromPoint(x, y)?.closest('g.node') === n) return { x, y };
    }
    return null;
  });
  await p.screenshot({ path: h.out('composite-group-before-out.png') });
  if (free && grip) await drag(grip, free);
  dut = await enumText();
  expect(!/\{region "Startup"\}[^{]*ERROR[^{]*\{endregion\}/.test(dut) && /ERROR is in no composite/.test(await status()), `dropped outside: out of it (${await status()})`);

  // Startup dragged by its title: its box and its states moved alike
  const titleAt = async () => p.evaluate(() => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area svg g.cluster')].find((x) => (x.querySelector('.cluster-label')?.textContent ?? '').trim() === 'Startup');
    const t = c?.querySelector('.cluster-label')?.getBoundingClientRect();
    return t ? { x: t.x + t.width / 2, y: t.y + t.height / 2 } : null;
  });
  const t0 = await titleAt();
  const c0 = await cluster('Startup');
  const d0 = await box('DISABLED');
  const n0 = await box('ENABLING');
  if (t0) await drag(t0, { x: t0.x + 60, y: t0.y + 40 });
  const c1 = await cluster('Startup');
  const d1 = await box('DISABLED');
  const n1 = await box('ENABLING');
  const moved = (a, b) => [Math.round(b.x - a.x), Math.round(b.y - a.y)];
  const cm = c0 && c1 ? [Math.round(c1.left - c0.left), Math.round(c1.top - c0.top)] : null;
  expect(!!t0 && !!cm && cm[0] > 20 && cm[1] > 10 && moved(d0, d1).join() === cm.join() && moved(n0, n1).join() === cm.join(), `Startup dragged by its title: its box ${cm?.join(', ')}, DISABLED ${moved(d0, d1).join(', ')}, ENABLING ${moved(n0, n1).join(', ')}`);
  dut = await enumText();
  expect(/\{region "Startup"\}\s*\n\s*DISABLED,\s*\n\s*ENABLING,\s*\n\s*\{endregion\}/.test(dut), 'moved, not regrouped: the enum as it was');

  // Ungroup (its menu): its markers out, its states kept
  const t2 = await titleAt();
  if (t2) await p.mouse.click(t2.x, t2.y, { button: 'right' });
  const ung = await p.waitForSelector('#context-menu-composite-ungroup-btn', { timeout: 4000 }).catch(() => null);
  expect(!!ung, "Startup's menu: Ungroup");
  if (ung) await ung.click();
  await h.sleep(1800);
  dut = await enumText();
  expect(!/\{region "Startup"\}/.test(dut) && /DISABLED,/.test(dut) && /ENABLING,/.test(dut) && !(await cluster('Startup')), 'Ungroup: its markers gone, its states kept');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
