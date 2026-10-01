// Bookmarks: a state bookmarked from the canvas and from Identified States (a badge on both), shown at its CASE
// label in the Method Editor's gutter; the editor's PLC Bookmarks submenu (Toggle on any line, a label line being
// its state's bookmark; Next Bookmark; Clear All) and Ctrl+F2; kept after a reload
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;
const MENU = '[aria-label="Editor Context Menu"]';
const ID = 'method-implementation-editor';

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
  const nodePoint = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const markers = () => p.$$eval('#mermaid-diagram-svg-container g.state-bookmark-marker', (m) => m.map((x) => x.getAttribute('data-state-id')).sort());
  const cards = () => p.$$eval('[id^="state-bookmark-"]', (m) => m.map((x) => x.id.replace('state-bookmark-', '')).sort());
  const gutter = () => p.$$eval(`#${ID}-gutter .st-bookmark`, (m) => m.map((x) => Number(x.getAttribute('data-bookmark-line'))).sort((a, b) => a - b));
  const lineOf = (text) => p.$eval(`#${ID}`, (e, text) => e.value.split('\n').findIndex((l) => l.includes(text)) + 1, text);

  // 1. The canvas: Add bookmark on CLAMPED
  await goTo(S('CLAMPED'));
  let pt = await nodePoint(S('CLAMPED'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  expect(/Add bookmark/.test(await p.$eval('#context-menu-bookmark-state-btn', (e) => e.textContent).catch(() => '')), 'the state\'s menu: Add bookmark');
  await p.click('#context-menu-bookmark-state-btn');
  await h.sleep(600);
  expect((await markers()).join() === S('CLAMPED') && (await cards()).join() === S('CLAMPED'), `a badge on the state and on its card: ${await markers()} / ${await cards()}`);
  // (a close look)
  await p.mouse.move(pt.x, pt.y);
  await p.keyboard.down('Control');
  for (let i = 0; i < 8; i++) {
    await p.mouse.wheel({ deltaY: -120 });
    await h.sleep(50);
  }
  await p.keyboard.up('Control');
  await h.sleep(800);
  const clip = await p.evaluate((s) => { const r = document.querySelector(`#mermaid-diagram-svg-container g.node[data-state-id="${s}"]`).getBoundingClientRect(); return { x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 }; }, S('CLAMPED'));
  await p.screenshot({ path: h.out('bookmark-state.png'), clip });
  const card = await p.evaluate((s) => { const r = document.getElementById(`state-list-item-${s}`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, S('CLAMPED'));
  await p.screenshot({ path: h.out('bookmark-card.png'), clip: card });

  // 2. Identified States: right-click a card
  await p.evaluate((s) => document.getElementById(`state-list-item-${s}`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 400, button: 2 })), S('IDLE_FEED_OFF'));
  await h.sleep(300);
  expect(/Add bookmark/.test(await p.$eval('#state-list-bookmark-btn', (e) => e.textContent).catch(() => '')), 'a card\'s menu: Add bookmark');
  await p.click('#state-list-bookmark-btn');
  await h.sleep(600);
  expect((await markers()).join() === [S('CLAMPED'), S('IDLE_FEED_OFF')].sort().join() && (await cards()).length === 2, `two bookmarks: ${await markers()}`);

  // 3. The Method Editor: at their CASE labels
  await p.click('#dock-tab-method');
  await p.waitForSelector(`#${ID}`);
  await h.sleep(800);
  const clampedLine = await lineOf(`\t${S('CLAMPED')}:`);
  const idleLine = await lineOf(`\t${S('IDLE_FEED_OFF')}:`);
  let marks = await gutter();
  expect(marks.join() === [idleLine, clampedLine].sort((a, b) => a - b).join(), `the gutter marks the label lines ${idleLine}, ${clampedLine}: ${marks.join(', ')}`);

  // 4. PLC Bookmarks on a line of code (not a label)
  const rightClickLine = async (text) => {
    await p.evaluate((id, text) => {
      const ta = document.getElementById(id);
      const at = ta.value.indexOf(text);
      ta.focus();
      ta.setSelectionRange(at + 2, at + 2);
    }, ID, text);
    for (let i = 0; i < 3; i++) {
      await h.sleep(500);
      await p.evaluate((id) => document.getElementById(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 })), ID);
      await h.sleep(300);
      if (await p.$(MENU)) return true;
    }
    return false;
  };
  const codeLine = 'cmd_bHome := FALSE;';
  const cLine = await lineOf(codeLine);
  expect(await rightClickLine(codeLine), 'the editor\'s menu');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(200);
  const sub = await p.$$eval('#editor-menu-bookmarks-sub button', (b) => b.map((x) => x.textContent.trim()));
  expect(sub.length === 6 && /Show All Bookmarks/.test(sub[5]) && /Toggle Bookmark/.test(sub[0]) && /Next Bookmark/.test(sub[1]) && /Previous Bookmark/.test(sub[2]) && /Clear All Bookmarks/.test(sub[3]), `PLC Bookmarks: ${sub.join(' | ')}`);
  await p.click('#editor-menu-bookmark-toggle');
  await h.sleep(500);
  marks = await gutter();
  expect(marks.includes(cLine) && marks.length === 3, `Toggle Bookmark on line ${cLine}: ${marks.join(', ')}`);

  // A label line: its state's bookmark (removed on the canvas too)
  expect(await rightClickLine(`\t${S('CLAMPED')}:`), 'the menu on CLAMPED\'s label line');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(200);
  expect(/Remove Bookmark/.test(await p.$eval('#editor-menu-bookmark-toggle', (e) => e.textContent)), 'on a bookmarked line: Remove Bookmark');
  await p.click('#editor-menu-bookmark-toggle');
  await h.sleep(500);
  marks = await gutter();
  expect(!marks.includes(clampedLine) && (await cards()).join() === S('IDLE_FEED_OFF'), `CLAMPED's bookmark removed from the label line: gutter ${marks.join(', ')}, cards ${await cards()}`);

  // Next Bookmark from the top
  expect(await rightClickLine('CASE'), 'the menu at the top');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(200);
  await p.click('#editor-menu-bookmark-next');
  // (its message, a moment later on a busy machine)
  await p.waitForFunction(() => /Bookmark \d+ of/.test(document.getElementById('method-jump-toast')?.textContent ?? ''), { timeout: 4000 }).catch(() => {});
  const toast = await p.$eval('#method-jump-toast', (e) => e.textContent).catch(() => '');
  expect(new RegExp(`Bookmark 1 of 2 \\(line ${Math.min(idleLine, cLine)}\\)`).test(toast), `Next Bookmark: ${toast}`);

  // Ctrl+F2 on the caret's line
  const other = 'cmd_bUnclamp := FALSE;';
  const oLine = await lineOf(other);
  await p.evaluate((id, text) => { const ta = document.getElementById(id); const at = ta.value.indexOf(text); ta.focus(); ta.setSelectionRange(at, at); }, ID, other);
  await p.keyboard.down('Control'); await p.keyboard.press('F2'); await p.keyboard.up('Control');
  await h.sleep(500);
  marks = await gutter();
  expect(marks.includes(oLine), `Ctrl+F2 on line ${oLine}: ${marks.join(', ')}`);

  // 5. Kept after a reload
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1500);
  expect((await cards()).join() === S('IDLE_FEED_OFF') && (await markers()).join() === S('IDLE_FEED_OFF'), `after a reload: the state's bookmark (cards ${await cards()}, canvas ${await markers()}, nodes ${await p.evaluate((s) => [...document.querySelectorAll(`g.node[data-state-id="${s}"]`)].map((n) => `${n.closest('svg')?.parentElement?.id || n.closest('svg')?.id || '?'}:${n.querySelectorAll('g.state-bookmark-marker').length}`).join(' '), S('IDLE_FEED_OFF'))})`);
  await p.click('#dock-tab-method');
  await p.waitForSelector(`#${ID}`);
  await h.sleep(800);
  marks = await gutter();
  expect(marks.join() === [idleLine, cLine, oLine].sort((a, b) => a - b).join(), `and the lines: ${marks.join(', ')}`);
  const fill = await p.$eval('#mermaid-diagram-svg-container g.state-bookmark-marker path', (e) => getComputedStyle(e).fill).catch(() => '');
  expect(fill === 'rgb(56, 189, 248)', `the ribbon's colour on the canvas: ${fill} (sky blue, as in Identified States)`);
  await p.screenshot({ path: h.out('bookmarks.png') });

  // The list of all bookmarks: one state, two lines; a click opens the line
  expect(await rightClickLine(codeLine), 'the menu');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(200);
  await p.click('#editor-menu-bookmark-list');
  await p.waitForSelector('#bookmarks-dialog', { timeout: 3000 }).catch(() => {});
  const listed = await p.$$eval('#bookmarks-dialog .bookmark-row', (r) => r.map((x) => `${x.getAttribute('data-kind')}:${x.getAttribute('data-state') || x.getAttribute('data-method')}:${x.getAttribute('data-line')}`));
  expect(listed.length === 3 && listed[0] === `state:${S('IDLE_FEED_OFF')}:${idleLine}` && listed.includes(`line:doState:${cLine}`) && listed.includes(`line:doState:${oLine}`), `Show All Bookmarks: ${listed.join(', ')}`);
  await p.keyboard.press('Escape');
  // 6. Clear All (the POU)
  expect(await rightClickLine(codeLine), 'the menu');
  await p.click('#editor-menu-bookmarks');
  await h.sleep(200);
  await p.click('#editor-menu-bookmark-clear-all');
  await h.sleep(600);
  expect((await gutter()).length === 0 && (await cards()).length === 0 && (await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('kss.bookmarks.')).length)) === 0, 'Clear All Bookmarks (the POU): none left');
  // The wheel over a state's / a transition's right-click menu: no zoom
  await p.click('#dock-tab-diagram');
  await h.sleep(500);
  const zoomNow = () => p.evaluate(() => document.getElementById('zoom-in-button').previousElementSibling?.textContent?.trim());
  const wheelOverMenu = async (x, y) => {
    await p.mouse.click(x, y, { button: 'right' });
    await h.sleep(400);
    const m = await p.$eval('#diagram-context-menu', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }).catch(() => null);
    if (!m) return null;
    const before = await zoomNow();
    await p.mouse.move(m.x, m.y);
    for (let i = 0; i < 5; i++) {
      await p.mouse.wheel({ deltaY: -120 });
      await h.sleep(60);
    }
    await h.sleep(300);
    const after = await zoomNow();
    await p.keyboard.press('Escape');
    await h.sleep(200);
    return { before, after };
  };
  await goTo(S('CLAMPED'));
  pt = await nodePoint(S('CLAMPED'));
  const onNode = await wheelOverMenu(pt.x, pt.y);
  expect(!!onNode && onNode.before === onNode.after, `the wheel over a state's menu: zoom ${onNode?.before} → ${onNode?.after}`);
  const ep = await p.evaluate(() => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path[data-edge-key]')].find((x) => x.getBoundingClientRect().width > 30);
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.3, 0.5, 0.7, 0.4, 0.6]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === el.getAttribute('data-edge-key')) return { x, y };
    }
    return null;
  });
  const onEdge = ep ? await wheelOverMenu(ep.x, ep.y) : null;
  expect(!!onEdge && onEdge.before === onEdge.after, `the wheel over a transition's menu: zoom ${onEdge?.before} → ${onEdge?.after}`);
  // The menu's filter: typing leaves the matching commands, Enter runs the first
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  expect(await p.evaluate(() => document.activeElement?.id === 'diagram-context-menu-filter'), 'the menu opens with its filter focused');
  const allCount = await p.$$eval('#diagram-context-menu button[id^="context-menu-"]', (b) => b.filter((x) => x.style.display !== 'none').length);
  await p.keyboard.type('refer', { delay: 20 });
  await h.sleep(200);
  const left = await p.$$eval('#diagram-context-menu button[id^="context-menu-"]', (b) => b.filter((x) => x.style.display !== 'none').map((x) => x.textContent.trim()));
  expect(left.length === 1 && /Find all references/.test(left[0]) && allCount > 8, `"refer": ${left.join(' | ')} (of ${allCount})`);
  await p.keyboard.press('Enter');
  await p.waitForSelector('#references-dialog', { timeout: 3000 }).catch(() => {});
  expect(!!(await p.$('#references-dialog')) && !(await p.$('#diagram-context-menu')), 'Enter: Find all references ran, the menu closed');
  await p.keyboard.press('Escape');
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(300);
  await p.keyboard.type('zzz', { delay: 20 });
  await h.sleep(150);
  expect(!!(await p.$('#diagram-context-menu-none')), 'no match: said so');
  await p.keyboard.press('Escape');
  await h.sleep(100);
  expect(!!(await p.$('#diagram-context-menu')) && (await p.$eval('#diagram-context-menu-filter', (e) => e.value)) === '', 'Esc: the filter cleared first');
  await p.keyboard.press('Escape');
  await h.sleep(200);
  expect(!(await p.$('#diagram-context-menu')), 'Esc again: closed');
  // (the canvas zooms up to 1000% of the chart's own size, and no further: a wide chart starts fitted, far below)
  for (let i = 0; i < 70; i++) await p.click('#zoom-in-button');
  await h.sleep(400);
  const zoomText = await p.evaluate(() => document.getElementById('zoom-in-button').previousElementSibling?.textContent?.trim() || [...document.querySelectorAll('button, span')].find((e) => /^\d+%$/.test(e.textContent.trim()) && e.closest('#mermaid-canvas-area, [id*="toolbar"], header'))?.textContent.trim());
  expect(zoomText === '1000%', `the canvas zooms in to ${zoomText}`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
