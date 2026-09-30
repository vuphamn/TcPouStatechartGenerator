// A state dragged into a {region} composite: without Alt a hint only; with Alt held on release its enum member moves
// into the region (and the chart draws it there); Alt-dragged out again: out of the region
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;
const MIME = 'application/x-kss-statechart-element';

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
  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  const box = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height } : null; }, id);
  const cluster = (label) => p.evaluate((label) => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim() === label);
    const r = c && (c.querySelector(':scope > rect') ?? c).getBoundingClientRect();
    return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, label);
  const enumText = async () => {
    await p.click('#dock-tab-enum');
    await p.waitForSelector('#st-dut-editor');
    await h.sleep(400);
    const v = await p.$eval('#st-dut-editor', (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return v;
  };
  const status = () => p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  const drag = async (from, to, alt) => {
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    for (let i = 1; i <= 20; i++) await p.mouse.move(from.x + ((to.x - from.x) * i) / 20, from.y + ((to.y - from.y) * i) / 20);
    await h.sleep(150);
    if (alt) await p.keyboard.down('Alt');
    await p.mouse.up();
    if (alt) await p.keyboard.up('Alt');
    await h.sleep(1500);
  };

  // A composite "Clamp" around CLAMPED (the palette)
  await goTo(S('CLAMPED'));
  let b = await box(S('CLAMPED'));
  await p.evaluate((x, y, MIME) => {
    const dt = new DataTransfer();
    dt.setData(MIME, 'composite');
    const el = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, b.x, b.y, MIME);
  await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
  await p.evaluate(() => document.getElementById('text-prompt-input').select());
  await p.keyboard.type('Clamp');
  await p.keyboard.press('Enter');
  await h.sleep(1500);
  expect(!!(await cluster('Clamp')), 'the composite Clamp');
  // Its box: sand, dashed, tinted, apart from the grey edges and the states (in the SVG itself: the exports keep it);
  // the light themes: a darker sand
  const look = () => p.evaluate(() => {
    const c = [...document.querySelectorAll('#mermaid-canvas-area g.cluster')].find((x) => (x.querySelector('.cluster-label, .nodeLabel, text')?.textContent ?? '').trim() === 'Clamp');
    const r = c?.querySelector(':scope > rect');
    if (!r) return null;
    const cs = getComputedStyle(r);
    return { stroke: cs.stroke, dash: cs.strokeDasharray, fill: cs.fill, inSvg: !!r.ownerSVGElement.querySelector('style.kss-composite-style') };
  });
  const darkLook = await look();
  expect(darkLook?.stroke === 'rgb(200, 184, 138)' && /^8(px)?,? 4(px)?$/.test(darkLook.dash) && /rgba\(200, 184, 138, 0\.06\)/.test(darkLook.fill) && darkLook.inSvg, `the composite's box, dark: ${JSON.stringify(darkLook)}`);
  await p.select('#mermaid-theme-select', 'default');
  await h.sleep(2500);
  const lightLook = await look();
  expect(lightLook?.stroke === 'rgb(138, 109, 31)' && lightLook.inSvg, `... light (default): ${JSON.stringify(lightLook)}`);
  await p.select('#mermaid-theme-select', 'dark');
  await h.sleep(2500);
  // (stateDiagram-v2 draws a composite as an outer box and its body: the outer one sand, dashed; back to flowchart)
  await p.click('#format-statediagram-btn');
  await h.sleep(3000);
  const stateLook = await p.evaluate(() => {
    const r = document.querySelector('#mermaid-canvas-area .statediagram-cluster > rect.outer, #mermaid-canvas-area .statediagram-cluster > g:not(.cluster-label) > :is(rect.outer, path)');
    if (!r) return null;
    const cs = getComputedStyle(r);
    return { stroke: cs.stroke, dash: cs.strokeDasharray };
  });
  expect(stateLook?.stroke === 'rgb(200, 184, 138)' && /^8(px)?,? 4(px)?$/.test(stateLook.dash), `... stateDiagram-v2: ${JSON.stringify(stateLook)}`);
  await p.click('#format-flowchart-btn').catch(() => {});
  await h.sleep(3000);

  // UNCLAMP_START into Clamp: without Alt a hint, nothing moves
  const Y = S('UNCLAMP_START');
  await goTo(S('CLAMPED'));
  const target = async () => {
    const c = await cluster('Clamp');
    const n = await box(S('CLAMPED'));
    return { x: Math.min(c.right - 6, n.x + n.w / 2 + 12), y: Math.min(c.bottom - 4, n.y + n.h / 2 + 6) };
  };
  // (another state for the hint: the one dropped there stays drawn there, over CLAMPED)
  const Z = S('UNCLAMPING');
  b = await box(Z);
  await drag(b, await target(), false);
  expect(/Hold Alt while dropping to move TABLEMANAGER_UNCLAMPING into Clamp/.test(await status()), `without Alt: ${await status()}`);
  let dut = await enumText();
  expect(!/\{region "Clamp"\}[\s\S]*TABLEMANAGER_UNCLAMPING[\s\S]*\{endregion\}/.test(dut), 'not moved');

  // With Alt: into Clamp
  await goTo(Y);
  b = await box(Y);
  await drag(b, await target(), true);
  dut = await enumText();
  expect(/\{region "Clamp"\}\s*\n\s*TABLEMANAGER_CLAMPED,\s*\n\s*TABLEMANAGER_UNCLAMP_START,?\s*\n\s*\{endregion\}/.test(dut), 'with Alt: its enum member in the region');
  expect(/TABLEMANAGER_UNCLAMP_START is in Clamp/.test(await status()), `status: ${await status()}`);
  const inside = async (id) => { const c = await cluster('Clamp'); const n = await box(id); return !!c && !!n && n.x > c.left && n.x < c.right && n.y > c.top && n.y < c.bottom; };
  await goTo(Y);
  expect(await inside(Y), 'the chart draws it in Clamp');

  // With Alt, out again (to the empty canvas beside the composite)
  b = await box(Y);
  const c = await cluster('Clamp');
  await drag(b, { x: c.left - 60, y: c.top - 40 }, true);
  dut = await enumText();
  expect(!/\{region "Clamp"\}[\s\S]*TABLEMANAGER_UNCLAMP_START[\s\S]*\{endregion\}/.test(dut) && /TABLEMANAGER_UNCLAMP_START/.test(dut), 'with Alt out of it: out of the region');
  // (every edge moved on the canvas still orthogonal, as ELK draws it: not only the ones checked above)
  const slantedLeft = await h.reroutedSlanted(p);
  expect(slantedLeft.length === 0, `the moved edges on the canvas orthogonal (${slantedLeft.slice(0, 3).join(" | ") || "none slanted"})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
