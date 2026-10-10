// A POU whose state machine is in its body (FB_TestCycle: CASE State OF in the function block's own code, no method),
// opened in a host (the VS Code extension's webview and host.cjs): its states and transitions drawn; the editor's caret
// in a branch of the body (editorCaret named by the POU, its line counted after the declaration's, as XAE's editor)
// selects that state; Go to code (navigate) is sent the POU's name, so the host opens the POU's own editor
// (runner-timeout: 240)
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
const decl = 'FUNCTION_BLOCK FB_TestCycle\nVAR_INPUT\n\tbStart : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tbBusy : BOOL;\n\tnCycles : INT;\nEND_VAR\nVAR\n\tState : E_TestState := E_TestState.Idle;\n\ttonRun : TON;\nEND_VAR\n';
const body = 'CASE State OF\n\tE_TestState.Idle:\n\t\tbBusy := FALSE;\n\t\tIF bStart THEN\n\t\t\tState := E_TestState.Running;\n\t\tEND_IF\n\tE_TestState.Running:\n\t\tbBusy := TRUE;\n\t\ttonRun(IN := TRUE, PT := T#2S);\n\t\tIF tonRun.Q THEN\n\t\t\ttonRun(IN := FALSE);\n\t\t\tnCycles := nCycles + 1;\n\t\t\tState := E_TestState.Done;\n\t\tEND_IF\n\tE_TestState.Done:\n\t\tIF NOT bStart THEN\n\t\t\tState := E_TestState.Idle;\n\t\tEND_IF\nEND_CASE\n';
const pou = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_TestCycle" Id="{e1fe9245-b7d1-4f02-9468-a8049ecd6f04}" SpecialFunc="None">
    <Declaration><![CDATA[${decl}]]></Declaration>
    <Implementation>
      <ST><![CDATA[${body}]]></ST>
    </Implementation>
  </POU>
</TcPlcObject>`;
const dut = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="E_TestState" Id="{b8a9e7a5-0f0e-4a43-9d0e-6f6a7b1c2d3e}">
    <Declaration><![CDATA[TYPE E_TestState :
(
	Idle := 0,
	Running,
	Done
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>`;
const work = path.join(h.OUT, 'body-state-machine-project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'POUs'), { recursive: true });
fs.mkdirSync(path.join(work, 'DUTs'), { recursive: true });
fs.writeFileSync(path.join(work, 'KssPlc.plcproj'), '<Project/>');
const pouPath = path.join(work, 'POUs', 'FB_TestCycle.TcPOU');
fs.writeFileSync(pouPath, '﻿' + pou);
fs.writeFileSync(path.join(work, 'POUs', 'E_TestState.TcDUT'), '﻿' + dut);

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
    const sent = [];
    const post = (m) => p.evaluate((m) => window.postMessage(m, '*'), m).catch(() => {});
    const host = createHost({ pouPath, post, ui: { version: 'test', pick: async () => null, reveal: () => {}, open: () => {} } });
    await p.exposeFunction('__toHost', (m) => {
      sent.push(m);
      return host.handle(m);
    });
    await p.evaluateOnNewDocument(() => {
      window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__toHost(m), getState: () => null, setState: () => {} });
    });
    await p.goto(`${origin}/webview.html`, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="Done"]', { timeout: 60000 }).catch(() => {});
    await h.sleep(1500);

    // The chart: the body's states and transitions
    const chart = await p.evaluate(() => ({
      states: [...document.querySelectorAll('#mermaid-canvas-area g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')),
      paths: [...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].map((x) => `${x.getAttribute('data-source-id')}->${x.getAttribute('data-target-id')}`),
      edges: [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].map((x) => `${x.getAttribute('data-from')}->${x.getAttribute('data-to')}`),
      none: /No state machine found/.test(document.body.innerText),
    }));
    const all = new Set([...chart.paths, ...chart.edges]);
    expect(!chart.none && ['Idle', 'Running', 'Done'].every((s) => chart.states.includes(s)), `the body's states drawn (${[...new Set(chart.states)].join(', ')})`);
    expect(['Idle->Running', 'Running->Done', 'Done->Idle'].every((k) => all.has(k)), `its transitions (${[...all].join(', ')})`);

    // Follow selection: the caret in the body's Done branch (its 16th line, after the declaration's 13 lines)
    const declLines = decl.split('\n').length;
    const selected = () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node.diagram-selected-node')].map((n) => n.getAttribute('data-state-id')).join(','));
    await post({ type: 'editorCaret', method: 'FB_TestCycle', line: declLines + 16, lineCount: declLines + body.split('\n').length });
    await h.sleep(800);
    const s1 = await selected();
    await post({ type: 'editorCaret', method: 'FB_TestCycle', line: declLines + 9, lineCount: declLines + body.split('\n').length });
    await h.sleep(800);
    const s2 = await selected();
    expect(s1 === 'Done' && s2 === 'Running', `the caret in the body selects its state (line 16: ${s1 || 'none'}; line 9: ${s2 || 'none'})`);
    // (a method of another name: not the state method, ignored)
    await post({ type: 'editorCaret', method: 'Other', line: declLines + 2, lineCount: 40 });
    await h.sleep(500);
    expect((await selected()) === 'Running', 'a caret in another method: no change');

    // Go to code on a state: navigate sent the POU's name (the host opens its own editor), the branch's line
    sent.length = 0;
    await p.evaluate(() => {
      const el = document.querySelector('#mermaid-canvas-area g.node[data-state-id="Done"]');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.x + r.width / 2), clientY: Math.round(r.y + r.height / 2), button: 2 }));
    });
    const btn = await p.waitForSelector('#context-menu-show-in-xae-btn', { timeout: 3000 }).catch(() => null);
    const clicked = btn ? await p.evaluate((b) => (b.click(), b.innerText.trim()), btn) : null;
    await h.sleep(800);
    const nav = sent.find((m) => m.type === 'navigate');
    expect(!!nav && nav.method === 'FB_TestCycle' && nav.line === 15, `${clicked ?? 'Go to code'}: navigate to FB_TestCycle line 15 (${JSON.stringify(nav && { method: nav.method, line: nav.line })}; sent: ${sent.map((m) => m.type).join(', ')})`);

    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
