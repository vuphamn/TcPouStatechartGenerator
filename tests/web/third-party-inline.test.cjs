// Another company's POU that EXTENDS a base of its own, its states an enum written inline in its declaration (Phase :
// (Waiting, OffEdge, OnBest, OnLesser)), its CASE in TrackSample(), opened in a host (the VS Code extension's webview and
// host.cjs): no .TcDUT, the inline enum used (the header names it; the Enum Editor shows it read only, to edit in the
// POU's declaration), the chart its states and transitions; no base looked for (its own state method)
// (runner-timeout: 240)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createHost, webviewHtml } = require(path.join(h.REPO, 'vscode-extension', 'host.cjs'));
const { pou } = require(path.join(h.REPO, 'tests', 'fixtures', 'third-party-inline-enum.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const dist = path.join(h.REPO, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('FAIL dist/ is missing: npm run build first');
  process.exit(1);
}
const work = path.join(h.OUT, 'third-party-inline-project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'POUs'), { recursive: true });
fs.writeFileSync(path.join(work, 'Robot.plcproj'), '<Project/>');
const pouPath = path.join(work, 'POUs', 'FB_StepTracker.TcPOU');
fs.writeFileSync(pouPath, '﻿' + pou);

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
    await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="OnLesser"]', { timeout: 60000 }).catch(() => {});
    await h.sleep(1500);

    // No .TcDUT: the inline enum used, named in the header; no base looked for, no enum file looked for
    const header = await p.evaluate(() => document.body.innerText.match(/Phase \(in FB_StepTracker\)/)?.[0] ?? '');
    expect(header === 'Phase (in FB_StepTracker)' && !asked.includes('findPou') && !asked.includes('findEnumType'), `the inline enum used (${header || 'none'}; asked: ${[...new Set(asked)].join(', ')})`);

    // The chart: its states and the CASE's transitions
    const chart = await p.evaluate(() => ({
      states: [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')),
      paths: [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].map((x) => `${x.getAttribute('data-source-id')}->${x.getAttribute('data-target-id')}`),
      edges: [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].map((x) => `${x.getAttribute('data-from')}->${x.getAttribute('data-to')}`),
    }));
    const all = new Set([...chart.paths, ...chart.edges]);
    expect(['Waiting', 'OffEdge', 'OnBest', 'OnLesser'].every((s) => chart.states.includes(s)), `its states drawn (${[...new Set(chart.states)].join(', ')})`);
    expect(['OffEdge->OnBest', 'OffEdge->OnLesser', 'OnBest->OffEdge', 'OnLesser->OffEdge'].every((k) => all.has(k)), `its transitions (${[...all].join(', ')})`);
    // (set outside the CASE, in Reset() and Seed(): from "any state", labeled with the method)
    const labels = await p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].map((x) => x.textContent.trim()));
    expect(chart.states.includes('AnyState') && ['AnyState->Waiting', 'AnyState->OnBest'].every((k) => all.has(k)) && labels.some((l) => l.includes('[Reset()]')) && labels.some((l) => l.includes('[Seed()]')), `Reset() and Seed(): from any state (labels: ${labels.join(' | ')}; states: ${[...new Set(chart.states)].join(', ')}; edges: ${[...all].join(', ')})`);

    // The Enum Editor: the inline enum, read only (edited in the POU's declaration)
    await p.click('#dock-tab-enum').catch(() => {});
    await p.waitForSelector('#st-dut-editor', { timeout: 10000 }).catch(() => {});
    await h.sleep(500);
    const en = await p.evaluate(() => ({ note: document.getElementById('enum-readonly-note')?.textContent ?? '', text: document.getElementById('st-dut-editor')?.value ?? '' }));
    expect(/declared inline in the POU/.test(en.note) && /Waiting,\s*OffEdge,\s*OnBest,\s*OnLesser/.test(en.text), `the Enum Editor: the inline enum, read only (${en.note.slice(0, 90)})`);
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
