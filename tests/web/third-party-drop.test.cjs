// The web edition, a POU dropped on the header without its folder (as Browse does without folder access): another
// company's POU whose states are an enum written inline (Phase : (Waiting, OffEdge, OnBest, OnLesser), CASE in
// TrackSample()): drawn at once with that enum, no "Find .TcDUT…" wait, no "its enum: drop its .TcDUT" message
const h = require('../lib/harness.cjs');
const path = require('path');
const { pou } = require(path.join(h.REPO, 'tests', 'fixtures', 'third-party-inline-enum.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);

  // Dropped on the header: the file only (no folder, no handle)
  await p.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'FB_StepTracker.TcPOU', { type: 'application/xml' }));
    const el = document.getElementById('source-files-header');
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, pou);
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="OnLesser"]', { timeout: 20000 }).catch(() => {});
  await h.sleep(1000);

  const seen = await p.evaluate(() => ({
    states: [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')),
    header: document.body.innerText.match(/Phase \(in FB_StepTracker\)/)?.[0] ?? '',
    findDut: /Find \.TcDUT/.test(document.getElementById('source-files-header')?.innerText ?? ''),
    toast: /drop its \.TcDUT too/.test(document.body.innerText),
  }));
  expect(['Waiting', 'OffEdge', 'OnBest', 'OnLesser'].every((s) => seen.states.includes(s)), `its states drawn at once (${[...new Set(seen.states)].join(', ')})`);
  expect(seen.header === 'Phase (in FB_StepTracker)' && !seen.findDut && !seen.toast, `the inline enum used: no Find .TcDUT, no message asking for one (${JSON.stringify(seen)})`);
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
