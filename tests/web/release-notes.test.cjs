const h = require('../lib/harness.cjs');
// The edition's version in the status bar (lower right); a click: the release notes, each edition's releases with
// their changes (from the git history at build time), this edition first, a filter
const { history } = require('../../scripts/release-plan.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const want = history();
  const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });

  // The version, lower right
  const v = await p.evaluate(() => {
    const b = document.getElementById('status-version');
    const r = b?.getBoundingClientRect();
    return { text: b?.textContent.trim() ?? '', right: r ? window.innerWidth - r.right : -1, bottom: r ? window.innerHeight - r.bottom : -1 };
  });
  expect(v.text === `Web${want.web.version}` && v.right >= 0 && v.right < 40 && v.bottom >= 0 && v.bottom < 10, `status bar, lower right: "${v.text}" (${Math.round(v.right)} px from the right)`);

  // The release notes: the web edition first, its releases (newest first) with their changes
  await p.click('#status-version');
  await p.waitForSelector('#release-notes-dialog', { timeout: 3000 }).catch(() => {});
  const tabs = await p.$$eval('#release-notes-dialog [id^="release-notes-tab-"]', (b) => b.map((x) => x.id.replace('release-notes-tab-', '')));
  const blocks = await p.$$eval('.release-notes-release', (s) => s.map((x) => x.getAttribute('data-tag')));
  const changes = await p.$$eval('.release-notes-change', (l) => l.length);
  const wantTags = want.web.releases.map((r) => r.tag);
  expect(tabs[0] === 'web' && tabs.length === 3, `tabs: ${tabs.join(', ')}`);
  expect(wantTags.every((t) => blocks.includes(t)) && (want.web.unreleased.length ? blocks[0] === 'unreleased' : true) && changes > 0, `the web edition's releases: ${blocks.join(', ')} (${changes} changes)`);
  await p.screenshot({ path: h.out('release-notes.png') });

  // Another edition; a filter
  await p.click('#release-notes-tab-desktop');
  await p.waitForFunction(() => document.querySelector('#release-notes-tab-desktop')?.className.includes('sky-800'), { timeout: 2000 }).catch(() => {});
  const word = 'PLC';
  await p.type('#release-notes-filter', word);
  await new Promise((r) => setTimeout(r, 200));
  const filtered = await p.$$eval('.release-notes-change', (l) => l.map((x) => x.textContent));
  expect(filtered.length > 0 && filtered.every((t) => t.toLowerCase().includes(word.toLowerCase())), `desktop, filtered "${word}": ${filtered.length} changes, each mentions it`);
  await p.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  expect(!(await p.$('#release-notes-dialog')), 'Esc closes it');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
