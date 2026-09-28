// A tab moved to a window of its own (Move to New Window): its content (the same editor, styled) in a browser
// window that can go to another monitor; closing that window brings the tab back (floating). The PLC Symbols tab
// after Machine Overview, with its "go live" message.
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

  // The PLC Symbols tab: after Machine Overview; not live, it says what to do
  const order = await p.$$eval('[data-dock-tab-header]', (e) => e.map((x) => x.getAttribute('data-dock-tab-header')));
  expect(order.indexOf('symbols') === order.indexOf('overview') + 1, `PLC Symbols right after Machine Overview: ${order.join(', ')}`);
  await p.click('#dock-tab-symbols');
  await h.sleep(500);
  const msg = await p.$eval('#symbol-browser-not-live', (e) => e.innerText).catch(() => '');
  expect(/Go live \(Live tab\) to browse the PLC's symbols/.test(msg), `not live: "${msg.split('\n')[0]}"`);

  // The Method Editor to a new window
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor');
  await h.sleep(400);
  const before = await p.$eval('#method-implementation-editor', (e) => e.value.length);
  const tab = await p.$('#dock-tab-method');
  const r = await tab.boundingBox();
  await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
  await h.sleep(300);
  await p.click('#dock-menu-new-window');
  // (the popup: a blank page holding the tab; the browser has another blank page of its own)
  let w = null;
  for (let i = 0; i < 40 && !w; i++) {
    await h.sleep(250);
    for (const t of browser.targets()) {
      if (t.type() !== 'page' || !/window.html/.test(t.url())) continue;
      const pg = await t.page().catch(() => null);
      if (pg && (await pg.evaluate(() => !!document.getElementById('dock-external-root')).catch(() => false))) w = pg;
    }
  }
  expect(!!w, 'a new window opens');
  if (w) {
    await h.sleep(800);
    const inWindow = await w.evaluate(() => {
      const ta = document.getElementById('method-implementation-editor');
      const bar = document.getElementById('dock-external-method');
      return { value: ta ? ta.value.length : -1, bg: bar ? getComputedStyle(bar).backgroundColor : '', title: document.title };
    });
    expect(inWindow.value === before && before > 0, `the Method Editor in it, its code kept (${inWindow.value} chars)`);
    expect(/rgb\(2, 6, 23\)|rgb\(3, 7, 18\)/.test(inWindow.bg) || (inWindow.bg && inWindow.bg !== 'rgba(0, 0, 0, 0)'), `styled like the app (${inWindow.bg})`);
    expect(/Method Editor/.test(inWindow.title), `titled: "${inWindow.title}"`);
    expect(/\/window\.html\?Method-Editor$/.test(w.url()), `its address names it (not about:blank): ${w.url()}`);
    expect(!(await p.$('#method-implementation-editor')), 'no longer in the app window');
    // It works there: typing changes the code
    await w.evaluate(() => { const ta = document.getElementById('method-implementation-editor'); ta.focus(); ta.setSelectionRange(0, 0); });
    await w.keyboard.type('(* from the other window *)');
    await h.sleep(400);
    const typed = await w.$eval('#method-implementation-editor', (e) => e.value.startsWith('(* from the other window *)'));
    expect(typed, 'the editor takes typing in its window');
    // Closing the window: back in the app, floating
    await w.close();
    await h.sleep(1500);
    expect(!!(await p.$('#dock-float-method')) && !!(await p.$('#dock-float-method #method-implementation-editor')), 'closed: the tab floats in the app again, with its editor');
  }
  // The Diagram in a window of its own: a key pressed there (not typing) reaches the app's shortcuts (M: minimap)
  const findPopup = async (id) => {
    for (let i = 0; i < 40; i++) {
      await h.sleep(250);
      for (const t of browser.targets()) {
        if (t.type() !== 'page' || !/window.html/.test(t.url())) continue;
        const pg = await t.page().catch(() => null);
        if (pg && (await pg.evaluate((id) => !!document.getElementById(id), id).catch(() => false))) return pg;
      }
    }
    return null;
  };
  await p.click('#dock-tab-diagram');
  await h.sleep(500);
  const dt = await (await p.$('#dock-tab-diagram')).boundingBox();
  await p.mouse.click(dt.x + dt.width / 2, dt.y + dt.height / 2, { button: 'right' });
  await h.sleep(300);
  await p.click('#dock-menu-new-window');
  const wd = await findPopup('dock-external-diagram');
  expect(!!wd, 'the Diagram in a window of its own');
  if (wd) {
    await h.sleep(1200);
    const minimap = () => wd.evaluate(() => !!document.getElementById('diagram-minimap-container') || !!document.getElementById('diagram-minimap-collapsed'));
    const before = await minimap();
    const area = await wd.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { x: r.x + r.width - 40, y: r.y + r.height - 60 }; });
    await wd.mouse.click(area.x, area.y);
    await wd.keyboard.press('m');
    await h.sleep(600);
    const after = await minimap();
    expect(before !== after, `M pressed in that window toggles the minimap (${before} → ${after})`);
    // A state moved in that window, then Ctrl+Z there: back where it was (the same Undo as in the main window)
    // (a state in view: the one whose middle is not under the toolbar or a panel)
    const pickId = await wd.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => { const r = n.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e?.closest('g.node') === n && r.width > 20 ? n.getAttribute('data-state-id') : null; }).find(Boolean));
    const at = () => wd.evaluate((id) => { const n = [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].find((x) => x.getAttribute('data-state-id') === id); const r = n?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, pickId);
    const n0 = pickId ? await at() : null;
    let undone = null;
    if (n0) {
      await wd.mouse.move(n0.x, n0.y);
      await wd.mouse.down();
      await wd.mouse.move(n0.x + 60, n0.y + 40, { steps: 6 });
      await wd.mouse.up();
      await h.sleep(500);
      const n1 = await at();
      await wd.evaluate(() => document.getElementById('mermaid-canvas-area')?.focus());
      await wd.keyboard.down('Control'); await wd.keyboard.press('z'); await wd.keyboard.up('Control');
      await h.sleep(600);
      const n2 = await at();
      undone = { moved: Math.hypot(n1.x - n0.x, n1.y - n0.y), back: Math.hypot(n2.x - n0.x, n2.y - n0.y) };
    }
    expect(!!undone && undone.moved > 20 && undone.back < 3, `moved in that window (${undone?.moved.toFixed(0)} px), Ctrl+Z there: back (${undone?.back.toFixed(1)} px off)`);
    // The app reloads: the window goes, the tab floats with "Reopen in its own window"
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await h.sleep(1500);
    expect(!!(await p.$('#dock-float-reopen-diagram')), 'after a reload: floating, with Reopen in its own window');
    await p.click('#dock-float-reopen-diagram');
    expect(!!(await findPopup('dock-external-diagram')), 'Reopen: in its own window again');
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
