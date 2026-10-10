// Another company's POU opened in a host (the VS Code extension's webview and host.cjs): its state machine in
// Execute() (CASE State OF, State an enum), its enum in another folder of the PLC project (DUTs\, not beside the POU):
// looked for by the state variable's type (findEnumType) and used; the chart its states and the transitions written
// through helper methods given the next state as an argument; the Method Editor opens Execute() for the state method
// (runner-timeout: 240)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createHost, webviewHtml } = require(path.join(h.REPO, 'vscode-extension', 'host.cjs'));
const { pou, dut } = require(path.join(h.REPO, 'tests', 'fixtures', 'third-party-pou.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const dist = path.join(h.REPO, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('FAIL dist/ is missing: npm run build first');
  process.exit(1);
}
const work = path.join(h.OUT, 'third-party-project');
fs.rmSync(work, { recursive: true, force: true });
for (const d of ['POUs', 'DUTs']) fs.mkdirSync(path.join(work, d), { recursive: true });
fs.writeFileSync(path.join(work, 'Robot.plcproj'), '<Project/>');
const pouPath = path.join(work, 'POUs', 'FB_ScanSequencer.TcPOU');
fs.writeFileSync(pouPath, '﻿' + pou);
fs.writeFileSync(path.join(work, 'DUTs', 'E_ScanState.TcDUT'), '﻿' + dut);

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
    const asked = [];
    const post = (m) => p.evaluate((m) => window.postMessage(m, '*'), m).catch(() => {});
    const host = createHost({ pouPath, post, ui: { version: 'test', pick: async () => null, reveal: () => {}, open: () => {} } });
    await p.exposeFunction('__toHost', (m) => {
      asked.push(m.type);
      return host.handle(m);
    });
    await p.evaluateOnNewDocument(() => {
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__toHost(m), getState: () => null, setState: () => {} });
    });
    await p.goto(`${origin}/webview.html`, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="ProcessFastScan"]', { timeout: 60000 }).catch(() => {});
    await h.sleep(1500);

    // The enum: not beside the POU, looked for by State's type and used
    const header = await p.evaluate(() => document.body.innerText.match(/E_ScanState\.TcDUT/)?.[0] ?? '');
    expect(asked.includes('findEnumType') && header === 'E_ScanState.TcDUT', `its enum found in DUTs\\ by State's type (asked: ${asked.includes('findEnumType')}, header: ${header || 'none'})`);

    // The chart: its states, the transitions through the helpers (MoveAndAdvance, AdvanceWhenDone)
    const chart = await p.evaluate(() => ({
      states: [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')),
      edges: [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].map((x) => `${x.getAttribute('data-from')}->${x.getAttribute('data-to')}`),
      paths: [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].map((x) => `${x.getAttribute('data-source-id')}->${x.getAttribute('data-target-id')}`),
    }));
    const all = new Set([...chart.edges, ...chart.paths]);
    expect(['InitializeScan', 'MoveToStart', 'ResetData', 'FastScan', 'ProcessFastScan', 'ComputeResult'].every((s) => chart.states.includes(s)), `its states drawn (${[...new Set(chart.states)].join(', ')})`);
    expect(['MoveToStart->ResetData', 'FastScan->ProcessFastScan', 'ComputeResult->InitializeScan'].every((k) => all.has(k)), `the transitions, through the helpers too (${[...all].join(', ')})`);

    // The Method Editor: Execute() for the state method
    await p.click('#dock-tab-method').catch(() => {});
    await p.waitForSelector('#method-implementation-editor', { timeout: 10000 }).catch(() => {});
    await h.sleep(600);
    const me = await p.evaluate(() => ({
      code: document.getElementById('method-implementation-editor')?.value ?? '',
      listed: document.body.innerText.includes('Execute()'),
      doState: /\bdoState\(\)/.test(document.querySelector('#method-selector, select')?.textContent ?? ''),
    }));
    expect(/CASE State OF/.test(me.code) && me.listed && !me.doState, `the Method Editor: Execute() shown, no doState() made up (${me.code.split('\n').find((l) => /CASE/.test(l))?.trim()})`);
    // The caret in a state's CASE branch of Execute() (its label qualified): its Identified States card flashed, Follow
    // offered, the state selected on the canvas (as for doState())
    // (Identified States: the left panel, closed in this layout: opened)
    if (!(await p.$('[id^="state-list-item-"]'))) {
      await p.click('#toggle-sidebar-btn').catch(() => {});
      await h.sleep(600);
    }
    await p.evaluate(() => {
      const ta = document.getElementById('method-implementation-editor');
      const lines = ta.value.split('\n');
      const i = lines.findIndex((l) => /^\s*E_ScanState\.FastScan\s*:/.test(l)) + 1;
      const pos = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + 2;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
    await h.sleep(800);
    const card = await p.evaluate(() => document.querySelector('[data-code-focus="true"]')?.id?.replace('state-list-item-', '') ?? null);
    const follow = !!(await p.$('#method-follow-checkbox'));
    await p.click('#dock-tab-diagram').catch(() => {});
    await h.sleep(600);
    const selected = await p.evaluate(() => document.querySelector('#mermaid-canvas-area g.node.diagram-selected-node')?.getAttribute('data-state-id') ?? null);
    expect(card === 'FastScan' && follow && selected === 'FastScan', `the caret in Execute()'s FastScan branch: its card (${card}), Follow (${follow}), the canvas (${selected})`);
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
