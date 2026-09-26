const h = require('../lib/harness.cjs');
// POU Editor right-click menu: Go to Definition (declaration line / a method -> Method Editor / not found), F12,
// Find References, Copy, Toggle Block Fold (the block at the caret)
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
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(h.APP_ORIGIN, ['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 30000 });
  await page.click('#dock-tab-pou');
  await page.waitForSelector('#pou-implementation-editor');
  await sleep(400);

  // Right-click on a word: the caret goes there first (as a real right-click does)
  const rightClickWord = async (id, word, nth = 0) => {
    const pos = await page.evaluate((id, word, nth) => {
      const ta = document.getElementById(id);
      let at = -1;
      for (let i = 0; i <= nth; i++) at = ta.value.indexOf(word, at + 1);
      ta.focus();
      ta.setSelectionRange(at + 1, at + 1);
      const line = ta.value.slice(0, at).split('\n').length - 1;
      ta.scrollTop = Math.max(0, line * 20 - 60);
      ta.dispatchEvent(new Event('scroll'));
      const r = ta.getBoundingClientRect();
      return { x: r.x + 80, y: r.y + 8 + line * 20 - ta.scrollTop + 10 };
    }, id, word, nth);
    await sleep(100);
    await page.evaluate((id, x, y) => {
      document.getElementById(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    }, id, pos.x, pos.y);
    await sleep(200);
  };
  const menuItems = () => page.evaluate(() => {
    const m = document.querySelector('[aria-label="Editor Context Menu"]');
    return m ? [...m.querySelectorAll('button')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')) : null;
  });
  const clickItem = (label) => page.evaluate((label) => {
    const b = [...document.querySelectorAll('[aria-label="Editor Context Menu"] button')].find((x) => x.textContent.includes(label));
    b?.click();
    return !!b;
  }, label);
  const notice = () => page.$eval('#pou-editor-notice', (e) => e.textContent).catch(() => '');

  // In the declaration: a variable
  await rightClickWord('pou-declaration-editor', 'di_DoorSense');
  let items = await menuItems();
  expect(items && items.some((t) => /Go to Definition/.test(t)) && items.some((t) => /Find References/.test(t)) && items.some((t) => /Copy/.test(t)), `menu on di_DoorSense: ${items?.join(' | ')}`);
  expect(!items?.some((t) => /Toggle Block Fold/.test(t)), 'no fold item in the declaration');
  await clickItem('Go to Definition');
  await sleep(300);
  const n1 = await notice();
  const hl = await page.evaluate(() => {
    const g = document.getElementById('pou-declaration-editor').closest('.relative.flex-1.min-h-0.flex').querySelectorAll('.st-gutter-row');
    const row = [...g].find((d) => /bg-sky-500\/30/.test(d.className));
    return row ? row.textContent.trim() : null;
  });
  expect(/line 4 of the declaration/.test(n1) && hl === '4', `Go to Definition: "${n1}", line ${hl} highlighted`);
  expect(!(await menuItems()), 'the menu closed');

  // Copy
  // (headless Edge reads the clipboard back empty: the copy itself is checked)
  await page.evaluate(() => { navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
  await rightClickWord('pou-declaration-editor', 'di_InsideFence');
  await clickItem('Copy');
  await sleep(200);
  const clip = await page.evaluate(() => window.__copied ?? '');
  expect(clip === 'di_InsideFence', `Copy Symbol Name: "${clip}"`);
  await page.keyboard.press('Escape');

  // In the body: a variable used there -> its declaration; F12 does the same
  await page.evaluate(() => {
    const ta = document.getElementById('pou-implementation-editor');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  await page.keyboard.type('\nIF di_DoorSense THEN\n\tdoState();\nEND_IF\n');
  await sleep(200);
  await rightClickWord('pou-implementation-editor', 'di_DoorSense');
  items = await menuItems();
  expect(items?.some((t) => /Toggle Block Fold/.test(t)), `body, inside an IF: ${items?.join(' | ')}`);
  await clickItem('Go to Definition');
  await sleep(300);
  expect(/line 4 of the declaration/.test(await notice()), `from the body: "${await notice()}"`);
  // Toggle Block Fold on the IF
  await rightClickWord('pou-implementation-editor', 'doState');
  await clickItem('Toggle Block Fold');
  await sleep(300);
  const foldedView = await page.$eval('#pou-implementation-editor', (e) => e.value);
  expect(!/doState\(\);/.test(foldedView), `the IF around the caret folded (${foldedView.split('\n').length} lines shown)`);
  await page.evaluate(() => [...document.querySelectorAll('#pou-editor button')].find((b) => b.textContent.trim() === 'Unfold All')?.click());
  await sleep(200);
  // Find References fills the find box
  await rightClickWord('pou-implementation-editor', 'di_DoorSense');
  await clickItem('Find References');
  await sleep(300);
  const q = await page.$eval('#pou-editor-find', (e) => e.value);
  const count = await page.$eval('#pou-editor-find-count', (e) => e.textContent).catch(() => '');
  const focusedFind = await page.evaluate(() => document.activeElement?.id);
  expect(q === 'di_DoorSense' && /\/2$/.test(count) && focusedFind === 'pou-editor-find', `Find References: "${q}", ${count} (declaration + body), find box focused`);
  await page.keyboard.press('Escape');
  // F12 on a method name: the Method Editor opens on it
  await page.evaluate(() => {
    const ta = document.getElementById('pou-implementation-editor');
    const at = ta.value.indexOf('doState') + 2;
    ta.focus();
    ta.setSelectionRange(at, at);
  });
  await page.keyboard.press('F12');
  await sleep(700);
  const activeTab = await page.evaluate(() => document.querySelector('#method-declaration-editor') && document.querySelector('#method-declaration-editor').offsetParent !== null);
  const mdecl = await page.$eval('#method-declaration-editor', (e) => e.value).catch(() => '');
  expect(activeTab && /METHOD doState/.test(mdecl), `F12 on doState: the Method Editor shows it (${mdecl.split('\n')[0]})`);
  // Not declared here
  await page.click('#dock-tab-pou');
  await sleep(300);
  await rightClickWord('pou-implementation-editor', 'runMachine');
  await clickItem('Go to Definition');
  await sleep(300);
  expect(/'runMachine' is not declared in SM_TableManager/.test(await notice()), `not in this POU: "${await notice()}"`);
  // Right-click on empty space: no symbol, still a menu (fold / copy items only where they apply)
  await page.screenshot({ path: path.join(h.OUT, 'pou-menu.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${fails} failures`);
  await browser.close().catch(() => {});
  edge.kill();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
