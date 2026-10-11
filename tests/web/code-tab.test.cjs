// The VS Code extension's code tab (kvalMachineScope.code): the app in its code mode (window.__KSS_BOOT.code, set by
// the page the extension makes): no header, the Method Editor alone with its declaration, implementation and splitter,
// on the member asked (Execute); showMember switches it (MoveAndAdvance; '' the POU Editor); Save to POU writes the file
// through the host (no header's Save there)
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
const work = path.join(h.OUT, 'code-tab-project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'POUs'), { recursive: true });
fs.writeFileSync(path.join(work, 'Robot.plcproj'), '<Project/>');
const pouPath = path.join(work, 'POUs', 'FB_ScanSequencer.TcPOU');
fs.writeFileSync(pouPath, '﻿' + pou);
fs.writeFileSync(path.join(work, 'POUs', 'E_ScanState.TcDUT'), '﻿' + dut);

(async () => {
  const nonce = crypto.randomBytes(12).toString('base64');
  let origin = '';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, origin).pathname);
    if (u === '/webview.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(webviewHtml(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), { base: `${origin}/app/`, cspSource: origin, nonce, boot: { code: { member: 'Execute' } } }));
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

  const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
  try {
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    const sent = [];
    const post = (m) => p.evaluate((m) => window.postMessage(m, '*'), m).catch(() => {});
    // (the extension's bookmarks store: Execute's line "CASE State OF" bookmarked; the app's changes kept)
    let stored = { states: [], lines: [{ method: 'Execute', line: 5, text: 'CASE State OF' }] };
    const told = [];
    const host = createHost({
      pouPath,
      post,
      ui: { version: 'test', pick: async () => null, reveal: () => {}, open: () => {}, bookmarks: { get: () => stored, changed: (file, b) => { stored = b; told.push(b); } } },
    });
    await p.exposeFunction('__toHost', (m) => {
      sent.push(m);
      return host.handle(m);
    });
    await p.evaluateOnNewDocument(() => {
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__toHost(m), getState: () => null, setState: () => {} });
    });
    await p.goto(`${origin}/webview.html`, { waitUntil: 'load' });
    await p.waitForSelector('#method-implementation-editor', { timeout: 60000 }).catch(() => {});
    await h.sleep(1500);

    // Only the code editors: no header, no canvas, no side panels; Execute() in the Method Editor
    const shown = await p.evaluate(() => ({
      header: !!document.getElementById('app-header')?.offsetParent,
      canvas: !!document.querySelector('#mermaid-canvas-area')?.offsetParent,
      method: document.getElementById('method-selector-combobox')?.value ?? null,
      decl: !!document.getElementById('method-declaration-editor')?.offsetParent,
      splitter: !!document.getElementById('method-panel-splitter')?.offsetParent,
      impl: (document.getElementById('method-implementation-editor')?.value ?? '').slice(0, 40),
    }));
    expect(!shown.header && !shown.canvas && shown.decl && shown.splitter && shown.method === 'Execute()', `the code tab: the Method Editor alone on Execute() (${JSON.stringify(shown)})`);

    await p.screenshot({ path: path.join(h.OUT, 'code-tab.png') }).catch(() => {});
    // Bookmarks from the host: Execute's CASE line marked; one set here told to the host
    const caseLine = (await p.$eval('#method-implementation-editor', (e) => e.value)).split('\n').findIndex((l) => /CASE State OF/.test(l)) + 1;
    const marked = await p.$$eval('#method-bottom-panel [data-bookmark-line]', (r) => r.map((x) => Number(x.getAttribute('data-bookmark-line'))));
    expect(marked.includes(caseLine), `the host's bookmark: line ${caseLine} marked (${marked.join(', ')})`);
    const addAt = caseLine + 2;
    await p.evaluate((n) => document.querySelector(`#method-bottom-panel [data-bookmark-add-line="${n}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), addAt);
    await h.sleep(500);
    const last = told[told.length - 1];
    expect(last && last.lines.some((l) => l.method === 'Execute' && l.line === addAt) && last.lines.some((l) => l.text === 'CASE State OF'), `a bookmark set here: told to the host (${JSON.stringify(last?.lines)})`);
    // (changed by the host meanwhile, the VS Code editors: taken)
    await post({ type: 'bookmarks', pou: 'FB_ScanSequencer.TcPOU', bookmarks: { states: [], lines: [] } });
    await h.sleep(500);
    expect((await p.$$eval('#method-bottom-panel [data-bookmark-line]', (r) => r.length)) === 0, 'the host\'s change (none): taken');

    // showMember: another method; '' the POU Editor
    await post({ type: 'showMember', member: 'MoveAndAdvance' });
    await h.sleep(600);
    expect((await p.$eval('#method-selector-combobox', (e) => e.value).catch(() => '')) === 'MoveAndAdvance()', 'showMember: MoveAndAdvance()');
    await post({ type: 'showMember', member: '' });
    await h.sleep(600);
    expect(await p.evaluate(() => !!document.getElementById('pou-declaration-editor')?.offsetParent), 'showMember "": the POU Editor');
    await post({ type: 'showMember', member: 'Execute' });
    await h.sleep(600);

    // An edit, Save to POU: the file written through the host
    const changed = await p.evaluate(() => {
      const ta = document.getElementById('method-implementation-editor');
      if (!ta) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, ta.value.replace('_Count := _Count + 1;', '_Count := _Count + 2;'));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    await h.sleep(300);
    // (the editor's Diff, as in MachineScope: the edit line by line against the POU)
    await p.click('#method-diff-btn').catch(() => {});
    const diff = await h.until(() => p.$eval('[id$="diff-dialog"], [role="dialog"][aria-label*="iff"]', (e) => e.textContent).catch(() => null), 5000);
    expect(/_Count := _Count \+ 1;/.test(diff ?? '') && /_Count := _Count \+ 2;/.test(diff ?? ''), `Diff: the edit against the POU (${(diff ?? 'no diff').replace(/\s+/g, ' ').slice(0, 120)})`);
    await p.keyboard.press('Escape');
    await h.sleep(400);
    await p.click('#method-save-btn').catch(() => {});
    for (let t = 0; t < 5000 && !sent.some((m) => m.type === 'save'); t += 200) await h.sleep(200);
    await h.sleep(500);
    const disk = fs.readFileSync(pouPath, 'utf8');
    expect(changed && sent.some((m) => m.type === 'save') && /_Count := _Count \+ 2;/.test(disk) && disk.startsWith('﻿'), 'Save to POU: the .TcPOU written (its BOM kept)');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
