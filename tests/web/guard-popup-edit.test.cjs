// A transition's condition edited from its hover popup (the pencil): the condition editor opens on its label; the
// new condition goes into the code where the transition is: doState() for a state's, its method for a sub-machine's
// (the K-Test Station sample: Calibrate()'s CAL_CHECK → CAL_DONE, "rMeasured >= 0.0")
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const CHECK = 'KTESTSTATION_CALIBRATING__Calibrate__CAL_CHECK';
const DONE = 'KTESTSTATION_CALIBRATING__Calibrate__CAL_DONE';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-test-station');
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${DONE}"]`, { timeout: 30000 }).catch(() => {});
  await h.sleep(1500);
  // (into view: Go to State on CAL_CHECK)
  await p.evaluate((id) => document.getElementById(`btn-goto-state-${id}`)?.click(), CHECK);
  await h.sleep(1500);
  const labelAt = (from, to) => p.evaluate((from, to) => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') === from && x.getAttribute('data-to') === to && x.getBoundingClientRect().width > 0);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, from, to);
  const methodCode = async (name) => {
    await p.click('#dock-tab-method');
    await p.waitForSelector('#method-selector-combobox', { timeout: 8000 }).catch(() => {});
    await p.evaluate((name) => {
      const sel = document.getElementById('method-selector-combobox');
      const opt = sel && [...sel.options].find((o) => new RegExp(`^${name}`).test(o.textContent.trim()));
      if (!opt) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, name);
    await h.sleep(800);
    const code = await p.$eval('#method-implementation-editor', (e) => e.value).catch(() => '');
    await p.click('#dock-tab-diagram');
    await h.sleep(500);
    return code;
  };

  const at = await labelAt(CHECK, DONE);
  expect(!!at, 'CAL_CHECK → CAL_DONE\'s label on screen');
  if (at) {
    await p.mouse.move(at.x, at.y, { steps: 3 });
    await p.waitForSelector('#guard-popup-edit-condition', { visible: true, timeout: 8000 }).catch(() => {});
    await h.sleep(300);
    await p.click('#guard-popup-edit-condition').catch(() => {});
    await p.waitForSelector('#text-prompt-input', { timeout: 4000 }).catch(() => {});
  }
  const prompt = await p.evaluate(() => ({ title: document.getElementById('text-prompt-dialog')?.getAttribute('aria-label') ?? '', value: document.getElementById('text-prompt-input')?.value ?? '', inline: document.getElementById('text-prompt-dialog')?.getAttribute('data-inline') === 'true' }));
  expect(/Condition of CAL_CHECK → CAL_DONE/.test(prompt.title) && /rMeasured >= 0\.0/.test(prompt.value) && prompt.inline, `the popup's pencil: the condition editor on its label (${JSON.stringify(prompt)})`);
  if (prompt.value) {
    await p.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.focus(); i.select(); });
    await p.keyboard.type('rMeasured >= 0.5');
    await p.keyboard.press('Enter');
    await h.sleep(1500);
  }
  const code = await methodCode('Calibrate');
  expect(/IF \(?rMeasured >= 0\.5\)? THEN\s*\n\s*eCalState := CAL_DONE;/.test(code) && !/rMeasured >= 0\.0\) THEN\s*\n\s*eCalState := CAL_DONE/.test(code), `changed in Calibrate() (${(code.match(/.*rMeasured >= 0\.\d.*/) ?? [''])[0].trim()})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
