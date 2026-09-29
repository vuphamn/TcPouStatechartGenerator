const h = require('../lib/harness.cjs');
// Web edition through Link: Build from the TwinCAT project's folder (a POU not from the PLC). The folder the page is
// granted is a stand-in in the page (the File System Access API's handles, in memory): its files sent to Link (the
// second build sends none again), built there (Link's stand-in compiler, KSS_BUILD_DRYRUN), then written (online
// change): the new compile information written into the folder; the PLC (in Stop) not back in Run: Start the PLC,
// after its confirmation
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
// (the PLC's application in Stop: a write does not bring it back to Run by itself)
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-projbuild.json', [], { adsState: 6 });

// The granted folder, in the page: { name, files: { path: text } }; window.__fakeFs: what was written, the reads
function fakeFolder(tree) {
  const now = Date.now() - 60000;
  const files = new Map(Object.entries(tree.files).map(([p, text]) => [p, { text, mtime: now }]));
  window.__fakeFs = { written: {}, reads: 0 };
  const file = (p) => ({
    kind: 'file',
    name: p.split('/').pop(),
    async getFile() {
      window.__fakeFs.reads++;
      const f = files.get(p);
      return new File([f.text], p.split('/').pop(), { lastModified: f.mtime });
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async createWritable() {
      const parts = [];
      return {
        async write(d) { parts.push(typeof d === 'string' ? d : await new Response(d).text()); },
        async close() { const text = parts.join(''); files.set(p, { text, mtime: Date.now() }); window.__fakeFs.written[p] = text; },
      };
    },
  });
  const dir = (prefix, name) => ({
    kind: 'directory',
    name,
    async *values() {
      const seen = new Set();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length).split('/');
        if (seen.has(rest[0])) continue;
        seen.add(rest[0]);
        yield rest.length === 1 ? file(prefix + rest[0]) : dir(`${prefix}${rest[0]}/`, rest[0]);
      }
    },
    async getDirectoryHandle(n) { return dir(`${prefix}${n}/`, n); },
    async getFileHandle(n, o) {
      if (!files.has(prefix + n) && !o?.create) throw new DOMException('not found', 'NotFoundError');
      if (!files.has(prefix + n)) files.set(prefix + n, { text: '', mtime: Date.now() });
      return file(prefix + n);
    },
    async resolve() { return null; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => dir('', tree.name);
}

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48990', cfg], { stdio: ['ignore', fs.openSync(path.join(h.OUT, 'fake-ams2-projbuild.txt'), 'w'), 'ignore'] });
  const linkOut = path.join(h.OUT, 'link-projbuild-run.txt');
  const out = fs.openSync(linkOut, 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48991'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-projbuild-appdata'), KSS_BUILD_DRYRUN: '1', KSS_BUILD_RUN_WAIT_MS: '1500' }, stdio: ['ignore', out, out] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = async (p, id, v) => {
    await p.waitForSelector(`#${id}`, { timeout: 10000 }).catch(() => {});
    return p.evaluate((id, v) => { const el = document.getElementById(id); if (!el) throw new Error(`no #${id}`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  };
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  const pou = '<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject><POU Name="SM_TableManager"><Declaration><![CDATA[FUNCTION_BLOCK SM_TableManager]]></Declaration></POU></TcPlcObject>';
  await a.evaluateOnNewDocument(fakeFolder, {
    name: 'Plant',
    files: {
      'Plant.tsproj': '<TcSmProject/>',
      'Plant/Plant.plcproj': '<Project/>',
      'Plant/POUs/SM_TableManager.TcPOU': pou,
      'Plant/POUs/E_TableManager_States.TcDUT': '<TcPlcObject><DUT Name="E_TableManager_States"/></TcPlcObject>',
      'Plant/_CompileInfo/Old.compileinfo': 'old',
      '.git/HEAD': 'ref: refs/heads/main',
    },
  });
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.evaluate(() => localStorage.clear());
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await set(a, 'live-link-port-input', '48991');
  await set(a, 'live-netid-input', '127.0.0.1.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48990');
  await set(a, 'live-instance-input', 'MAIN.mainStateMachine.smTable1');
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-build-btn', { timeout: 20000 }).catch(() => {});
  expect(!!(await a.$('#live-build-btn')), 'live through Link, a POU not from the PLC: Build offered');

  const status = () => a.$eval('#plc-build-status', (e) => ({ phase: e.getAttribute('data-phase'), ok: e.getAttribute('data-ok'), text: e.textContent.trim() })).catch(() => ({ phase: '', ok: '', text: '' }));
  const waitDone = async () => { let s = await status(); for (let i = 0; i < 150 && s.phase !== 'done'; i++) { await sleep(200); s = await status(); } return s; };

  // 1. Built: the folder sent to Link, the stand-in's warning
  await a.click('#live-build-btn');
  await a.waitForSelector('#plc-build-dialog', { timeout: 5000 }).catch(() => {});
  let s = await waitDone();
  const intro = await a.$eval('#plc-build-dialog', (e) => e.innerText).catch(() => '');
  const log = () => fs.readFileSync(linkOut, 'utf8');
  expect(s.ok === 'true' && /Built: no errors, 1 warning/.test(s.text) && /Your TwinCAT project \(a copy of its folder, sent to Link\)/.test(intro) && /builds its project folder \(2 edited file\(s\)\)/.test(log()), `built from the folder: "${s.text}"`);
  await a.screenshot({ path: h.out('project-build-link.png') });

  // 2. Built again: the folder listed, nothing sent again (its files unchanged)
  const reads = await a.evaluate(() => window.__fakeFs.reads);
  await a.click('#plc-build-again');
  s = await waitDone();
  const readsAgain = (await a.evaluate(() => window.__fakeFs.reads)) - reads;
  expect(s.ok === 'true' && readsAgain === 5, `built again: ${readsAgain} files listed, none sent again ("${s.text}")`);

  // 3. Written (online change): the new compile information into the folder, the PLC in Run
  await a.click('#plc-build-online');
  await a.click('#plc-build-safe');
  await a.click('#plc-build-confirm-btn');
  s = await waitDone();
  const written = await a.evaluate(() => window.__fakeFs.written);
  const info = Object.keys(written).filter((p) => /^Plant\/_CompileInfo\/StandIn-\d+\.compileinfo$/.test(p));
  const run = await a.$eval('#plc-build-run', (e) => e.getAttribute('data-ok')).catch(() => '');
  expect(s.ok === 'true' && /Written to the PLC \(online change\)/.test(s.text) && info.length === 1 && written[info[0]] === 'stand-in' && run === 'false', `written: "${s.text.slice(0, 60)}"; into the folder: ${Object.keys(written).join(', ')}`);
  expect(!Object.keys(written).some((p) => /Old\.compileinfo|\.git/.test(p)), 'only the new compile information written (.git not sent, the old one left)');
  // The PLC not back in Run: Start the PLC, off until its box is ticked, then started (the fake PLC's state set)
  await a.click('#plc-build-start');
  const startOff = await a.$eval('#plc-build-start-confirm', (e) => e.disabled).catch(() => null);
  await a.click('#plc-build-start-safe');
  await a.click('#plc-build-start-confirm');
  await a.waitForSelector('#plc-build-start-result', { timeout: 15000 }).catch(() => {});
  const started = await a.$eval('#plc-build-start-result', (e) => e.getAttribute('data-ok') + '|' + e.textContent).catch(() => '');
  expect(startOff === true && /^true\|Started: the PLC runs/.test(started) && /plc: .* starts the PLC application/.test(fs.readFileSync(linkOut, 'utf8')), `Start the PLC: off until confirmed (${startOff}), then "${started}"`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
