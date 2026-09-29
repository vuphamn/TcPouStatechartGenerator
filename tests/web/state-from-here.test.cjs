// Right-click a state > Add new state from here…: its name, then the condition; the new state (enum member,
// doState() branch) and the transition to it, shown on the canvas
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

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
  const editor = async (tab, id) => {
    await p.click(`#dock-tab-${tab}`);
    await p.waitForSelector(`#${id}`);
    await h.sleep(400);
    const v = await p.$eval(`#${id}`, (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return v;
  };
  const waitFor = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await h.sleep(200); } return false; };

  await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), S('CLAMPED'));
  await h.sleep(1200);
  const pt = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, S('CLAMPED'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  expect(await p.evaluate(() => { const b = document.getElementById('context-menu-add-state-from-btn'); b?.click(); return !!b; }), 'the state\'s menu: Add new state from here…');
  await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
  const name = await p.$eval('#text-prompt-input', (e) => e.value);
  expect(name === S('CLAMPED_NEXT'), `the name offered: ${name}`);
  await p.keyboard.press('Enter');
  await h.sleep(400);
  const title = await p.$eval('#text-prompt-dialog', (e) => e.getAttribute('aria-label')).catch(() => '');
  expect(title === `Transition ${S('CLAMPED')} → ${S('CLAMPED_NEXT')}`, `then the condition: "${title}"`);
  await p.evaluate(() => document.getElementById('text-prompt-input').select());
  await p.keyboard.type('bNextStep');
  await p.keyboard.press('Enter');
  expect(await waitFor(() => p.evaluate((k) => !!document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${k}"]`), `${S('CLAMPED')}->${S('CLAMPED_NEXT')}`), 20000), 'the new state and the transition on the canvas');
  await waitFor(() => p.evaluate((id) => !!document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`), S('CLAMPED_NEXT')), 10000);
  await h.sleep(1500);
  const inView = await p.evaluate((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    if (!n) return false;
    const r = n.getBoundingClientRect();
    const a = document.getElementById('mermaid-canvas-area').getBoundingClientRect();
    return r.x >= a.x && r.right <= a.right && r.y >= a.y && r.bottom <= a.bottom;
  }, S('CLAMPED_NEXT'));
  expect(inView, 'the canvas shows it');
  const code = await editor('method', 'method-implementation-editor');
  expect(/IF bNextStep THEN\s*\n\s*machineState := TABLEMANAGER_CLAMPED_NEXT;/.test(code) && /\n\s*TABLEMANAGER_CLAMPED_NEXT:\s*\n/.test(code), 'doState(): the transition and the new branch');
  const dut = await editor('enum', 'st-dut-editor');
  expect(dut.includes('TABLEMANAGER_CLAMPED_NEXT'), 'the enum has it');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
