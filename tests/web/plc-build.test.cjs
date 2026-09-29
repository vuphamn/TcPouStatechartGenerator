const h = require('../lib/harness.cjs');
// Web edition through Link: a POU from the PLC's own sources, edited, then Build (the PLC's project rebuilt with it:
// Link's stand-in compiler, KSS_BUILD_DRYRUN), its error listed and opened, fixed, built again, written to the PLC
// (online change, after its confirmation)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-build.json', [], { sources: true, license: 5 });

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48966', cfg], { stdio: ['ignore', fs.openSync(path.join(h.OUT, 'fake-ams2-build.txt'), 'w'), 'ignore'] });
  const linkOut = path.join(h.OUT, 'link-build-run.txt');
  const out = fs.openSync(linkOut, 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48967'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-build-appdata'), KSS_BUILD_DRYRUN: '1', KSS_BUILD_REFUSE_ONLINE: '1' }, stdio: ['ignore', out, out] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  // (waits for the field: the Live tab's fields show a moment after it is opened)
  const set = async (p, id, v) => {
    await p.waitForSelector(`#${id}`, { timeout: 10000 }).catch(() => {});
    return p.evaluate((id, v) => { const el = document.getElementById(id); if (!el) throw new Error(`no #${id}`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  };
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await set(a, 'live-link-port-input', '48967');
  // This PC: the local PLC in one click (through this computer's TwinCAT router)
  await set(a, 'live-netid-input', '5.1.2.3.1.1');
  await a.click('#live-plc-local');
  await new Promise((r) => setTimeout(r, 200));
  const local = await a.evaluate(() => ({ netId: document.getElementById('live-netid-input').value, ip: document.getElementById('live-ip-input').value, local: document.getElementById('live-local-netid-input')?.value ?? '' }));
  expect(local.netId === '127.0.0.1.1.1' && local.ip === '127.0.0.1' && local.local === '', `This PC: ${JSON.stringify(local)}`);
  await set(a, 'live-ip-input', '127.0.0.1:48966');
  await set(a, 'live-instance-input', 'MAIN.mainStateMachine.smTable1');
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-open-from-plc-btn', { timeout: 20000 }).catch(() => {});
  // A sample (not from the PLC): no Build
  expect(!(await a.$('#live-build-btn')), 'a POU not from the PLC: no Build');

  // From PLC: SM_Conveyor, live on MAIN.conveyor
  await a.click('#live-open-from-plc-btn');
  await a.waitForSelector('#plc-pou-picker-input', { timeout: 20000 }).catch(() => {});
  await a.type('#plc-pou-picker-input', 'conveyor', { delay: 5 });
  await sleep(200);
  await a.keyboard.press('Enter');
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="CONVEYOR_RUNNING"]', { timeout: 20000 }).catch(() => {});
  let live = '';
  for (let i = 0; i < 60 && !/CONVEYOR_RUNNING/.test(live); i++) { await sleep(300); live = await a.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
  await a.waitForSelector('#live-build-btn', { timeout: 10000 }).catch(() => {});
  await a.screenshot({ path: h.out('plc-build-open.png') });
  expect(/CONVEYOR_RUNNING/.test(live) && !!(await a.$('#live-build-btn')), `SM_Conveyor from the PLC, live (${live}): Build offered`);
  // Its TwinCAT trial license runs out in 5 h: the Live tab says so
  await a.waitForSelector('#live-license-notice', { timeout: 8000 }).catch(() => {});
  const lic = await a.$eval('#live-license-notice', (e) => e.getAttribute('data-state') + '|' + e.textContent).catch(() => '');
  expect(/^soon\|The PLC's TwinCAT trial license runs out in [45] h/.test(lic), `the trial license running out: "${lic.slice(0, 90)}"`);

  const status = () => a.$eval('#plc-build-status', (e) => ({ phase: e.getAttribute('data-phase'), ok: e.getAttribute('data-ok'), text: e.textContent.trim() })).catch(() => ({ phase: '', ok: '', text: '' }));
  const waitDone = async () => { let s = await status(); for (let i = 0; i < 100 && s.phase !== 'done'; i++) { await sleep(200); s = await status(); } return s; };

  // 1. Built as it is: no errors, a warning; Write offered
  await a.click('#live-build-btn');
  await a.waitForSelector('#plc-build-dialog', { timeout: 5000 }).catch(() => {});
  const files = await a.$eval('#plc-build-dialog', (e) => e.innerText).catch(() => '');
  let s = await waitDone();
  expect(s.ok === 'true' && /Built: no errors, 1 warning/.test(s.text) && /SM_Conveyor\.TcPOU/.test(files) && !!(await a.$('#plc-build-online')), `as it is: "${s.text}"`);
  // XAE kept open for the next build: until when; closed on request
  const keep = await a.$eval('#plc-build-xae', (e) => e.textContent).catch(() => '');
  await a.click('#plc-build-xae-close').catch(() => {});
  await a.waitForSelector('#plc-build-xae-closed', { timeout: 5000 }).catch(() => {});
  expect(/XAE stays open with the project until \d{1,2}:\d{2}/.test(keep) && !!(await a.$('#plc-build-xae-closed')), `XAE kept open: "${keep.slice(0, 70)}", then closed`);  await a.click('#dock-tab-live').catch(() => {});
  await a.evaluate(() => document.querySelector('#plc-build-dialog button[title^="Close"]')?.click());
  await sleep(300);

  // 2. An error put in (the state's code), built: listed with its place, opened at it
  // (its menu: right-click again while the canvas is still being drawn)
  const openStateCode = async () => {
    for (let i = 0; i < 4 && !(await a.$('textarea#text-prompt-input')); i++) {
      // (the canvas shown, the state where it is now: the diagram may have been drawn again)
      await a.evaluate(() => document.getElementById('dock-tab-diagram')?.click());
      await sleep(300);
      const at = (await a.evaluate(() => { const n = document.querySelector('#mermaid-canvas-area g.node[data-state-id="CONVEYOR_RUNNING"]'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })) ?? node;
      await a.mouse.click(at.x, at.y, { button: 'right' });
      await a.waitForSelector('#context-menu-edit-state-code-btn', { timeout: 3000 }).catch(() => {});
      await a.click('#context-menu-edit-state-code-btn').catch(() => {});
      await a.waitForSelector('textarea#text-prompt-input', { timeout: 3000 }).catch(() => {});
    }
  };
  const node = await a.evaluate(() => { const r = document.querySelector('#mermaid-canvas-area g.node[data-state-id="CONVEYOR_RUNNING"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await openStateCode();
  const original = await a.$eval('#text-prompt-input', (e) => e.value).catch(() => '');
  await a.evaluate(() => { const t = document.getElementById('text-prompt-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, t.value + '\nnoSuchVar := 1;'); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  // (not declared: its Declare box, if offered, left off)
  await a.evaluate(() => document.querySelectorAll('#text-prompt-dialog input[type="checkbox"]').forEach((c) => c.checked && c.click()));
  await a.click('#text-prompt-submit');
  await sleep(600);
  expect(!(await a.$('#text-prompt-dialog')), `the state's code changed (${original.split('\n').length} lines + 1)`);
  await a.click('#dock-tab-live').catch(() => {});
  await a.click('#live-build-btn');
  s = await waitDone();
  const errs = await a.$$eval('#plc-build-errors .plc-build-item', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim())).catch(() => []);
  expect(s.ok === 'false' && /1 error/.test(s.text) && errs.length === 1 && /Identifier 'noSuchVar' not defined/.test(errs[0]) && /SM_Conveyor\.doState\(\) line \d+/.test(errs[0]) && !(await a.$('#plc-build-online')), `with the error: "${s.text}" ${errs.join(' | ')}`);
  await a.screenshot({ path: h.out('plc-build-error.png') });
  // The Problems tab lists the build's messages too; Open code there opens the error at its line
  await a.evaluate(() => document.getElementById('dock-tab-problems')?.click());
  await sleep(500);
  const problems = await a.$$eval('#problems-panel [data-problem-key^="build:"]', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim())).catch(() => []);
  expect(problems.some((t) => /Build error/.test(t) && /noSuchVar/.test(t) && /SM_Conveyor\.doState\(\) line \d+/.test(t)) && problems.some((t) => /Build warning/.test(t)), `the Problems tab: ${problems.length} from the build (${problems[0] ?? '-'})`);
  await a.evaluate(() => document.querySelector('#problems-panel [data-problem-key^="build:error"] .problems-go-to-code')?.click());
  await sleep(1000);
  const fromProblems = await a.evaluate(() => { const t = document.getElementById('method-implementation-editor'); return t ? t.value : ''; });
  expect(/noSuchVar/.test(fromProblems), 'Open code from the Problems tab: the Method Editor on doState()');
  // Closed: the last build kept, the Live tab reopens it
  await a.evaluate(() => document.querySelector('#plc-build-dialog button[title^="Close"]')?.click());
  await a.click('#dock-tab-live').catch(() => {});
  await sleep(300);
  const last = await a.$eval('#live-last-build-btn', (e) => e.textContent.trim()).catch(() => '');
  await a.click('#live-last-build-btn').catch(() => {});
  await sleep(300);
  const reopened = await a.$$eval('#plc-build-errors .plc-build-item', (r) => r.length).catch(() => 0);
  expect(last === 'Last build: 1 error' && reopened === 1, `closed, kept: "${last}", reopened with its error (${reopened})`);
  // vs PLC: this POU against the PLC's version, part by part (the line put in; nothing to save there)
  await a.evaluate(() => document.querySelector('#plc-build-dialog button[title^="Close"]')?.click());
  await a.click('#dock-tab-live').catch(() => {});
  await a.click('#live-compare-plc-btn').catch(() => {});
  await a.waitForSelector('#review-code', { timeout: 10000 }).catch(() => {});
  const vsPlc = await a.evaluate(() => ({ parts: [...document.querySelectorAll('#review-code .review-code-part')].map((x) => x.getAttribute('data-part') + ': ' + x.querySelector('div')?.textContent.split(': ').slice(1).join(': ')), rows: [...document.querySelectorAll('#review-code .review-code-part div.whitespace-pre')].map((x) => x.textContent.trim()), save: !!document.getElementById('review-save'), title: document.getElementById('review-dialog')?.innerText.split('\n')[1] ?? '' }));
  expect(vsPlc.parts.join() === 'doState(): 1 line in, 0 out' && vsPlc.rows.some((r) => /^\+\s+noSuchVar := 1;/.test(r)) && !vsPlc.save, `vs PLC: ${vsPlc.parts.join(' | ')} (${vsPlc.rows.filter((r) => /^[+-]/.test(r)).join(' ')}), no Save`);
  await a.evaluate(() => [...document.querySelectorAll('#review-dialog button')].find((b) => /Keep editing/.test(b.textContent))?.click());
  await sleep(300);
  await a.click('#live-build-btn').catch(() => {});
  await waitDone();
  await a.click('#plc-build-errors .plc-build-item');
  await sleep(1000);
  // (the Method Editor on doState(), its line marked: the line the error names)
  const errLine = Number(/line (\d+)/.exec(errs[0] ?? '')?.[1]);
  const shown = await a.evaluate((n) => {
    const t = document.getElementById('method-implementation-editor');
    const box = t?.parentElement?.parentElement;
    return { line: t ? t.value.split('\n')[n - 1] : '', marked: !!box?.querySelector('.border-sky-400.bg-sky-500\\/15') };
  }, errLine);
  expect(/noSuchVar/.test(shown.line) && shown.marked, `the error opened in the Method Editor, its line ${errLine} marked: "${(shown.line ?? '').trim()}"`);
  await a.click('#dock-tab-diagram').catch(() => {});
  await sleep(600);

  // 3. Fixed (the state's code as it was), built again, written to the PLC after its confirmation
  await openStateCode();
  await a.evaluate((v) => { const t = document.getElementById('text-prompt-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, v); t.dispatchEvent(new Event('input', { bubbles: true })); }, original);
  await sleep(200);
  await a.click('#text-prompt-submit');
  await sleep(600);
  await a.click('#plc-build-again');
  s = await waitDone();
  expect(s.ok === 'true' && /no errors/.test(s.text), `fixed: "${s.text}"`);
  await a.click('#plc-build-online');
  const confirmBtn = await a.$eval('#plc-build-confirm-btn', (e) => e.disabled).catch(() => null);
  const warning = await a.$eval('#plc-build-confirm', (e) => e.innerText).catch(() => '');
  const changesText = await a.$eval('#plc-build-changes', (e) => e.innerText).catch(() => '');
  expect(/What changes on the PLC/.test(changesText), `the confirmation says what changes on the PLC: ${changesText.split(String.fromCharCode(10)).slice(1, 4).join(' | ')}`);
  expect(confirmBtn === true && /online change/.test(warning) && /127\.0\.0\.1\.1\.1/.test(warning), `the confirmation: its warning and target, Write off until checked (${warning.split('\n')[0]})`);
  await a.click('#plc-build-safe');
  await a.click('#plc-build-confirm-btn');
  s = await waitDone();
  // (from the PLC's copy of the project TwinCAT refuses an online change, as the stand-in does: nothing written,
  // the download offered, with its own warning and confirmation)
  const refusedOnline = s.text;
  const offered = !!(await a.$('#plc-build-download')) && !!(await a.$('#plc-build-activate')) && !(await a.$('#plc-build-online'));
  expect(s.ok === 'false' && /No online change was made, nothing was written/.test(refusedOnline) && offered, `online change refused: "${refusedOnline.slice(0, 70)}", Download offered: ${offered}`);
  await a.click('#plc-build-download');
  const dlWarning = await a.$eval('#plc-build-confirm', (e) => e.innerText).catch(() => '');
  const dlOff = await a.$eval('#plc-build-confirm-btn', (e) => e.disabled).catch(() => null);
  expect(dlOff === true && /application stops, takes the new code and starts again/.test(dlWarning), `Download's confirmation: "${dlWarning.split('\n')[1]?.slice(0, 80)}", off until checked`);
  await a.click('#plc-build-safe');
  await a.click('#plc-build-confirm-btn');
  s = await waitDone();
  expect(s.ok === 'true' && /Written to the PLC \(download\)/.test(s.text), `written: "${s.text}"`);
  await a.click('#plc-build-warnings-toggle').catch(() => {});
  const warned = await a.$$eval('#plc-build-warnings .plc-build-item', (r) => r.map((x) => x.innerText)).catch(() => []);
  expect(warned.some((t) => /trial license runs out/.test(t)), `the download warned of the trial license (${warned.length} warnings)`);
  const log = fs.readFileSync(linkOut, 'utf8');
  // (the POU and its enum, one of the PLC's)
  expect(/build: .* rebuilds the PLC's project \(2 edited file\(s\)\), then online/.test(log) && /then download/.test(log) && /SM_Conveyor\.TcPOU, E_Conveyor_States\.TcDUT/.test(files), 'Link: the build and the write logged (the POU and its enum)');
  const dirty = await a.evaluate(() => /Save \(\d/.test(document.getElementById('save-sources-btn')?.textContent ?? ''));
  expect(!dirty, 'on the PLC now: nothing to save');
  await a.screenshot({ path: h.out('plc-build-written.png') });

  await a.screenshot({ path: h.out('plc-build-stopped.png') }).catch(() => {});
  // 4. Several POUs of the PLC edited in one go: SM_Conveyor's edit kept when SM_TableManager is opened, both built
  await a.evaluate(() => document.querySelector('#plc-build-dialog button[title^="Close"]')?.click());
  await a.click('#dock-tab-diagram').catch(() => {});
  await sleep(500);
  await openStateCode();
  await a.evaluate(() => { const t = document.getElementById('text-prompt-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, t.value + '\n// kept for the build'); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await a.click('#text-prompt-submit').catch(() => {});
  await sleep(500);
  const openFromPlc = async (name) => {
    await a.click('#dock-tab-live').catch(() => {});
    await a.click('#live-open-from-plc-btn').catch(() => {});
    await a.waitForSelector('#plc-pou-picker-input', { timeout: 20000 }).catch(() => {});
    await a.type('#plc-pou-picker-input', name, { delay: 5 });
    await sleep(200);
    await a.keyboard.press('Enter');
    await sleep(1500);
  };
  await openFromPlc('tablemanager');
  const kept = await a.evaluate(() => /Kept your edits of SM_Conveyor\.TcPOU/.test(document.body.innerText));
  expect(kept && !(await a.$('#text-prompt-dialog')), 'SM_TableManager opened: SM_Conveyor\'s edits kept for the build (not asked to discard them)');
  let tableLive = '';
  for (let i = 0; i < 40 && !tableLive; i++) { await sleep(300); tableLive = await a.$eval('#live-current-state', (e) => e.textContent).catch(() => ''); }
  await a.waitForSelector('#live-build-btn', { timeout: 10000 }).catch(() => {});
  await a.click('#live-build-btn').catch(() => {});
  await waitDone();
  const both = await a.$eval('#plc-build-dialog', (e) => e.innerText).catch(() => '');
  expect(/SM_Conveyor\.TcPOU/.test(both) && /SM_TableManager\.TcPOU/.test(both), `built together: ${(both.match(/these \d+ files as edited here: [^.]*\.[^.]*\.[^\n]*/) || [both.split("\n")[1]])[0]}`);
  await a.evaluate(() => document.querySelector('#plc-build-dialog button[title^="Close"]')?.click());
  await openFromPlc('conveyor');
  await a.click('#dock-tab-diagram').catch(() => {});
  await sleep(500);
  await openStateCode();
  const back = await a.$eval('#text-prompt-input', (e) => e.value).catch(() => '');
  await a.keyboard.press('Escape');
  expect(/\/\/ kept for the build/.test(back), 'SM_Conveyor again: its edit back');

  // (stopped: the target's fields back)
  await a.evaluate(() => document.querySelector('#plc-build-dialog button[title^="Close"]')?.click());
  await a.click('#dock-tab-live').catch(() => {});
  await a.click('#live-stop-btn').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await a.screenshot({ path: h.out('plc-build-stopped.png') }).catch(() => {});
  // The connection kept for the project (Plant): a POU of it without its own settings starts with it
  await set(a, 'live-port-input', '851');
  await new Promise((r) => setTimeout(r, 200));
  const ofProject = await a.evaluate(() => JSON.parse(localStorage.getItem('kss.live.project.Plant') || '{}'));
  expect(ofProject.netId === '127.0.0.1.1.1' && ofProject.ip === '127.0.0.1:48966' && ofProject.port === '851', `the project's connection: ${JSON.stringify(ofProject)}`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
