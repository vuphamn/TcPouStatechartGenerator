const h = require('../lib/harness.cjs');
// Enum Editor: no false warning for leading-comma enums; "Jump to Line" scrolls to the line and highlights it
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
  // The Door Dasher sample: an enum written with leading commas
  await page.select('#sample-selector', 'door-dasher-237');
  await page.waitForFunction(() => document.querySelector('#mermaid-canvas-area g.node[data-state-id^="DOOR_DASHER"]'), { timeout: 30000 });
  await sleep(600);
  await page.click('#dock-tab-enum');
  await sleep(800);
  const banner = () => page.evaluate(() => [...document.querySelectorAll('span')].find((s) => s.textContent === 'TwinCAT DUT Syntax:')?.parentElement?.parentElement?.innerText.replace(/\s+/g, ' '));
  const jumpOption = await page.evaluate(() => [...document.querySelectorAll('select[aria-label="Jump to enum member"] option')][0]?.textContent);
  expect(!(await banner()), 'no syntax warning for the leading-comma enum');
  expect(/\(47\)/.test(jumpOption || ''), `every member is found: "${jumpOption}"`);

  const setText = (editorId, fn) => page.evaluate((editorId, src) => {
    const ta = document.getElementById(editorId)?.querySelector('textarea') || document.querySelector(`#${editorId} textarea`) || document.querySelector(`textarea#${editorId}`);
    const t = ta || [...document.querySelectorAll('textarea')].find((x) => x.getBoundingClientRect().width > 0);
    const f = new Function('v', `return (${src})(v)`);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, f(t.value));
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.scrollTop = 0;
    t.dispatchEvent(new Event('scroll'));
  }, editorId, fn.toString());
  const highlight = () => page.evaluate(() => {
    const t = [...document.querySelectorAll('textarea')].find((x) => x.getBoundingClientRect().width > 0);
    let root = t.parentElement;
    while (root && !root.querySelector('div.st-gutter-row')) root = root.parentElement;
    const hl = root ? [...root.querySelectorAll('div.st-gutter-row')].find((d) => /bg-sky-500\/30/.test(d.className)) : null;
    const box = t.getBoundingClientRect();
    const r = hl?.getBoundingClientRect();
    const lines = t.value.split('\n');
    return { line: hl ? parseInt(hl.innerText.replace(/\D+/g, ''), 10) : null, bad: lines.findIndex((l) => l.includes('!!bad')) + 1, inView: !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1, scrollTop: Math.round(t.scrollTop) };
  });

  // Structured Text: a bad line near the end of the list
  await setText('st-dut-editor', (v) => v.replace(/(\r?\n)(\s*\)\s*[A-Z]*\s*;?\s*\r?\nEND_TYPE)/, '$1    !!bad line$1$2'));
  await sleep(500);
  const b1 = await banner();
  console.log('   banner:', b1);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Jump to Line/.test(b.textContent.trim()))?.click());
  await sleep(900);
  let hl = await highlight();
  console.log('   ', JSON.stringify(hl));
  expect(/!!bad/.test(b1 || '') && hl.line === hl.bad && hl.inView && hl.scrollTop > 0, `ST: line ${hl.bad} scrolled into view and highlighted`);
  await page.screenshot({ path: path.join(h.OUT, 'enum-jumpline.png'), clip: { x: 400, y: 60, width: 1000, height: 700 } });
  await sleep(3200);
  hl = await highlight();
  expect(hl.line === null, 'the highlight clears after 3 s');

  // XML view: the same, the line is the file's
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /TcDUT XML/.test(b.textContent))?.click());
  await sleep(600);
  await setText('raw-tcdut-xml-editor', (v) => v.replace(/(\r?\n)(\s*\)\s*[A-Z]*\s*;?\s*\r?\nEND_TYPE)/, '$1    !!bad line$1$2'));
  await sleep(500);
  const b2 = await banner();
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Jump to Line/.test(b.textContent.trim()))?.click());
  await sleep(900);
  hl = await highlight();
  console.log('   ', JSON.stringify(hl), '| banner:', b2);
  expect(/!!bad/.test(b2 || '') && (b2 || '').includes(`Jump to Line ${hl.bad}`) && hl.line === hl.bad && hl.inView, `XML: file line ${hl.bad} highlighted and in view`);

  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
