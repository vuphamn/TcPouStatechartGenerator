// Method Editor: right-click > Toggle Block Fold folds the block around the caret (the innermost one), also below
// other folded blocks; Go to Definition reads the word under the caret in the text as shown
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const ID = 'method-implementation-editor';

(async () => {
  const browser = await h.launchBrowser();
  const page = await browser.newPage();
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await page.click('#dock-tab-method');
  await page.waitForSelector(`#${ID}`);
  await h.sleep(800);

  // Right-click with the caret on the nth occurrence of a text (in the text as shown)
  const rightClickAt = async (text, nth = 0) => {
    await page.evaluate((id, text, nth) => {
      const ta = document.getElementById(id);
      let at = -1;
      for (let i = 0; i <= nth; i++) at = ta.value.indexOf(text, at + 1);
      if (at < 0) throw new Error(`"${text}" not in the editor`);
      ta.focus();
      ta.setSelectionRange(at + 2, at + 2);
    }, ID, text, nth);
    // (the caret brought into view scrolls the editor, and a scroll closes the menu: as when the line is on screen)
    // (the editor may still move to the caret's state: right-click again until the menu stays)
    for (let i = 0; i < 3; i++) {
      await h.sleep(700);
      await page.evaluate((id) => document.getElementById(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 })), ID);
      await h.sleep(400);
      if (await page.$('[aria-label="Editor Context Menu"]')) break;
    }
  };
  const clickItem = (label) => page.evaluate((label) => {
    const b = [...document.querySelectorAll('[aria-label="Editor Context Menu"] button')].find((x) => x.textContent.includes(label));
    b?.click();
    return !!b;
  }, label);
  const shown = () => page.$eval(`#${ID}`, (e) => e.value);

  // A line inside a nested IF of a state's branch (well below the method's first block)
  const code = await shown();
  const target = 'cmd_bHome := FALSE;';
  expect(code.includes(target), `the code has "${target}"`);
  const firstLine = code.split('\n').findIndex((l) => /\bIF\b|\bCASE\b/.test(l)) + 1;
  await rightClickAt(target);
  expect(await clickItem('Toggle Block Fold'), 'the menu offers Toggle Block Fold');
  await h.sleep(300);
  let after = await shown();
  const firstStillOpen = after.split('\n')[firstLine - 1] === code.split('\n')[firstLine - 1] && after.includes('CASE');
  expect(!after.includes(target) && after.length < code.length, `the block around the caret folded ("${target}" hidden)`);
  expect(firstStillOpen && (after.match(/\n/g) || []).length > 100, 'the method\'s first block stays open');
  // Below that folded block: another block, found in the code (not the text as shown)
  const other = 'machineState := TABLEMANAGER_IDLE_FEED_OFF;';
  const occurrences = (after.split(other).length - 1);
  await rightClickAt(other, occurrences - 1);
  expect(await clickItem('Toggle Block Fold'), 'Toggle Block Fold below a folded block');
  await h.sleep(300);
  const after2 = await shown();
  expect((after2.split(other).length - 1) === occurrences - 1 && after2.split('\n').length < after.split('\n').length, 'the block around that caret folded (the right one, below the folded block)');
  // Go to Definition on a word below the folds: the word as shown under the caret
  await rightClickAt('smOutfeedStopAxis');
  const head = await page.evaluate(() => document.querySelector('[aria-label="Editor Context Menu"]')?.textContent || '');
  expect(/smOutfeedStopAxis/.test(head), `the menu is about the word under the caret (${head.slice(0, 40).trim()}…)`);
  await page.keyboard.press('Escape');
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
