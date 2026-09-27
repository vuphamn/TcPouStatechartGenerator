// The Choices option: a state's IF / ELSIF / ELSE of transitions drawn as a choice (a diamond, no state); off again: gone
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
  const choices = () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node')].filter((n) => /choice_/.test(n.id)).map((n) => ({ id: n.id, state: n.getAttribute('data-state-id'), diamond: !!n.querySelector('polygon') })));
  expect((await choices()).length === 0, 'off: no choices');
  await p.click('#choice-nodes-checkbox');
  await h.sleep(2500);
  const on = await choices();
  const clamped = on.find((c) => /choice_TABLEMANAGER_CLAMPED_/.test(c.id));
  expect(on.length > 0 && !!clamped && clamped.diamond, `on: ${on.length} choices drawn as diamonds (CLAMPED's: ${clamped?.id.replace(/^.*?(choice_)/, '$1')})`);
  expect(!(await p.evaluate(() => /Mermaid Render Error/.test(document.body.innerText))), 'no render error');
  expect(await p.evaluate(() => localStorage.getItem('kss.choiceNodes')) === 'true', 'kept per viewer');
  await p.click('#choice-nodes-checkbox');
  await h.sleep(2500);
  expect((await choices()).length === 0, 'off again: gone');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
