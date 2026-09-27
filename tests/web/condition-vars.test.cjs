// New Transition's condition: typing a name lists the POU's variables that match it (the match marked), arrows and
// Enter pick one; Ctrl+Space lists them all; a name that is not declared can be declared there (scope, type,
// comment), and is written into the POU's declaration with the transition. Enter with no match confirms as before;
// an undeclared name is pointed out.
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

  const goTo = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  const nodePoint = (id) => p.evaluate((id) => {
    const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  const newTransition = async (from, to) => {
    await goTo(from);
    let pt = await nodePoint(from);
    await p.mouse.click(pt.x, pt.y, { button: 'right' });
    await h.sleep(400);
    await p.evaluate(() => document.getElementById('context-menu-add-transition-btn')?.click());
    await goTo(to);
    pt = await nodePoint(to);
    await p.mouse.click(pt.x, pt.y);
    await p.waitForSelector('#text-prompt-input', { timeout: 5000 });
    await h.sleep(300);
  };
  const listed = () => p.$$eval('#text-prompt-var-list .text-prompt-var', (r) => r.map((x) => ({ name: x.getAttribute('data-name'), mark: x.querySelector('mark')?.textContent ?? '', text: x.textContent })));
  const value = () => p.$eval('#text-prompt-input', (e) => e.value);
  const editor = async (tab, id) => {
    await p.click(`#dock-tab-${tab}`);
    await p.waitForSelector(`#${id}`);
    await h.sleep(400);
    const v = await p.$eval(`#${id}`, (e) => e.value);
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return v;
  };

  // 1. Typing filters: every row has what is typed, marked
  await newTransition(S('IDLE_FEED_OFF'), S('CLAMPPING'));
  expect(!!(await p.$('#text-prompt-vars-btn')), 'New Transition: a Variables button by the condition');
  await p.keyboard.type('cmd_b', { delay: 20 });
  await h.sleep(300);
  let rows = await listed();
  await p.screenshot({ path: h.out('condition-vars.png') });
  expect(rows.length > 1 && rows.every((r) => /cmd_b/i.test(r.name) && /^cmd_b$/i.test(r.mark)), `"cmd_b": ${rows.length} variables, all with it (${rows.slice(0, 4).map((r) => r.name).join(', ')})`);
  expect(rows.every((r) => /BOOL|INT|TIME|REAL|\w/.test(r.text) && /VAR/.test(r.text) || /doState/.test(r.text)), 'each with its type and scope');
  await p.keyboard.type('Ho', { delay: 20 });
  await h.sleep(300);
  rows = await listed();
  expect(rows.length >= 1 && rows.every((r) => /cmd_bHo/i.test(r.name)) && rows.length < 4, `"cmd_bHo": narrowed to ${rows.map((r) => r.name).join(', ')}`);
  await p.keyboard.press('Enter');
  await h.sleep(200);
  expect((await value()) === rows[0].name && !(await p.$('#text-prompt-var-list')), `Enter picks it: "${await value()}", the list closed`);
  const picked = rows[0].name;

  // 2. Not declared: Declare new variable…, its type guessed, a comment; written with the transition
  await p.keyboard.type(' AND bDoorSensor', { delay: 20 });
  await h.sleep(300);
  expect((await listed()).length === 0 && !!(await p.$('#text-prompt-declare-new')), '"bDoorSensor": no variable, "Declare new variable bDoorSensor…"');
  await p.click('#text-prompt-declare-new');
  await p.waitForSelector('#text-prompt-declare-form');
  const form = await p.evaluate(() => ({ name: document.getElementById('text-prompt-declare-name').value, type: document.getElementById('text-prompt-declare-type').value, scope: document.getElementById('text-prompt-declare-scope').value }));
  expect(form.name === 'bDoorSensor' && form.type === 'BOOL' && form.scope === 'VAR_INPUT', `the form: ${JSON.stringify(form)}`);
  expect(await p.$eval('#text-prompt-submit', (e) => e.disabled), 'Add transition waits for the form');
  await p.type('#text-prompt-declare-comment', 'door closed');
  await p.click('#text-prompt-declare-ok');
  await h.sleep(300);
  const chips = await p.$$eval('.text-prompt-new-var', (c) => c.map((x) => x.textContent.trim()));
  expect(chips.length === 1 && /VAR_INPUT bDoorSensor : BOOL/.test(chips[0]) && (await value()) === `${picked} AND bDoorSensor`, `declared: ${chips.join(' | ')}; the condition: "${await value()}"`);

  // 3. Ctrl+Space: all of them (the new one too); Escape closes only the list
  await p.keyboard.down('Control'); await p.keyboard.press('Space'); await p.keyboard.up('Control');
  await h.sleep(300);
  rows = await listed();
  expect(rows.some((r) => r.name === 'bDoorSensor' && /VAR_INPUT \(new\)/.test(r.text)), `Ctrl+Space: the list again, for the name at the caret (${rows.length}), the new one in it`);
  await p.keyboard.press('Escape');
  await h.sleep(200);
  expect(!(await p.$('#text-prompt-var-list')) && !!(await p.$('#text-prompt-dialog')), 'Escape: the list closes, the dialog stays');
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  expect(!(await p.$('#text-prompt-dialog')), 'Enter: Add transition');
  const code = await editor('method', 'method-implementation-editor');
  expect(code.includes(`IF ${picked} AND bDoorSensor THEN`), 'doState(): the transition with the condition');
  const decl = await editor('pou', 'pou-declaration-editor');
  expect(/VAR_INPUT[^]*?\n\s*bDoorSensor : BOOL; \/\/ door closed\r?\n[^]*?END_VAR/.test(decl) && decl.split('bDoorSensor').length === 2, 'the POU declaration: bDoorSensor : BOOL; // door closed in VAR_INPUT');

  // 4. An undeclared name typed and confirmed with Enter: pointed out, not declared
  await newTransition(S('CLAMPPING'), S('IDLE_FEED_OFF'));
  await p.keyboard.type('bFromGvl', { delay: 20 });
  await h.sleep(300);
  const hint = await p.$eval('#text-prompt-undeclared', (e) => e.textContent).catch(() => '');
  expect(/Not declared in the POU:\s*bFromGvl/.test(hint), `pointed out: ${hint.slice(0, 60)}`);
  await p.keyboard.press('Enter');
  await h.sleep(1200);
  const code2 = await editor('method', 'method-implementation-editor');
  const decl2 = await editor('pou', 'pou-declaration-editor');
  expect(!(await p.$('#text-prompt-dialog')) && code2.includes('IF bFromGvl THEN') && !decl2.includes('bFromGvl'), 'Enter: added as typed, nothing declared');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
