// This round (XAE stand-in bridge, a small POU with a timer, another POU of the project using a state): parameter
// hints, snippets, Format Document, the command palette, the shortcuts list, several states selected (Ctrl+click,
// Shift+drag) and their menu, F2 through the bookmarked states, a state's actions in the heat-map's box, and a state
// renamed in the other POU too
const fs = require('fs');
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cdata = (s) => `<![CDATA[${s}]]>`;
const ID = 'method-implementation-editor';

const DO_STATE = [
  'CASE machineState OF',
  '\tS_IDLE:',
  '\t\tnCycles := nCycles + 1;',
  '\t\tIF cmd_bStart THEN',
  '\t\t\tmachineState := E_S.S_RUN;',
  '\t\tEND_IF',
  '\tS_RUN:',
  '\t\tIF cmd_bStop THEN',
  '\t\t\tmachineState := E_S.S_IDLE;',
  '\t\tEND_IF',
  'END_CASE',
].join('\n');
const DECL = ['FUNCTION_BLOCK SM_X', 'VAR_INPUT', '\tcmd_bStart : BOOL;', '\tcmd_bStop : BOOL;', 'END_VAR', 'VAR', '\tmachineState : E_S;', '\tnCycles : INT;', '\tfbWait : TON;', 'END_VAR'].join('\n');
const method = (name, decl, code) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO_STATE)}\n  </POU>\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_S" Id="{2}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_S :\n(\n\tS_IDLE := 0,\n\tS_RUN\n);\nEND_TYPE")}</Declaration>\n  </DUT>\n</TcPlcObject>`;
const OTHER = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="PRG_Line" Id="{9}" SpecialFunc="None">\n    <Declaration>${cdata('PROGRAM PRG_Line\nVAR\n\tsmX : SM_X;\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('IF smX.machineState = E_S.S_RUN THEN\n\tbLamp := TRUE;\nEND_IF')}</ST>\n    </Implementation>\n  </POU>\n</TcPlcObject>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await toApp({ type: 'loadPou', source: { name: 'SM_X.TcPOU', path: 'C:\\proj\\SM_X.TcPOU', content: POU, dutCandidates: [{ name: 'E_S.TcDUT', relativePath: 'E_S.TcDUT', path: 'C:\\proj\\E_S.TcDUT', content: DUT }] } });
    else if (m.type === 'projectSymbols') await toApp({ type: 'projectSymbols', project: 'P', files: [] });
    else if (m.type === 'projectUses') await toApp({ type: 'projectUses', requestId: m.requestId, files: [{ name: 'PRG_Line.TcPOU', path: 'C:\\proj\\PRG_Line.TcPOU', content: OTHER }] });
    else if (m.type === 'saveOther') await toApp({ type: 'saveOtherResult', requestId: m.requestId, ok: true });
    else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
  });
  await p.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="S_IDLE"]', { timeout: 60000 });
  await h.sleep(1200);
  const caretAt = (text, offset = 0) => p.evaluate((id, text, offset) => {
    const ta = document.getElementById(id);
    const at = ta.value.indexOf(text);
    ta.focus();
    ta.setSelectionRange(at + offset, at + offset);
  }, ID, text, offset);
  const code = () => p.$eval(`#${ID}`, (e) => e.value);

  // 1. Parameter hints
  await p.click('#dock-tab-method');
  await p.waitForSelector(`#${ID}`);
  await h.sleep(600);
  await caretAt('\tS_RUN:');
  await p.keyboard.type('\t\tfbWait(', { delay: 10 });
  await h.sleep(300);
  let sig = await p.$eval(`#${ID}-signature`, (e) => ({ text: e.textContent.replace(/\s+/g, ' ').trim(), active: e.querySelector('.code-signature-active')?.getAttribute('data-param') })).catch(() => null);
  expect(!!sig && /fbWait\(IN: BOOL, PT: TIME, => Q: BOOL, => ET: TIME\)/.test(sig.text) && sig.active === 'IN', `fbWait( : ${sig?.text} (at ${sig?.active})`);
  await p.keyboard.type('TRUE, ', { delay: 10 });
  await h.sleep(250);
  sig = await p.$eval(`#${ID}-signature`, (e) => ({ active: e.querySelector('.code-signature-active')?.getAttribute('data-param') })).catch(() => null);
  expect(sig?.active === 'PT', `after the first argument: at ${sig?.active}`);
  await p.keyboard.type('Q := ', { delay: 10 });
  await h.sleep(250);
  sig = await p.$eval(`#${ID}-signature`, (e) => ({ active: e.querySelector('.code-signature-active')?.getAttribute('data-param') })).catch(() => null);
  expect(sig?.active === 'Q', `a named parameter: at ${sig?.active}`);
  await p.keyboard.press('Escape');
  await h.sleep(150);
  expect(!(await p.$(`#${ID}-signature`)), 'Esc: the hint closes');
  await p.keyboard.type('x);', { delay: 10 });
  await p.keyboard.press('Enter');

  // 2. A snippet: "if" and Tab (on a line of its own)
  await caretAt('\tS_RUN:');
  await p.keyboard.press('Enter');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.type('\t\tif', { delay: 10 });
  await p.keyboard.press('Tab');
  await h.sleep(200);
  await p.keyboard.type('nCycles > 3', { delay: 10 });
  await h.sleep(200);
  let c = await code();
  expect(/\t\tIF nCycles > 3 THEN\n\t\t\t\n\t\tEND_IF\n\tS_RUN:/.test(c), `if + Tab: IF … THEN … END_IF, indented like its line, the caret in the condition ${JSON.stringify(c.split('\tS_RUN:')[0].split('\n').slice(-5).join('\n'))}`);

  // 3. Format Document (Shift+Alt+F)
  await caretAt('\tS_RUN:');
  await p.keyboard.type('nCycles := 0;', { delay: 5 });
  await p.keyboard.press('Enter');
  expect((await code()).includes('\nnCycles := 0;\n'), 'a line typed at the start of the line');
  await p.keyboard.down('Shift'); await p.keyboard.down('Alt'); await p.keyboard.press('KeyF'); await p.keyboard.up('Alt'); await p.keyboard.up('Shift');
  await h.sleep(300);
  c = await code();
  expect(c.includes('\n\t\tnCycles := 0;\n\tS_RUN:') && c.includes('\t\tIF nCycles > 3 THEN'), 'Shift+Alt+F: re-indented in its CASE branch');

  // 4. The command palette
  await p.click('#dock-tab-diagram');
  await h.sleep(500);
  await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyP'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
  await p.waitForSelector('#command-palette', { timeout: 3000 }).catch(() => {});
  const all = await p.$$eval('#command-palette .command-palette-item', (r) => r.length);
  await p.keyboard.type('show actions', { delay: 10 });
  await h.sleep(150);
  const first = await p.$eval('#command-palette .command-palette-item', (e) => e.textContent.trim()).catch(() => '');
  expect(all > 10 && /Show entry \/ do \/ exit actions/.test(first), `Ctrl+Shift+P: ${all} commands; "show actions": ${first}`);
  await p.keyboard.press('Enter');
  await h.sleep(600);
  expect(await p.$eval('#state-actions-checkbox', (e) => e.checked), 'Enter: the option on');
  await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyP'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
  await p.waitForSelector('#command-palette', { timeout: 3000 }).catch(() => {});
  await p.keyboard.type('go s_run', { delay: 10 });
  await h.sleep(150);
  expect(/Go to S_RUN/.test(await p.$eval('#command-palette .command-palette-item', (e) => e.textContent).catch(() => '')), 'the states are commands');
  await p.keyboard.press('Escape');
  // Nothing typed: the one run last first, "recently used"
  const palette = async (text) => {
    await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyP'); await p.keyboard.up('Shift'); await p.keyboard.up('Control');
    await p.waitForSelector('#command-palette', { timeout: 3000 }).catch(() => {});
    if (text) await p.keyboard.type(text, { delay: 5 });
    await h.sleep(150);
  };
  await palette('');
  const top = await p.$eval('#command-palette .command-palette-item', (e) => e.textContent.trim()).catch(() => '');
  expect(/(Show|Hide) entry \/ do \/ exit actions.*recently used/.test(top), `the palette again: the last one first, "recently used" (${top})`);
  await p.keyboard.press('Escape');
  // Snippets to a file (the save dialog: XAE's) and from one (merged: a key in both, the file's)
  await p.evaluate(() => localStorage.setItem('kss.snippets', JSON.stringify([{ key: 'mine', body: 'a := 1;', description: 'my one' }, { key: 'both', body: 'old;' }])));
  await palette('export snippets');
  await p.keyboard.press('Enter');
  await h.sleep(400);
  const saved = sent.find((m) => m.type === 'saveDocument' && /snippets/.test(m.name));
  const savedList = saved ? JSON.parse(saved.content).snippets.map((s) => s.key).join() : '';
  expect(savedList === 'mine,both', `Export snippets: ${saved?.name} with ${savedList}`);
  const file = h.out('shared.kss-snippets.json');
  fs.writeFileSync(file, JSON.stringify({ kind: 'kss-snippets', version: 1, snippets: [{ key: 'both', body: 'new;' }, { key: 'theirs', body: 'b := 2;' }] }));
  await palette('import snippets');
  const [chooser] = await Promise.all([p.waitForFileChooser({ timeout: 3000 }), p.keyboard.press('Enter')]);
  await chooser.accept([file]);
  await h.sleep(500);
  const now = await p.evaluate(() => JSON.parse(localStorage.getItem('kss.snippets')).map((s) => `${s.key}=${s.body}`).join(' '));
  expect(now === 'mine=a := 1; both=new; theirs=b := 2;', `Import snippets: merged (${now})`);
  await p.evaluate(() => localStorage.removeItem('kss.snippets'));

  // 5. The shortcuts list (?)
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.type('?');
  await p.waitForSelector('#shortcuts-dialog', { timeout: 3000 }).catch(() => {});
  await p.type('#shortcuts-filter', 'palette');
  await h.sleep(100);
  const rows = await p.$$eval('#shortcuts-dialog .shortcut-row', (r) => r.map((x) => x.textContent));
  expect(rows.length === 1 && /Ctrl\+Shift\+P/.test(rows[0]), `?: the shortcuts, filtered "palette": ${rows.join(' | ')}`);
  await p.keyboard.press('Escape');
  await h.sleep(200);

  // 6. Several states: Ctrl+click, their menu, Shift+drag
  const nodeAt = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-diagram-svg-container g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: { l: r.left, t: r.top, rr: r.right, b: r.bottom } }; }, id);
  const idle = await nodeAt('S_IDLE');
  const run = await nodeAt('S_RUN');
  await p.keyboard.down('Control');
  await p.mouse.click(idle.x, idle.y);
  await p.mouse.click(run.x, run.y);
  await p.keyboard.up('Control');
  await h.sleep(300);
  const marked = () => p.$$eval('#mermaid-diagram-svg-container g.node.multi-selected', (n) => n.map((x) => x.getAttribute('data-state-id')).sort());
  expect((await marked()).join() === 'S_IDLE,S_RUN' && /2 states selected/.test(await p.$eval('#canvas-multi-selection', (e) => e.textContent).catch(() => '')), `Ctrl+click twice: ${await marked()}`);
  await p.mouse.click(idle.x, idle.y, { button: 'right' });
  await h.sleep(400);
  expect(/Bookmark the 2 states/.test(await p.$eval('#context-menu-multi-bookmark-btn', (e) => e.textContent).catch(() => '')), 'their menu: Bookmark the 2 states');
  await p.click('#context-menu-multi-bookmark-btn');
  await h.sleep(400);
  const cards = await p.$$eval('[id^="state-bookmark-"]', (m) => m.map((x) => x.id).sort());
  const ribbons = await p.$$eval('#mermaid-diagram-svg-container g.state-bookmark-marker', (m) => m.map((x) => x.getAttribute('data-state-id')).sort());
  expect(ribbons.join() === 'S_IDLE,S_RUN', `both bookmarked: ${ribbons.join(', ')} ${cards.join(', ')}`);
  await p.keyboard.press('Escape');
  await h.sleep(200);
  expect((await marked()).length === 0, 'Esc: the selection cleared');
  // Shift+drag a box around both
  const box = { l: Math.min(idle.r.l, run.r.l) - 20, t: Math.min(idle.r.t, run.r.t) - 20, r: Math.max(idle.r.rr, run.r.rr) + 20, b: Math.max(idle.r.b, run.r.b) + 20 };
  await p.keyboard.down('Shift');
  await p.mouse.move(box.l, box.t);
  await p.mouse.down();
  await p.mouse.move((box.l + box.r) / 2, (box.t + box.b) / 2, { steps: 4 });
  const band = !!(await p.$('#canvas-select-band'));
  await p.mouse.move(box.r, box.b, { steps: 4 });
  await p.mouse.up();
  await p.keyboard.up('Shift');
  await h.sleep(300);
  expect(band && (await marked()).join() === 'S_IDLE,S_RUN', `Shift+drag: the box, then ${await marked()}`);
  await p.keyboard.press('Escape');

  // 7. F2 through the bookmarked states
  await p.mouse.click(5, 300);
  await h.sleep(200);
  await p.evaluate(() => document.getElementById('mermaid-canvas-area')?.focus());
  await p.keyboard.press('F2');
  await h.sleep(500);
  let toast = await p.evaluate(() => document.body.innerText.match(/Bookmark \d of 2: S_\w+/)?.[0] ?? '');
  await p.keyboard.press('F2');
  await h.sleep(500);
  const toast2 = await p.evaluate(() => [...document.body.innerText.matchAll(/Bookmark \d of 2: S_\w+/g)].map((m) => m[0]).pop() ?? '');
  expect(toast === 'Bookmark 1 of 2: S_IDLE' && toast2 === 'Bookmark 2 of 2: S_RUN', `F2, F2: ${toast} → ${toast2}`);

  // 8. The heat-map's box has the state's actions (no browser tooltip over it)
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('h');
  await h.sleep(800);
  const idle2 = await nodeAt('S_IDLE');
  // (where the box is in each frame from the hover on: it shows in its place, it does not glide there)
  await p.evaluate(() => { window.__boxAt = []; const t0 = performance.now(); const f = () => { const b = document.querySelector('#heatmap-state-hover-tooltip, #state-actions-hover'); if (b && getComputedStyle(b).visibility === 'visible') { const r = b.getBoundingClientRect(); window.__boxAt.push(Math.round(r.left) + ',' + Math.round(r.top)); } if (performance.now() - t0 < 700) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.mouse.move(idle2.x + 3, idle2.y);
  await p.mouse.move(idle2.x, idle2.y);
  await h.sleep(300);
  await h.sleep(500);
  const boxAt = [...new Set(await p.evaluate(() => window.__boxAt))];
  expect(boxAt.length === 1, `the box shows in its place at once (no glide): ${boxAt.join(' → ')}`);
  const heat = await p.$('#heatmap-state-hover-tooltip');
  const inHeat = await p.$eval('#state-actions-in-heatmap', (e) => e.textContent).catch(() => '');
  expect(!!heat ? /nCycles := nCycles \+ 1;[\s\S]*IF cmd_bStart THEN[\s\S]*END_IF/.test(inHeat) && !(await p.$('#state-actions-hover')) : !!(await p.$('#state-actions-hover')), `heat-map on: the state's whole code ${heat ? 'in its box' : 'in its own box'} (${inHeat.replace(/\s+/g, ' ').slice(0, 80)})`);
  // ... beside the state (below or above it), not over it
  const over = await p.evaluate(() => {
    const b = document.querySelector('#heatmap-state-hover-tooltip, #state-actions-hover')?.getBoundingClientRect();
    const g = document.querySelector('#mermaid-diagram-svg-container g.node[data-state-id="S_IDLE"]');
    const n = (g.querySelector('rect, polygon, circle, path') || g).getBoundingClientRect();
    return b ? { overlap: b.left < n.right && b.right > n.left && b.top < n.bottom && b.bottom > n.top, b: [b.top, b.bottom].map(Math.round), n: [n.top, n.bottom].map(Math.round) } : null;
  });
  expect(!!over && !over.overlap, `the box beside S_IDLE, not over it: box ${over?.b}, state ${over?.n}`);
  await p.keyboard.press('h');
  await p.mouse.move(5, 5);

  // 9. Several states lined up, and moved together
  await h.sleep(600);
  const idleC = await nodeAt('S_IDLE');
  const runC = await nodeAt('S_RUN');
  await p.keyboard.down('Control');
  await p.mouse.click(idleC.x, idleC.y);
  await h.sleep(200);
  // (S_RUN, the state F2 selected, is in it already)
  if (!(await marked()).includes('S_RUN')) await p.mouse.click(runC.x, runC.y);
  await p.keyboard.up('Control');
  await h.sleep(300);
  expect((await marked()).join() === 'S_IDLE,S_RUN', `Ctrl+click both again: ${await marked()}`);
  // Their menu: Align top edges (side by side) or left edges (one above the other)
  const sideBySide = Math.abs(idleC.x - runC.x) > Math.abs(idleC.y - runC.y);
  const shapeEdge = (id) => p.evaluate(([id, top]) => { const g = document.querySelector(`#mermaid-diagram-svg-container g.node[data-state-id="${id}"]`); const r = (g.querySelector('rect, polygon, circle, path') || g).getBoundingClientRect(); return top ? r.top : r.left; }, [id, sideBySide]);
  const idleB = await nodeAt('S_IDLE');
  await p.mouse.click(idleB.x, idleB.y, { button: 'right' });
  await h.sleep(400);
  const hasArrange = !!(await p.$('#context-menu-multi-align-left-btn')) && !!(await p.$('#context-menu-multi-align-top-btn'));
  await p.click(sideBySide ? '#context-menu-multi-align-top-btn' : '#context-menu-multi-align-left-btn');
  await h.sleep(600);
  const [ti, tr] = [await shapeEdge('S_IDLE'), await shapeEdge('S_RUN')];
  expect(hasArrange && Math.abs(ti - tr) < 2, `Align ${sideBySide ? 'top' : 'left'} edges: S_IDLE ${ti.toFixed(1)}, S_RUN ${tr.toFixed(1)}`);
  // Drag one: the other moves with it
  const a0 = await nodeAt('S_IDLE');
  const b0 = await nodeAt('S_RUN');
  await p.mouse.move(a0.x, a0.y);
  await p.mouse.down();
  await p.mouse.move(a0.x + 30, a0.y + 60, { steps: 6 });
  await p.mouse.up();
  await h.sleep(500);
  const a1 = await nodeAt('S_IDLE');
  const b1 = await nodeAt('S_RUN');
  const da = { x: a1.x - a0.x, y: a1.y - a0.y };
  const db = { x: b1.x - b0.x, y: b1.y - b0.y };
  expect(Math.abs(da.y) > 20 && Math.abs(da.x - db.x) < 3 && Math.abs(da.y - db.y) < 3, `drag S_IDLE: S_RUN moves with it (${da.x.toFixed(0)},${da.y.toFixed(0)} / ${db.x.toFixed(0)},${db.y.toFixed(0)})`);
  await p.keyboard.press('Escape');

  // 9. A state renamed here and in the other POU
  const run2 = await nodeAt('S_RUN');
  await p.mouse.click(run2.x, run2.y, { button: 'right' });
  await h.sleep(400);
  await p.click('#context-menu-rename-state-btn');
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 });
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('S_WORK', { delay: 10 });
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => /in 1 other POU too/.test(document.getElementById('text-prompt-dialog')?.innerText || ''), { timeout: 5000 }).catch(() => {});
  const ask = await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
  expect(/Rename S_RUN in 1 other POU too\?/.test(ask) && /PRG_Line\.TcPOU/.test(ask) && /E_S\.S_WORK THEN/.test(ask), `asked for PRG_Line: ${ask.split('\n').slice(0, 3).join(' | ')}`);
  await p.click('#text-prompt-submit');
  await h.sleep(800);
  const save = sent.find((m) => m.type === 'saveOther');
  expect(!!save && save.files[0].content.includes('smX.machineState = E_S.S_WORK THEN') && save.files[0].baseline === OTHER, 'PRG_Line written with E_S.S_WORK');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
