// The web edition, another company's POU browsed (POUs/FB_ScanSequencer.TcPOU), its enum in DUTs/ beside POUs/ (not in
// the .TcPOU's folder): Find .TcDUT… given the project folder finds it there by the state variable's type
// (E_ScanState.TcDUT), once the .TcPOU's own folder has none
const h = require('../lib/harness.cjs');
const path = require('path');
const { fakeFolder } = require('../lib/fake-folder.cjs');
const { pou, dut } = require(path.join(h.REPO, 'tests', 'fixtures', 'third-party-pou.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.evaluateOnNewDocument(fakeFolder, { name: 'EFX_Robot', files: { 'POUs/FB_ScanSequencer.TcPOU': pou, 'DUTs/E_ScanState.TcDUT': dut, 'DUTs/E_Other.TcDUT': "TYPE E_Other :\n(\n\tA,\n\tB\n);\nEND_TYPE\n" } });
  // (the picked .TcPOU: its handle, in POUs/ of the folder granted later)
  await p.evaluateOnNewDocument(() => {
    const pick = window.showDirectoryPicker;
    window.showDirectoryPicker = async () => {
      const root = await pick();
      root.resolve = async (h) => (h && h.name === 'FB_ScanSequencer.TcPOU' ? ['POUs', 'FB_ScanSequencer.TcPOU'] : null);
      return root;
    };
    window.showOpenFilePicker = async () => [await (await (await pick()).getDirectoryHandle('POUs')).getFileHandle('FB_ScanSequencer.TcPOU')];
  });
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);

  // Browse: the .TcPOU only (no folder yet): its enum still to find
  await p.click('#tcpou-choose-file-btn');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="FastScan"]', { timeout: 20000 }).catch(() => {});
  await p.waitForSelector('#tcdut-find-btn', { timeout: 10000 }).catch(() => {});
  const before = await p.evaluate(() => ({ name: document.getElementById('tcpou-file-name')?.textContent?.trim() ?? '', find: !!document.getElementById('tcdut-find-btn') }));
  expect(/FB_ScanSequencer/.test(before.name) && before.find, `browsed: FB_ScanSequencer, Find .TcDUT… offered (${JSON.stringify(before)})`);

  // Find .TcDUT…: the project folder granted; POUs/ has no .TcDUT, its enum found in DUTs/ by type
  await p.click('#tcdut-find-btn').catch(() => {});
  const header = async () => p.evaluate(() => document.getElementById('source-files-header')?.innerText ?? '');
  let text = await header();
  for (let i = 0; i < 30 && !/E_ScanState/.test(text); i++) { await h.sleep(250); text = await header(); }
  const reads = await p.evaluate(() => document.body.innerText.match(/[^\n]*was not found[^\n]*/)?.[0] ?? '');
  expect(/E_ScanState/.test(text) && !/Find \.TcDUT/.test(text) && !reads, `its enum found in DUTs/ (header: ${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 160))}${reads ? `; ${reads}` : ''})`);
  // (its states: the enum's, in Identified States)
  const states = await p.$$eval('[id^="state-list-item-"]', (els) => els.map((e) => e.id.replace('state-list-item-', '')));
  expect(['InitializeScan', 'FastScan', 'ComputeResult'].every((s) => states.includes(s)), `its states (${states.join(', ')})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
