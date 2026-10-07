// The VS Code extension's webview, without VS Code: the app's build (dist/) served as the webview serves it (the page
// vscode-extension/host.cjs makes: its base, its content policy, the chrome.webview shim over a stand-in for
// acquireVsCodeApi), its host (host.cjs itself) answering it, on a copy of the K-Test Station's files. Opened: the chart,
// its enum found beside it; no content policy violation. Show in TwinCAT editor on a Calibrate() state: the host
// reveals that line of the .TcPOU. A condition changed and saved: written to the file. Changed on disk: the app has it
// (runner-timeout: 300)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { createHost, webviewHtml } = require(path.join(h.REPO, 'vscode-extension', 'host.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const dist = path.join(h.REPO, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.log('FAIL dist/ is missing: npm run build first');
  process.exit(1);
}
// (the sample's files, from the app's own code)
const entry = path.join(h.OUT, 'vscode-entry.ts');
const bundle = path.join(h.OUT, 'vscode-entry.cjs');
fs.writeFileSync(entry, `export { SAMPLES } from ${JSON.stringify(path.join(h.REPO, 'src', 'samples', 'samplesData.ts').replace(/\\/g, '/'))};\n`);
require('esbuild').buildSync({ entryPoints: [entry], bundle: true, platform: 'node', outfile: bundle, logLevel: 'silent' });
const sample = require(bundle).SAMPLES.find((s) => s.id === 'k-test-station');
const work = path.join(h.OUT, 'vscode-project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'POUs', 'DUTs'), { recursive: true });
const pouPath = path.join(work, 'POUs', sample.pouName);
fs.writeFileSync(pouPath, sample.pouContent);
fs.writeFileSync(path.join(work, 'POUs', 'DUTs', sample.dutName), sample.dutContent);

(async () => {
  // The webview: the app's files, the page the extension makes
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
    const csp = [];
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 200)); });
    // (the host: host.cjs, its user interface a stand-in)
    const revealed = [];
    const post = (m) => p.evaluate((m) => window.postMessage(m, '*'), m).catch(() => {});
    const host = createHost({ pouPath, post, ui: { version: 'test', pick: async () => null, reveal: (file, line, column) => revealed.push({ file, line, column }), open: () => {} } });
    await p.exposeFunction('__toHost', (m) => host.handle(m));
    await p.evaluateOnNewDocument(() => {
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__toHost(m), getState: () => null, setState: () => {} });
    });
    await p.goto(`${origin}/webview.html`, { waitUntil: 'load' });
    const CHECK = 'KTESTSTATION_CALIBRATING__Calibrate__CAL_CHECK';
    await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${CHECK}"]`, { timeout: 60000 }).catch(() => {});
    await h.sleep(1500);
    const opened = await p.evaluate(() => ({
      name: document.getElementById('tcpou-file-name')?.textContent ?? document.body.innerText.match(/SM_KTestStation\.TcPOU/)?.[0] ?? '',
      states: document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id^="KTESTSTATION_"]').length,
      findDut: !!document.getElementById('tcdut-find-btn'),
    }));
    expect(/SM_KTestStation/.test(opened.name) && opened.states > 5 && !opened.findDut, `opened: its chart, its enum found beside it (${JSON.stringify(opened)})`);
    expect(csp.length === 0, `no content policy violation (${csp.slice(0, 2).join(' | ')})`);

    // Show in TwinCAT editor on CAL_CHECK: that line of the .TcPOU revealed
    const at = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, CHECK);
    if (at) {
      await p.mouse.click(at.x, at.y, { button: 'right' });
      await p.waitForSelector('#context-menu-show-in-xae-btn', { timeout: 4000 }).catch(() => {});
      const itemText = await p.$eval('#context-menu-show-in-xae-btn', (b) => b.textContent.trim()).catch(() => '');
      expect(itemText === 'Show in the .TcPOU (VS Code)', `its menu: ${itemText}`);
      await p.click('#context-menu-show-in-xae-btn').catch(() => {});
    }
    for (let t = 0; t < 5000 && !revealed.length; t += 200) await h.sleep(200);
    const lineText = revealed[0] ? fs.readFileSync(revealed[0].file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)[revealed[0].line]?.trim() : '';
    expect(revealed.length === 1 && revealed[0].file === pouPath && /^CAL_CHECK:/.test(lineText), `Show in TwinCAT editor: the .TcPOU at CAL_CHECK's label (${JSON.stringify(revealed[0])}: "${lineText}")`);

    // A condition changed (its popup's pencil) and saved: in the file
    await p.keyboard.press('Escape');
    const label = await p.evaluate(() => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') === 'KTESTSTATION_CALIBRATING__Calibrate__CAL_CHECK' && x.getAttribute('data-to') === 'KTESTSTATION_CALIBRATING__Calibrate__CAL_DONE' && x.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (label) {
      await p.mouse.move(label.x, label.y, { steps: 3 });
      await p.waitForSelector('#guard-popup-edit-condition', { visible: true, timeout: 8000 }).catch(() => {});
      await h.sleep(300);
      await p.click('#guard-popup-edit-condition').catch(() => {});
      await p.waitForSelector('#text-prompt-input', { timeout: 4000 }).catch(() => {});
      await p.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.focus(); i.select(); });
      await p.keyboard.type('rMeasured >= 0.25');
      await p.keyboard.press('Enter');
      await h.sleep(1200);
      await p.click('#header-save-btn').catch(() => {});
    }
    let disk = '';
    for (let t = 0; t < 8000 && !/rMeasured >= 0\.25/.test(disk); t += 250) {
      await h.sleep(250);
      disk = fs.readFileSync(pouPath, 'utf8');
    }
    expect(/IF rMeasured >= 0\.25 THEN/.test(disk) && disk.charCodeAt(0) === 0xfeff, `saved: the condition in the .TcPOU, its BOM kept (${(disk.match(/.*rMeasured >= 0\.\d+.*/) ?? [''])[0].trim()})`);

    // Changed on disk (TwinCAT, git): the app has it
    fs.writeFileSync(pouPath, disk.replace('rMeasured >= 0.25', 'rMeasured >= 0.75'));
    host.changed(pouPath);
    const has = async () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].some((x) => /rMeasured >= 0\.75/.test(x.textContent)));
    let ok = await has();
    for (let t = 0; t < 8000 && !ok; t += 250) { await h.sleep(250); ok = await has(); }
    expect(ok, 'changed on disk: the chart shows the new condition');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
