// A state copied and pasted on the canvas (Ctrl+C / Ctrl+V): a new state with a copy of its code, the name asked for;
// a transition into it added visually; the state deleted (Delete, confirmed): its code, the transitions into it
// and its enum member go; a transition deleted from its menu. The Method and Enum Editors show the code.
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
  const doState = () => editor('method', 'method-implementation-editor');
  const enumText = () => editor('enum', 'st-dut-editor');
  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  const nodePoint = (id) => p.evaluate((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  const clickNode = async (id, opts) => {
    await goTo(id);
    const pt = await nodePoint(id);
    await p.mouse.click(pt.x, pt.y, opts);
    await h.sleep(500);
  };
  const hasNode = (id) => p.evaluate((id) => !!document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`), id);
  const hasEdge = (from, to) => p.evaluate((from, to) => !!document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${from}->${to}"]`), from, to);
  const menuClick = (id) => p.evaluate((id) => { const b = document.getElementById(id); b?.click(); return !!b; }, id);
  const waitFor = async (fn, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await fn()) return true; await h.sleep(200); } return false; };

  // 1. Copy CLAMPED, paste: the rename prompt for the copy
  await clickNode(S('CLAMPED'));
  await p.keyboard.down('Control'); await p.keyboard.press('c'); await p.keyboard.up('Control');
  await h.sleep(300);
  expect(/Copied TABLEMANAGER_CLAMPED/.test(await p.$eval('#status-message', (e) => e.textContent).catch(() => '')), 'Ctrl+C: copied');
  await p.keyboard.down('Control'); await p.keyboard.press('v'); await p.keyboard.up('Control');
  const prompt = await waitFor(async () => (await p.$('#text-prompt-input')) && /TABLEMANAGER_CLAMPED_COPY/.test(await p.$eval('#text-prompt-input', (e) => e.value)));
  expect(prompt, 'Ctrl+V: a new state, its name asked for (TABLEMANAGER_CLAMPED_COPY)');
  expect(await hasNode(S('CLAMPED_COPY')), 'the copy is on the canvas');
  const NEW = S('CLAMPED_TWO');
  await p.evaluate(() => document.getElementById('text-prompt-input').select());
  await p.keyboard.press('Backspace');
  await p.keyboard.type(NEW);
  await p.keyboard.press('Enter');
  expect(await waitFor(() => hasNode(NEW)), `renamed to ${NEW}`);
  expect(await hasEdge(NEW, S('UNCLAMP_START')) && await hasEdge(NEW, S('REFEED_START')), 'it has the transitions out of CLAMPED');
  let code = await doState();
  expect(new RegExp(`\\n\\t${NEW}:\\r?\\n\\t\\tIF \\(bFirstPass\\) THEN`).test(code) && code.includes(`\t${S('CLAMPED')}:`), 'doState(): its branch, a copy of CLAMPED\'s');
  let dut = await enumText();
  expect(new RegExp(`\\b${NEW}\\b`).test(dut), 'the enum has it');

  // 2. A transition into it: Add transition from here on IDLE_FEED_OFF, then a click on the copy
  await clickNode(S('IDLE_FEED_OFF'), { button: 'right' });
  expect(await menuClick('context-menu-add-transition-btn'), 'Add transition from here…');
  await goTo(NEW);
  const t = await nodePoint(NEW);
  await p.mouse.click(t.x, t.y);
  await p.waitForSelector('#text-prompt-input', { timeout: 5000 }).catch(() => {});
  await p.evaluate(() => document.getElementById('text-prompt-input').select());
  await p.keyboard.type('bToCopy');
  await p.keyboard.press('Enter');
  expect(await waitFor(() => hasEdge(S('IDLE_FEED_OFF'), NEW)), `the transition IDLE_FEED_OFF → ${NEW}`);

  // 3. Delete a transition from its menu: CLAMPED → REFEED_START
  await goTo(S('CLAMPED'));
  const ep = await p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
    }
    return null;
  }, `${S('CLAMPED')}->${S('REFEED_START')}`);
  await p.mouse.click(ep.x, ep.y, { button: 'right' });
  await h.sleep(400);
  expect(await menuClick('context-menu-delete-transition-btn'), 'the transition\'s menu: Delete transition…');
  await p.waitForSelector('#text-prompt-dialog', { timeout: 3000 }).catch(() => {});
  const tDetails = await p.$eval('#text-prompt-details', (e) => e.innerText).catch(() => '');
  expect(/ELSIF \(cmd_bStartReClamp\) THEN/.test(tDetails) && /machineState := TABLEMANAGER_REFEED_START;/.test(tDetails) && !(await p.$('#text-prompt-input')), `confirmation with its code: ${tDetails.split('\n').length} lines`);
  await p.keyboard.press('Enter');
  expect(await waitFor(async () => !(await hasEdge(S('CLAMPED'), S('REFEED_START')))), 'confirmed (Enter): the transition is gone');
  code = await doState();
  const clamped = code.slice(code.indexOf(`\t${S('CLAMPED')}:`), code.indexOf(`\t${NEW}:`));
  expect(!clamped.includes('REFEED_START') && /IF \(cmd_bUnclamp\) THEN[\s\S]*END_IF/.test(clamped), 'doState(): the ELSIF arm gone, the IF stays');

  // 4. Delete the copy: Delete, the confirmation lists what goes
  await clickNode(NEW);
  await p.keyboard.press('Delete');
  await p.waitForSelector('#text-prompt-dialog', { timeout: 3000 }).catch(() => {});
  const details = await p.$eval('#text-prompt-details', (e) => e.innerText).catch(() => '');
  expect(/The enum member TABLEMANAGER_CLAMPED_TWO/.test(details) && /branch in doState\(\)/.test(details) && /branch in getStateDescription\(\)/.test(details) && /The transition TABLEMANAGER_IDLE_FEED_OFF → TABLEMANAGER_CLAMPED_TWO/.test(details), `the confirmation: ${details.replace(/\n/g, ' | ')}`);
  // Cancel first: nothing changes
  await p.keyboard.press('Escape');
  await h.sleep(500);
  expect(!(await p.$('#text-prompt-dialog')) && (await hasNode(NEW)), 'Esc: nothing deleted');
  await clickNode(NEW, { button: 'right' });
  expect(await menuClick('context-menu-delete-state-btn'), 'the state\'s menu: Delete state…');
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 });
  await p.click('#text-prompt-submit');
  expect(await waitFor(async () => !(await hasNode(NEW))), 'deleted: the node is gone');
  expect(!(await hasEdge(S('IDLE_FEED_OFF'), NEW)), 'and the transition into it');
  code = await doState();
  expect(!code.includes(NEW) && !code.includes('bToCopy'), 'doState() and getStateDescription() without it');
  dut = await enumText();
  expect(!new RegExp(`\\b${NEW}\\b`).test(dut), 'the enum without it');
  await p.screenshot({ path: h.out('state-copy-delete.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
