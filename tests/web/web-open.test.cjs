// Opening a .TcPOU in the web edition. Browse, the browser refusing to read the file picked (NotAllowedError, as when
// its file access is blocked for the page): its read permission asked for; refused, it says what to do and the next
// Browse opens the plain file chooser (it loads). Dropped on the Function Block box: a .TcPOU with its .TcDUT, its enum
// loaded too; a .TcPOU alone: loaded, and how to give its enum (Find .TcDUT… offered)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES.find((x) => x.id === 'k-analog-measure');
    return { pou: s.pouContent, pouName: s.pouName, dut: s.dutContent, dutName: s.dutName };
  });
  const text = () => p.evaluate(() => document.body.innerText);
  const fileName = () => p.$eval('#tcpou-file-name', (e) => e.textContent).catch(() => '');
  const waitFor = async (get, ok, ms = 8000) => {
    let v = await get();
    for (let t = 0; t < ms && !ok(v); t += 250) { await h.sleep(250); v = await get(); }
    return v;
  };

  // 1. Browse: the browser refuses to read the file picked
  await p.evaluate(() => {
    window.__permissionAsked = 0;
    window.showOpenFilePicker = async () => [{
      kind: 'file',
      name: 'Refused.TcPOU',
      getFile: async () => { throw new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError'); },
      requestPermission: async () => { window.__permissionAsked++; return 'denied'; },
    }];
  });
  await p.click('#tcpou-choose-file-btn');
  const said = await waitFor(text, (t) => /refused to read the file you picked/.test(t));
  const asked = await p.evaluate(() => window.__permissionAsked);
  expect(/refused to read the file you picked/.test(said) && /Click Browse again/.test(said) && asked === 1, `refused: its permission asked for (${asked}), then it says what to do`);
  expect((await p.evaluate(() => localStorage.getItem('kss.web.plainPicker'))) === '1', 'the plain file chooser from then on (kept in this browser)');

  // 2. Browse again: the plain file chooser, the .TcPOU loads
  const pouFile = path.join(h.OUT, sample.pouName);
  fs.writeFileSync(pouFile, sample.pou);
  const [chooser] = await Promise.all([p.waitForFileChooser({ timeout: 8000 }).catch(() => null), p.click('#tcpou-choose-file-btn')]);
  expect(!!chooser, 'Browse again: the plain file chooser');
  if (chooser) await chooser.accept([pouFile]);
  const loaded = await waitFor(fileName, (n) => n.includes(sample.pouName.replace(/\.TcPOU$/i, '')));
  expect(loaded.includes(sample.pouName.replace(/\.TcPOU$/i, '')), `it loads (${loaded})`);

  // 3. Dropped: a .TcPOU and its .TcDUT together: both loaded
  const drop = (files) => p.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([f.content], f.name, { type: 'application/xml' }));
    document.getElementById('source-files-header').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
  await p.evaluate(() => localStorage.removeItem('kss.web.plainPicker'));
  await p.select('#sample-selector', 'table-manager-202').catch(() => {});
  await h.sleep(1500);
  await drop([{ name: sample.pouName, content: sample.pou }, { name: sample.dutName, content: sample.dut }]);
  await waitFor(fileName, (n) => n.includes(sample.pouName.replace(/\.TcPOU$/i, '')));
  const both = await waitFor(() => p.evaluate(() => ({ find: !!document.getElementById('tcdut-find-btn'), body: document.body.innerText })), (x) => !x.find && x.body.includes('E_KAnalogMeasure'));
  const nodes = await waitFor(() => p.$$eval('#mermaid-canvas-area g.node[data-state-id^="KANALOGMEASURE_"]', (e) => e.length).catch(() => 0), (n) => n > 3, 15000);
  expect(!both.find && nodes > 3, `a .TcPOU dropped with its .TcDUT: its enum loaded too, its chart drawn (Find .TcDUT… offered: ${both.find}; ${nodes} states)`);

  // 4. A .TcPOU alone: loaded; how to give its enum
  await p.select('#sample-selector', 'table-manager-202').catch(() => {});
  await h.sleep(1500);
  await drop([{ name: sample.pouName, content: sample.pou }]);
  const hint = await waitFor(text, (t) => /Its enum: drop its \.TcDUT too/.test(t));
  const find = await p.$('#tcdut-find-btn');
  expect(/Its enum: drop its \.TcDUT too, or the folder it is in/.test(hint) && !!find, `a .TcPOU alone: it says how to give its enum, Find .TcDUT… offered (${!!find})`);

  // 5. Inside another app (VS Code's built-in browser shows the page in a frame): Browse opens the plain file chooser
  // at once (its file access would be refused), and the file loads
  const q = await browser.newPage();
  q.on('pageerror', (e) => errors.push(e.message));
  await q.setContent(`<iframe id="app" src="${h.APP_URL}" style="width:1580px;height:980px;border:0"></iframe>`);
  const frameOf = () => q.frames().find((f) => f !== q.mainFrame());
  let frame = null;
  for (let t = 0; t < 60000 && !(frame && (await frame.$('#mermaid-canvas-area g.node').catch(() => null))); t += 500) {
    await h.sleep(500);
    frame = frameOf();
  }
  expect(!!frame && (await frame.evaluate(() => window.self !== window.top)), 'the app shown in a frame');
  if (frame) {
    const [chooser2] = await Promise.all([q.waitForFileChooser({ timeout: 8000 }).catch(() => null), frame.click('#tcpou-choose-file-btn')]);
    expect(!!chooser2, 'in a frame: Browse opens the plain file chooser at once (no refusal first)');
    if (chooser2) await chooser2.accept([pouFile]);
    const inFrame = await waitFor(() => frame.$eval('#tcpou-file-name', (e) => e.textContent).catch(() => ''), (n) => n.includes(sample.pouName.replace(/\.TcPOU$/i, '')));
    expect(inFrame.includes(sample.pouName.replace(/\.TcPOU$/i, '')) && !/refused to read/.test(await frame.evaluate(() => document.body.innerText)), `in a frame: it loads (${inFrame})`);
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
