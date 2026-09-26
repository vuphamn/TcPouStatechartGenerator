const h = require('../lib/harness.cjs');
// Diagram features in the web app: Paths, rename, add state, add transition (connect mode), Changes (as loaded)
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
  const ready = (id = 'TABLEMANAGER_HOMMING') => page.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`, { timeout: 30000 });
  await ready();
  await sleep(800);
  const nodePoint = (id) => page.evaluate((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    n.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(8, r.height / 3) };
  }, id);
  const rightClickNode = async (id) => {
    const p = await nodePoint(id);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await sleep(500);
  };
  const menuClick = async (itemId) => {
    const ok = await page.evaluate((id) => { const b = document.getElementById(id); if (b) b.click(); return !!b; }, itemId);
    await sleep(600);
    return ok;
  };
  const dialog = async (value) => {
    await page.waitForSelector('#text-prompt-input', { timeout: 5000 });
    await page.evaluate((v) => {
      const el = document.getElementById('text-prompt-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await sleep(200);
    const err = await page.$eval('#text-prompt-error', (e) => e.textContent).catch(() => null);
    if (!err) await page.click('#text-prompt-submit');
    await sleep(1500);
    return err;
  };

  // --- Paths
  await rightClickNode('TABLEMANAGER_HOMMING_READY_TO_START');
  expect(await menuClick('context-menu-paths-from-btn'), 'context menu: Paths from here');
  await rightClickNode('TABLEMANAGER_CLAMPED');
  await menuClick('context-menu-paths-to-btn');
  const summary = await page.$eval('#paths-summary', (e) => e.textContent).catch(() => '');
  const items = await page.$$eval('.paths-item', (e) => e.length);
  const hl = await page.evaluate(() => ({ dim: document.querySelector('#mermaid-canvas-area svg')?.classList.contains('diagram-path-active'), nodes: document.querySelectorAll('g.node.path-node').length, edges: document.querySelectorAll('path.path-edge').length }));
  expect(/paths?/.test(summary) && items > 0 && hl.dim && hl.nodes >= 4 && hl.edges >= 3, `paths: "${summary.trim()}", ${items} listed, highlight ${JSON.stringify(hl)}`);
  await page.click('.paths-item[data-path-index="0"]');
  await sleep(500);
  const one = await page.evaluate(() => document.querySelectorAll('g.node.path-node').length);
  expect(one === 4, `one path shown alone (${one} states)`);
  await page.screenshot({ path: path.join(h.OUT, 'feat-paths.png') });
  await page.click('#paths-clear-btn');
  await sleep(400);

  // --- Rename (with a custom style that must follow)
  await rightClickNode('TABLEMANAGER_HALT_FEED');
  await menuClick('context-menu-rename-state-btn');
  const dup = await dialog('TABLEMANAGER_IDLE_FEED_OFF');
  expect(/already/.test(dup || ''), `rename to an existing name refused: "${dup}"`);
  await dialog('TABLEMANAGER_HALT_FEEDING');
  await ready('TABLEMANAGER_HALT_FEEDING');
  expect(!(await page.$('g.node[data-state-id="TABLEMANAGER_HALT_FEED"]')), 'renamed in the diagram');
  const status = await page.$eval('#status-message', (e) => e.textContent);
  expect(/Renamed TABLEMANAGER_HALT_FEED to TABLEMANAGER_HALT_FEEDING/.test(status), `status: "${status}"`);

  // --- Add state (canvas context menu)
  const empty = await page.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area svg:not([id*="snap-grid"])');
    const r = svg.getBoundingClientRect();
    for (let fy = 0.05; fy < 0.95; fy += 0.05) for (let fx = 0.05; fx < 0.95; fx += 0.05) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el && svg.contains(el) && [[0,0],[12,0],[-12,0],[0,12],[0,-12]].every(([dx, dy]) => { const e = document.elementFromPoint(x + dx, y + dy); return e && svg.contains(e) && !e.closest('g.node, g.edgeLabel, g.edgePaths, g.cluster, path, line, polyline, text, foreignObject'); }) && x > 0 && y > 0 && x < innerWidth && y < innerHeight) return { x, y };
    }
    return { x: r.x + 5, y: r.y + 5 };
  });
  await page.mouse.click(empty.x, empty.y, { button: 'right' });
  await sleep(500);
  expect(await menuClick('context-menu-add-state-btn'), 'canvas context menu: Add state');
  await dialog('TABLEMANAGER_NEW_STEP');
  await ready('TABLEMANAGER_NEW_STEP');
  expect(true, 'new state in the diagram');

  // --- Add transition: connect mode, click the target, condition
  await rightClickNode('TABLEMANAGER_CLAMPED');
  await menuClick('context-menu-add-transition-btn');
  expect(!!(await page.$('#connect-mode-hint')), 'connect mode on');
  const t = await nodePoint('TABLEMANAGER_NEW_STEP');
  const inView = await page.evaluate((t) => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return t.x > r.x && t.x < r.right && t.y > r.y && t.y < r.bottom; }, t);
  console.log('     target in view:', inView, JSON.stringify(t));
  await page.mouse.move(t.x - 40, t.y - 40);
  if (inView) {
    await page.mouse.move(t.x, t.y);
    await page.mouse.click(t.x, t.y);
  } else {
    await page.evaluate((t) => {
      const n = document.querySelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_NEW_STEP"] rect, #mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_NEW_STEP"]');
      for (const type of ['mousedown', 'mouseup', 'click']) n.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: t.x, clientY: t.y, button: 0 }));
    }, t);
  }
  await sleep(500);
  await dialog('bGoToNewStep');
  const edgeThere = await page.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].some((l) => l.getAttribute('data-from') === 'TABLEMANAGER_CLAMPED' && l.getAttribute('data-to') === 'TABLEMANAGER_NEW_STEP' && /bGoToNewStep/.test(l.textContent)));
  expect(edgeThere, 'the new transition is in the diagram with its guard');

  // --- Changes (compared with the version as loaded)
  await page.click('#dock-tab-changes');
  await sleep(1500);
  const changes = await page.$eval('#changes-panel', (e) => e.innerText);
  expect(/TABLEMANAGER_NEW_STEP/.test(changes) && /TABLEMANAGER_HALT_FEEDING/.test(changes) && /TABLEMANAGER_HALT_FEED\b/.test(changes), 'Changes lists the added / renamed states');
  const diffMarks = await page.evaluate(() => ({ added: document.querySelectorAll('g.node.diff-added').length, edges: document.querySelectorAll('path.diff-added').length }));
  expect(diffMarks.added >= 2 && diffMarks.edges >= 1, `diagram marks the changes ${JSON.stringify(diffMarks)}`);
  const sb = await page.$eval('#status-changes', (e) => e.textContent).catch(() => null);
  expect(/change/.test(sb || ''), `status bar: "${sb}"`);
  expect(await page.$eval('#changes-base-git', (e) => e.disabled), 'git compare is disabled in the web edition');
  await page.screenshot({ path: path.join(h.OUT, 'feat-changes.png') });
  console.log('page errors:', errors);
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
