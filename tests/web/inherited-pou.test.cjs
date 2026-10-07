// A POU that EXTENDS another without a doState() of its own, opened in a host (the VS Code extension's webview and
// host.cjs, as vscode-extension serves it): its base looked for in the PLC project (findPou: Common/, beside neither
// the POU nor its folder), its enum found beside the base; the chart its states and the transitions of their methods
// (its own override and the base's); the header says what it extends. A transition written in the base: its condition
// not edited here (where it is written said); Go to code opens the base. Save writes the POU's own text only
// (runner-timeout: 300)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createHost, webviewHtml } = require(path.join(h.REPO, 'vscode-extension', 'host.cjs'));
const { root, base, derived, dut } = require(path.join(h.REPO, 'tests', 'fixtures', 'inherited-pou.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const dist = path.join(h.REPO, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('FAIL dist/ is missing: npm run build first');
  process.exit(1);
}
const work = path.join(h.OUT, 'inherited-project');
fs.rmSync(work, { recursive: true, force: true });
for (const d of ['POUs/Machine', 'Common/Base']) fs.mkdirSync(path.join(work, d), { recursive: true });
fs.writeFileSync(path.join(work, 'P.plcproj'), '<Project/>');
const pouPath = path.join(work, 'POUs', 'Machine', 'SM_Derived.TcPOU');
fs.writeFileSync(pouPath, '﻿' + derived);
fs.writeFileSync(path.join(work, 'Common', 'Base', 'SM_Base.TcPOU'), '﻿' + base);
fs.writeFileSync(path.join(work, 'Common', 'SM_Root.TcPOU'), '﻿' + root);
fs.writeFileSync(path.join(work, 'Common', 'Base', 'E_St.TcDUT'), '﻿' + dut);

(async () => {
  const nonce = crypto.randomBytes(12).toString('base64');
  let origin = '';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, origin).pathname);
    if (u === '/webview.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(webviewHtml(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), { base: `${origin}/app/`, cspSource: origin, nonce }));
    }
    const f = path.join(dist, u.replace(/^\/app\//, ''));
    if (!u.startsWith('/app/') || !f.startsWith(dist) || !fs.existsSync(f)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  try {
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const opened = [];
    const post = (m) => p.evaluate((m) => window.postMessage(m, '*'), m).catch(() => {});
    const host = createHost({ pouPath, post, ui: { version: 'test', pick: async () => null, reveal: () => {}, open: (f) => opened.push(f) } });
    await p.exposeFunction('__toHost', (m) => host.handle(m));
    await p.evaluateOnNewDocument(() => {
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__toHost(m), getState: () => null, setState: () => {} });
    });
    await p.goto(`${origin}/webview.html`, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="ST_RUN"]', { timeout: 60000 }).catch(() => {});
    await h.sleep(1500);

    // The chart: the base's states, its methods' transitions (the override's and the base's)
    const chart = await p.evaluate(() => ({
      states: [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id^="ST_"]')].map((n) => n.getAttribute('data-state-id')),
      edges: [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].map((x) => `${x.getAttribute('data-from')}->${x.getAttribute('data-to')}`),
      chip: document.getElementById('pou-inherited-chip')?.textContent?.trim() ?? '',
      enumName: document.body.innerText.match(/E_St\.TcDUT/)?.[0] ?? '',
    }));
    expect(['ST_ENABLING', 'ST_IDLE', 'ST_RUN', 'ST_ERROR'].every((s) => chart.states.includes(s)), `the base's states drawn (${chart.states.join(', ')})`);
    expect(['ST_IDLE->ST_ERROR', 'ST_IDLE->ST_RUN', 'ST_RUN->ST_IDLE', 'ST_ENABLING->ST_IDLE'].every((k) => chart.edges.includes(k)), `the methods' transitions drawn (${chart.edges.join(', ')})`);
    expect(chart.chip === 'extends SM_Base', `the header: what it extends (${chart.chip})`);
    expect(chart.enumName === 'E_St.TcDUT', 'its enum: found beside the base');

    // A transition written in the base: its condition not edited here
    const label = await p.evaluate(() => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') === 'ST_ENABLING' && x.getAttribute('data-to') === 'ST_IDLE' && x.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    let toast = '';
    if (label) {
      await p.mouse.move(label.x, label.y, { steps: 3 });
      await p.waitForSelector('#guard-popup-edit-condition', { visible: true, timeout: 8000 }).catch(() => {});
      await h.sleep(300);
      await p.click('#guard-popup-edit-condition').catch(() => {});
      for (let t = 0; t < 4000 && !/written in/.test(toast); t += 200) {
        await h.sleep(200);
        toast = await p.evaluate(() => document.body.innerText.match(/ST_ENABLING → ST_IDLE is written in [^\n]*/)?.[0] ?? '');
      }
    }
    expect(/written in stEnabling\(\) of SM_Base/.test(toast), `editing its condition: refused, where it is said (${toast})`);
    expect(!(await p.$('#text-prompt-input')), 'no condition editor opened');

    // Go to code on it: the base opened (VS Code: its .TcPOU)
    await p.keyboard.press('Escape');
    if (label) {
      await p.mouse.click(label.x, label.y, { button: 'right' });
      await p.waitForSelector('[id$="goto-code-btn"]', { timeout: 4000 }).catch(() => {});
      const id = await p.evaluate(() => [...document.querySelectorAll('[id$="goto-code-btn"]')].find((b) => b.getBoundingClientRect().width > 0)?.id ?? '');
      if (id) await p.click(`#${id}`).catch(() => {});
    }
    for (let t = 0; t < 4000 && !opened.length; t += 200) await h.sleep(200);
    expect(opened.some((f) => /SM_Base\.TcPOU$/.test(f)), `Go to code: the base opened (${opened.map((f) => path.basename(f)).join(', ')})`);

    // Save: the POU's own text only (the merged methods never in it)
    expect(fs.readFileSync(pouPath, 'utf8') === '﻿' + derived, 'the file: untouched');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
