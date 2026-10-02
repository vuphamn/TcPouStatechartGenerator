const h = require('../lib/harness.cjs');
// The Live tab's Check, through Link (web edition), against a simulated PLC and TwinCAT search: each step shown; a
// wrong AMS NetId found (the PLC's own offered, one click), then ADS answers; a PLC that is not there: its steps fail
// and the verdict says what to do; Add Route both ways (TwinCAT on this computer too: its router's NetId, faked)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-check.json');

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48972', cfg], { stdio: 'ignore' });
  const finderOut = path.join(h.OUT, 'fake-discovery-check.txt');
  const finder = spawn(process.execPath, [path.join(h.FAKES, 'fake-discovery.cjs'), '48973'], { stdio: ['ignore', fs.openSync(finderOut, 'w'), 'ignore'] });
  const linkOut = path.join(h.OUT, 'link-check-run.txt');
  const out = fs.openSync(linkOut, 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48974'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-check-appdata'), KSS_DISCOVERY_PORT: '48973', KSS_DISCOVERY_BROADCAST: '0', KSS_LOCAL_TWINCAT_NETID: '10.1.2.3.1.1' }, stdio: ['ignore', out, out] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await set(a, 'live-link-port-input', '48974');
  // (a NetId that is not the PLC's)
  await set(a, 'live-netid-input', '10.9.9.9.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48972');
  const check = async () => {
    await a.click('#live-plc-check');
    await a.waitForSelector('#live-check-panel[data-state="done"]', { timeout: 30000 }).catch(() => {});
    return a.evaluate(() => ({
      steps: [...document.querySelectorAll('#live-check-panel .live-check-step')].map((s) => `${s.getAttribute('data-step')}:${s.getAttribute('data-ok')}`),
      text: document.getElementById('live-check-panel')?.innerText ?? '',
      verdict: document.getElementById('live-check-verdict')?.textContent ?? '',
      fix: document.getElementById('live-check-fix')?.textContent ?? '',
    }));
  };

  // 1. The wrong NetId: found, the PLC's own offered
  let r = await check();
  expect(r.steps.includes('search:true') && r.steps.includes('port:true') && r.steps.includes('netid:false') && /CX-<b>202<\/b>/.test(r.text), `steps: ${r.steps.join(' ')} (the name shown as text)`);
  expect(/does not match: 127\.0\.0\.1 is 127\.0\.0\.1\.1\.1, not 10\.9\.9\.9\.1\.1/.test(r.verdict) && /Use 127\.0\.0\.1\.1\.1/.test(r.fix), `verdict: "${r.verdict.slice(0, 90)}", ${r.fix}`);
  await a.screenshot({ path: h.out('live-check.png') });
  // Copy: the check as text (the clipboard taken over here: a headless browser has none to read)
  await a.evaluate(() => { window.__copied = ''; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }; });
  await a.click('#live-check-copy');
  await sleep(200);
  const copied = await a.evaluate(() => window.__copied);
  expect(/^Kval MachineScope connection check: 10\.9\.9\.9\.1\.1 at 127\.0\.0\.1:48972/.test(copied) && /\[X\]  The AMS NetId does not match/.test(copied) && /=> The AMS NetId does not match/.test(copied), `Copy: the check as text (${copied.split('\n').length} lines)`);
  await a.click('#live-check-fix');
  await sleep(300);
  const target = await a.$eval('#live-netid-input', (e) => e.value);
  expect(target === '127.0.0.1.1.1' && !(await a.$('#live-check-panel')), `Use: the Target is ${target}`);

  // (Link from these sources: the same code as the page, no notice)
  expect(!(await a.$('#live-link-outdated')), 'Link is the same version as the page: no notice');
  // 2. Checked again: ADS answers
  r = await check();
  expect(!r.steps.some((s) => s.endsWith(':false')) && r.steps.includes('ads:true') && /All good: go live/.test(r.verdict), `again: ${r.steps.join(' ')}; "${r.verdict}"`);

  // 3. Nothing there: the port closed, the search unanswered; the verdict says what to do
  await set(a, 'live-ip-input', '127.0.0.1:48979');
  r = await check();
  expect(r.steps.includes('port:false') && /ADS port is closed/.test(r.verdict) && /TCP 48898 allowed in/.test(r.verdict), `a closed port: ${r.steps.join(' ')}; "${r.verdict.slice(0, 80)}"`);
  expect(/check: .* checked 127\.0\.0\.1:48979/.test(fs.readFileSync(linkOut, 'utf8')), 'Link logs the check');

  // 4. Add Route both ways: on the PLC for this PC's TwinCAT router, and in that router for the PLC (this PC's user)
  await a.click('#live-plc-browse');
  await a.waitForSelector('#live-plc-browser');
  // (the search it starts with first: then the address asked)
  await a.waitForSelector('#live-plc-none', { timeout: 8000 }).catch(() => {});
  await a.type('#live-plc-addresses', '127.0.0.1');
  await a.click('#live-plc-rescan');
  await a.waitForFunction(() => document.querySelectorAll('.live-plc-found').length >= 2, { timeout: 8000 }).catch(() => {});
  await a.click('.live-plc-add-route[data-netid="127.0.0.2.1.1"]');
  await a.waitForSelector('#live-route-password');
  const both = await a.$eval('#live-route-both', (e) => e.checked).catch(() => null);
  await a.type('#live-route-password', '1');
  const waitsForLocal = await a.$eval('#live-route-add', (e) => e.disabled);
  await a.type('#live-route-local-user', 'Administrator');
  await a.type('#live-route-local-password', '1');
  await a.click('#live-route-add');
  await a.waitForFunction(() => /Added both ways|refused|not/.test(document.getElementById('live-route-result')?.textContent || ''), { timeout: 8000 }).catch(() => {});
  const added = await a.$eval('#live-route-result', (e) => e.textContent).catch(() => '');
  const log = fs.readFileSync(finderOut, 'utf8');
  expect(both === true && waitsForLocal && /Added both ways/.test(added), `TwinCAT here: both ways offered (${both}), waits for this PC's user (${waitsForLocal}): "${added.slice(0, 90)}"`);
  expect(/add route ".*" to 10\.1\.2\.3\.1\.1 at [\d.]+: added/.test(log) && /add route "CX-203" to 127\.0\.0\.2\.1\.1 at 127\.0\.0\.1: added/.test(log), `the two requests: on the PLC for this PC's router, here for the PLC (${log.split('\n').filter((l) => /add route/.test(l)).join(' | ')})`);

  // Remembered with what Browse found: picked, Remember; searched again: its TwinCAT and when it was seen shown
  await a.click('.live-plc-found[data-netid="127.0.0.2.1.1"]');
  await sleep(300);
  await a.click('#live-plc-remember').catch(() => {});
  await sleep(300);
  await a.click('#live-plc-browse');
  await a.waitForSelector('#live-plc-browser');
  await a.waitForSelector('.live-plc-remembered[data-netid="127.0.0.2.1.1"] .live-plc-remembered-seen', { timeout: 8000 }).catch(() => {});
  const seenText = await a.$eval('.live-plc-remembered[data-netid="127.0.0.2.1.1"] .live-plc-remembered-seen', (e) => e.textContent).catch(() => '');
  // (kept in this browser: the remembered list's entry for it)
  const stored = await a.evaluate(() => Object.values(localStorage).some((v) => { try { const l = JSON.parse(v); return Array.isArray(l) && l.some((p) => p?.netId === '127.0.0.2.1.1' && p.twincat === '3.1.4024' && typeof p.seen === 'number'); } catch { return false; } }));
  expect(/TC 3\.1\.4024 · seen \d/.test(seenText) && stored, `remembered with what Browse found: "${seenText}" (kept: ${stored})`);
  // Check all: each remembered PLC checked, a mark on its row, the verdict on it
  await a.click('#live-plc-check-all').catch(() => {});
  await a.waitForFunction(() => { const m = document.querySelector('.live-plc-remembered[data-netid="127.0.0.2.1.1"] .live-plc-check-mark'); return m && m.getAttribute('data-ok') !== 'running'; }, { timeout: 20000 }).catch(() => {});
  const mark = await a.$eval('.live-plc-remembered[data-netid="127.0.0.2.1.1"] .live-plc-check-mark', (e) => e.getAttribute('data-ok') + '|' + e.getAttribute('title')).catch(() => '');
  expect(/^(true|false)\|.+/.test(mark), `Check all: the remembered PLC's mark and verdict ("${mark.slice(0, 90)}")`);
  await a.click('#live-plc-browser-close').catch(() => {});

  // 5. A Link of another version (its stamp not this page's): the Live tab says so
  const otherOut = path.join(h.OUT, 'link-check-other.txt');
  const other = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48975'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-check-appdata'), KSS_LINK_STAMP: 'aaaaaaaaaaaa', KSS_DISCOVERY_PORT: '48973', KSS_DISCOVERY_BROADCAST: '0' }, stdio: ['ignore', fs.openSync(otherOut, 'w'), 'ignore'] });
  await h.waitForText(otherOut, /Pairing code:/);
  await a.click('#live-plc-browser-close').catch(() => {});
  await set(a, 'live-link-port-input', '48975');
  await a.click('#live-plc-check');
  await a.waitForSelector('#live-link-outdated', { timeout: 15000 }).catch(() => {});
  const notice = await a.$eval('#live-link-outdated', (e) => e.textContent).catch(() => '');
  expect(/another version than this page/.test(notice) && /code aaaaaaaaaaaa/.test(notice) && /npm run build:link/.test(notice), `another Link: "${notice.slice(0, 110)}"`);
  other.kill();

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  link.kill();
  plc.kill();
  finder.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
