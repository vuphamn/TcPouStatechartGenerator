// A POU that EXTENDS another without a doState() of its own, opened in a host (the VS Code extension's webview and
// host.cjs, as vscode-extension serves it): its base looked for in the PLC project (findPou: Common/, beside neither
// the POU nor its folder), its enum found beside the base; the chart its states and the transitions of their methods
// (its own override and the base's); the header says what it extends. A transition written in the base: its condition
// not edited from the chart (where it is written said); Go to code opens its method in the Method Editor, which lists
// the inherited methods with their base. The base changed on disk: the chart has it. An inherited method edited there:
// asked once (the base of other POUs too), the chart has it, Save writes the base's file; the POU's own file untouched
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

    // Go to code on it: the Method Editor at stEnabling(), marked inherited from SM_Base
    await p.keyboard.press('Escape');
    if (label) {
      await p.mouse.click(label.x, label.y, { button: 'right' });
      await p.waitForSelector('[id$="goto-code-btn"]', { timeout: 4000 }).catch(() => {});
      const id = await p.evaluate(() => [...document.querySelectorAll('[id$="goto-code-btn"]')].find((b) => b.getBoundingClientRect().width > 0)?.id ?? '');
      if (id) await p.click(`#${id}`).catch(() => {});
    }
    await p.waitForSelector('#method-inherited-note', { timeout: 6000 }).catch(() => {});
    const editor = await p.evaluate(() => ({
      method: document.getElementById('method-selector-combobox')?.value ?? '',
      note: document.getElementById('method-inherited-note')?.textContent?.trim() ?? '',
      options: [...document.querySelectorAll('#method-selector-combobox option')].map((o) => o.textContent.trim()),
    }));
    expect(editor.method === 'stEnabling()' && /inherited · SM_Base/.test(editor.note), `Go to code: stEnabling() in the Method Editor, marked inherited (${editor.method}, ${editor.note})`);
    expect(editor.options.includes('stIdle()') && editor.options.some((o) => /^SM_Base\.stIdle\(\)\s+· SM_Base$/.test(o)) && editor.options.some((o) => /^stRun\(\)\s+· SM_Base$/.test(o)), `the inherited methods listed with their base (${editor.options.join(' | ')})`);

    // The base changed on disk (TwinCAT, git): the chart has it
    const basePath = path.join(work, 'Common', 'Base', 'SM_Base.TcPOU');
    fs.writeFileSync(basePath, fs.readFileSync(basePath, 'utf8').replace('IF bDone THEN', 'IF bDoneOnDisk THEN'));
    host.changed(basePath);
    const hasLabel = (rx) => p.evaluate((src) => [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].some((x) => new RegExp(src).test(x.textContent)), rx);
    let onDisk = false;
    for (let t = 0; t < 8000 && !onDisk; t += 250) {
      await h.sleep(250);
      onDisk = await hasLabel('bDoneOnDisk');
    }
    expect(onDisk, 'the base changed on disk: the chart shows it');

    // An inherited method edited: asked once (the base of other POUs too), Save writes the base, not the POU
    await p.evaluate(() => {
      const sel = document.getElementById('method-selector-combobox');
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(sel, 'stError()');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await h.sleep(600);
    const typed = await p.evaluate(() => {
      const ta = document.querySelector('textarea#method-implementation-editor');
      if (!ta || !ta.value.includes('cmd_bReset')) return false;
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, ta.value.replace('cmd_bReset', 'cmd_bResetEdited'));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    expect(typed, 'stError() (inherited) edited in the Method Editor');
    await h.sleep(300);
    await p.click('#method-save-btn').catch(() => {});
    await p.waitForSelector('#text-prompt-submit', { timeout: 4000 }).catch(() => {});
    const asked = await p.evaluate(() => document.getElementById('text-prompt-dialog')?.innerText ?? '');
    expect(/Change SM_Base\?/.test(asked) && /base of other POUs too/.test(asked), `saving it: asked first (${asked.replace(/\s+/g, ' ').slice(0, 120)})`);
    await p.click('#text-prompt-submit').catch(() => {});
    let edited = false;
    for (let t = 0; t < 6000 && !edited; t += 250) {
      await h.sleep(250);
      edited = await hasLabel('cmd_bResetEdited');
    }
    expect(edited, 'confirmed: the chart has the change');
    await p.click('#header-save-btn').catch(() => {});
    let written = '';
    for (let t = 0; t < 8000 && !/cmd_bResetEdited/.test(written); t += 250) {
      await h.sleep(250);
      written = fs.readFileSync(basePath, 'utf8');
    }
    expect(/IF cmd_bResetEdited THEN/.test(written) && /bDoneOnDisk/.test(written) && written.charCodeAt(0) === 0xfeff && !/KvalInheritedFrom|kss-inherited/.test(written), 'Save: the base written (its own text, the change in it, its BOM kept)');

    // Save: the POU's own text only (the merged methods never in it)
    expect(fs.readFileSync(pouPath, 'utf8') === '\ufeff' + derived, 'the POU file: untouched');
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
