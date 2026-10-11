const h = require('../lib/harness.cjs');
// What's new: on a first start nothing shown (this build remembered as seen); after an update (an older build seen)
// shown by itself with the features since, by area, with their descriptions; closed: not again; the Help palette's
// What's new any time (the latest features when nothing is new); its way to the release notes and back
const { history } = require('../../scripts/release-plan.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const web = history().web;
  const commits = [...web.unreleased, ...web.releases.flatMap((r) => r.commits)];
  const feats = commits.filter((c) => c.changes.some((x) => x.kind === 'feat'));
  const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const SEEN = 'kss.whatsNew.seen';
  const shown = () => p.$('#whats-new-dialog').then((x) => !!x);

  // 1. A first start: nothing shown, this build seen
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(2500);
  const seen = await p.evaluate((k) => localStorage.getItem(k), SEEN);
  expect(!(await shown()) && seen === commits[0].hash, `a first start: not shown, the newest commit seen (${seen}, ${commits[0].hash})`);

  // 2. After an update: an older build seen, its features since shown by themselves
  const older = feats[Math.min(3, feats.length - 1)];
  const want = commits.slice(0, commits.indexOf(older)).filter((c) => c.changes.some((x) => x.kind === 'feat'));
  await p.evaluate((k, v) => localStorage.setItem(k, v), SEEN, older.hash);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const opened = await h.until(shown, 15000);
  const items = await p.$$eval('.whats-new-item', (l) => l.map((x) => ({ hash: x.getAttribute('data-hash'), title: x.querySelector('.whats-new-title')?.textContent ?? '', body: x.querySelector('.whats-new-body')?.textContent ?? '' })));
  const summary = await p.$eval('#whats-new-summary', (e) => e.textContent).catch(() => '');
  expect(!!opened && items.map((i) => i.hash).sort().join() === want.map((c) => c.hash).sort().join(), `after an update: shown, the ${want.length} features since ${older.hash} (${items.map((i) => i.hash).join(', ')})`);
  expect(new RegExp(`^${want.length} new features? since`).test(summary.trim()), `the summary: ${summary}`);
  const withBody = want.filter((c) => c.body);
  expect(items.filter((i) => i.body).length === withBody.length && withBody.every((c) => items.find((i) => i.hash === c.hash)?.body === c.body), `each with what it does (${withBody.length} described)`);
  const areas = await p.$$eval('.whats-new-area', (l) => l.map((x) => x.getAttribute('data-area')));
  expect(areas.length > 0 && new Set(areas).size === areas.length, `by area: ${areas.join(', ')}`);
  await p.screenshot({ path: h.out('whats-new.png') });

  // 3. Closed: this build seen, not again
  await p.click('#whats-new-close');
  await h.sleep(300);
  expect(!(await shown()) && (await p.evaluate((k) => localStorage.getItem(k), SEEN)) === commits[0].hash, 'closed: the newest commit seen');
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(2500);
  expect(!(await shown()), 'reloaded: not shown again');

  // 4. The Help palette's What's new: nothing new, the latest features
  await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyP'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
  await p.waitForSelector('#command-palette-input, [data-testid="command-palette-input"], #command-palette input', { timeout: 5000 }).catch(() => {});
  await p.keyboard.type("What's new");
  await h.sleep(300);
  await p.keyboard.press('Enter');
  await h.until(shown, 5000);
  const latest = await p.$$eval('.whats-new-item', (l) => l.length);
  const sum2 = await p.$eval('#whats-new-summary', (e) => e.textContent).catch(() => '');
  expect(latest === Math.min(20, feats.length) && /Nothing new since/.test(sum2), `the palette's What's new: the latest ${latest} features (${sum2.trim()})`);

  // 5. To the release notes and back
  await p.click('#whats-new-release-notes');
  const rn = await h.until(() => p.$('#release-notes-dialog'), 4000);
  expect(!!rn && !(await shown()), "All release notes: the release notes, What's new closed");
  await p.click('#release-notes-whats-new');
  expect(!!(await h.until(shown, 4000)) && !(await p.$('#release-notes-dialog')), "the release notes' What's new: back");
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await shown()), 'Esc closes it');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
