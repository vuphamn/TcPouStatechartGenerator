// Bookmarks of another company's POU (its state machine in Execute(), CASE State OF, labels qualified:
// E_ScanState.FastScan:): a state bookmarked in Identified States is marked in the Method Editor at its CASE label in
// Execute() and in the Enum Editor at its member, and taken off there when the bookmark is removed (the web edition,
// the POU and its enum dropped together). A state the CASE has no label for (Idle, a default state): said so when
// bookmarked, marked at its member in the Enum Editor. Another window of the app sees the bookmarks change.
const h = require('../lib/harness.cjs');
const path = require('path');
const { pou, dut: fixtureDut } = require(path.join(h.REPO, 'tests', 'fixtures', 'third-party-pou.cjs'));
// (with a member Execute()'s CASE has no label for, as FB_RobotCellController's E_RestackState.Idle)
const dut = fixtureDut.replace(/ComputeResult(\r?\n)/, 'ComputeResult,$1\tIdle$1');
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
  await p.evaluate((pouText, dutText) => {
    const dt = new DataTransfer();
    dt.items.add(new File([pouText], 'FB_ScanSequencer.TcPOU', { type: 'application/xml' }));
    dt.items.add(new File([dutText], 'E_ScanState.TcDUT', { type: 'application/xml' }));
    const el = document.getElementById('source-files-header');
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, pou, dut);
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="FastScan"]', { timeout: 20000 }).catch(() => {});
  await h.sleep(1000);
  if (!(await p.$('[id^="state-list-item-"]'))) {
    await p.click('#toggle-sidebar-btn').catch(() => {});
    await h.sleep(600);
  }

  // The line marked in an editor: the gutter's bookmarks, and the text of the lines they are on
  const marked = (editorId) =>
    p.evaluate((editorId) => {
      const ta = document.getElementById(editorId);
      const lines = (ta?.value ?? '').split('\n');
      const root = ta?.closest('[class]')?.parentElement?.parentElement ?? document;
      return [...root.querySelectorAll('.st-bookmark[data-bookmark-line]')].map((e) => (lines[Number(e.getAttribute('data-bookmark-line')) - 1] ?? '').trim());
    }, editorId);
  const showMethod = async () => {
    await p.click('#dock-tab-method').catch(() => {});
    await p.waitForSelector('#method-implementation-editor', { timeout: 10000 }).catch(() => {});
    await h.sleep(600);
  };
  const showEnum = async () => {
    await p.click('#dock-tab-enum').catch(() => {});
    await p.waitForSelector('#st-dut-editor', { timeout: 10000 }).catch(() => {});
    await h.sleep(600);
  };

  // Bookmarked in Identified States
  await p.click('#state-add-bookmark-FastScan').catch(() => {});
  await h.sleep(500);
  const card = !!(await p.$('#state-bookmark-FastScan'));
  await showMethod();
  const inMethod = await marked('method-implementation-editor');
  await showEnum();
  const inEnum = await marked('st-dut-editor');
  expect(card && inMethod.some((l) => /^E_ScanState\.FastScan\s*:/.test(l)) && inEnum.some((l) => /^FastScan\b/.test(l)), `bookmarked in Identified States: marked at Execute()'s CASE label and the enum's member (method: ${JSON.stringify(inMethod)}; enum: ${JSON.stringify(inEnum)})`);

  // Removed there: gone in both editors
  await p.click('#state-bookmark-FastScan').catch(() => {});
  await h.sleep(500);
  await showMethod();
  const offMethod = await marked('method-implementation-editor');
  await showEnum();
  const offEnum = await marked('st-dut-editor');
  expect(!(await p.$('#state-bookmark-FastScan')) && !offMethod.some((l) => /FastScan\s*:/.test(l)) && !offEnum.some((l) => /^FastScan\b/.test(l)), `removed: no longer marked (method: ${JSON.stringify(offMethod)}; enum: ${JSON.stringify(offEnum)})`);
  // A state without a CASE label: said so, marked at its member in the Enum Editor only
  await p.click('#state-add-bookmark-Idle').catch(() => {});
  await h.sleep(500);
  const said = await p.evaluate(() => (document.body.innerText.match(/Bookmarked Idle: Execute\(\) has no CASE label for it[^\n]*/) ?? [''])[0]);
  await showEnum();
  const idleEnum = await marked('st-dut-editor');
  await showMethod();
  const idleMethod = await marked('method-implementation-editor');
  expect(!!(await p.$('#state-bookmark-Idle')) && /Enum Editor at its member/.test(said) && idleEnum.some((l) => /^Idle\b/.test(l)) && idleMethod.length === 0, `no CASE label: said so, marked at the enum's member (said: ${JSON.stringify(said)}; enum: ${JSON.stringify(idleEnum)}; method: ${JSON.stringify(idleMethod)})`);

  // Another window of the app (the same browser): sees a bookmark set and removed here
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(h.APP_URL, { waitUntil: 'load' });
  await p2.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  await p2.evaluate((pouText, dutText) => {
    const dt = new DataTransfer();
    dt.items.add(new File([pouText], 'FB_ScanSequencer.TcPOU', { type: 'application/xml' }));
    dt.items.add(new File([dutText], 'E_ScanState.TcDUT', { type: 'application/xml' }));
    const el = document.getElementById('source-files-header');
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, pou, dut);
  await p2.waitForSelector('#mermaid-canvas-area g.node[data-state-id="FastScan"]', { timeout: 20000 }).catch(() => {});
  await h.sleep(1000);
  if (!(await p2.$('[id^="state-list-item-"]'))) {
    await p2.click('#toggle-sidebar-btn').catch(() => {});
    await h.sleep(600);
  }
  const seenIdle = !!(await p2.$('#state-bookmark-Idle'));
  await p.bringToFront();
  await p.click('#state-add-bookmark-ResetData').catch(() => {});
  await h.sleep(800);
  const seenSet = !!(await p2.$('#state-bookmark-ResetData'));
  await p.click('#state-bookmark-ResetData').catch(() => {});
  await h.sleep(800);
  const seenRemoved = !(await p2.$('#state-bookmark-ResetData'));
  expect(seenIdle && seenSet && seenRemoved, `another window: sees the bookmarks (Idle at load ${seenIdle}, ResetData set ${seenSet}, removed ${seenRemoved})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
