const h = require('../lib/harness.cjs');
// Method Editor: the find box's variable dropdown (combobox)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await page.click('#dock-tab-method');
  await page.waitForSelector('#method-editor-find-input', { timeout: 10000 });
  await sleep(600);
  const bar = await page.$eval('#method-editor-find-bar', (e) => e.innerText);
  expect(!/Variables:/.test(bar), 'the variable chips are gone from the toolbar');

  // The chevron opens the whole list, grouped
  await page.click('#method-editor-find-variables-btn');
  await sleep(300);
  const list = await page.evaluate(() => {
    const lb = document.getElementById('method-editor-find-variables');
    if (!lb) return null;
    return {
      groups: [...lb.querySelectorAll('[role="group"]')].map((g) => `${g.getAttribute('aria-label')} (${g.querySelectorAll('[role="option"]').length})`),
      names: [...lb.querySelectorAll('[role="option"]')].map((o) => o.querySelector('span')?.textContent),
      first: lb.querySelector('[role="option"]')?.innerText.replace(/\s+/g, ' '),
    };
  });
  console.log('   groups:', list?.groups.join(', '), '| first:', list?.first);
  expect(list && list.names.length > 15, `all variables are offered (${list?.names.length}, the chips showed at most 15)`);
  expect(list && list.groups[0]?.startsWith('State variable') && list.names[0] === 'machineState', 'the state variable first');
  expect(list && list.groups.some((g) => /^Function block variables/.test(g)) && list.names.includes('cmd_bHome'), 'the function block\'s members are listed (cmd_bHome)');
  expect(await page.$eval('#method-editor-find-input', (e) => e.getAttribute('aria-expanded') === 'true'), 'combobox reports expanded');
  await page.screenshot({ path: path.join(h.OUT, 'find-combo.png'), clip: { x: 400, y: 60, width: 900, height: 480 } });

  // Picking one fills the box and finds it
  const opt = await page.$$('#method-editor-find-variables [role="option"]');
  const idx = list.names.indexOf('cmd_bHome');
  await opt[idx].click();
  await sleep(400);
  const value = await page.$eval('#method-editor-find-input', (e) => e.value);
  const badge = await page.$eval('#method-editor-find-bar', (e) => e.innerText.match(/(\d+) of (\d+)|No matches/)?.[0]);
  expect(value === 'cmd_bHome' && !(await page.$('#method-editor-find-variables')) && /of/.test(badge || ''), `picked cmd_bHome: list closed, matches "${badge}"`);

  // Typing filters; arrows + Enter pick
  await page.click('#method-editor-find-input', { clickCount: 3 });
  await page.keyboard.type('status_b');
  await sleep(300);
  const filtered = await page.$$eval('#method-editor-find-variables [role="option"] span:first-child', (s) => s.map((x) => x.textContent));
  expect(filtered.length > 0 && filtered.every((n) => /status_b/i.test(n)), `typing filters: ${filtered.slice(0, 5).join(', ')}${filtered.length > 5 ? ' ...' : ''}`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const activeId = await page.$eval('#method-editor-find-input', (e) => e.getAttribute('aria-activedescendant'));
  await page.keyboard.press('Enter');
  await sleep(300);
  const v2 = await page.$eval('#method-editor-find-input', (e) => e.value);
  expect(v2 === filtered[1] && activeId === 'find-variable-1', `ArrowDown x2 + Enter picked the second: ${v2}`);

  // Enter without a highlighted option still jumps to the next match; Esc closes the list, then clears
  await page.click('#method-editor-find-input', { clickCount: 3 });
  await page.keyboard.type('TABLEMANAGER_ERROR');
  await sleep(300);
  const before = await page.$eval('#method-editor-find-bar', (e) => e.innerText.match(/(\d+) of \d+/)?.[1]);
  await page.keyboard.press('Enter');
  await sleep(300);
  const after = await page.$eval('#method-editor-find-bar', (e) => e.innerText.match(/(\d+) of \d+/)?.[1]);
  expect(before === '1' && after === '2' && !(await page.$('#method-editor-find-variables')), `Enter goes to the next match (${before} -> ${after})`);
  await page.click('#method-editor-find-variables-btn');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  expect(!(await page.$('#method-editor-find-variables')) && (await page.$eval('#method-editor-find-input', (e) => e.value)) === 'TABLEMANAGER_ERROR', 'Esc closes the list and keeps the text');
  await page.keyboard.press('Escape');
  await sleep(200);
  expect((await page.$eval('#method-editor-find-input', (e) => e.value)) === '', 'a second Esc clears it');
  // A click elsewhere closes it
  await page.click('#method-editor-find-variables-btn');
  await sleep(200);
  await page.mouse.click(800, 700);
  await sleep(300);
  expect(!(await page.$('#method-editor-find-variables')), 'a click elsewhere closes the list');

  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
