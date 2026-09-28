// Web edition: renaming an input of the POU also renames its uses in the project's other POUs. The project folder
// is asked for once (Chrome / Edge's folder access, stood in for here), its POUs that use the name are read, listed
// in the preview and written back (each only if it did not change since it was read)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const MENU = '[aria-label="Editor Context Menu"]';
const cdata = (s) => `<![CDATA[${s}]]>`;
const LINE = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="PRG_Line" Id="{9}" SpecialFunc="None">\n    <Declaration>${cdata('PROGRAM PRG_Line\nVAR\n\tsmTable : SM_TableManager;\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('smTable.cmd_bUnclamp := bButton;\nsmTable();')}</ST>\n    </Implementation>\n  </POU>\n</TcPlcObject>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // The folder picker: a project folder with PRG_Line.TcPOU (and a POU that does not use the name)
  await p.evaluateOnNewDocument((line) => {
    window.__written = {};
    window.__picked = 0;
    const file = (name, text) => {
      let content = text;
      return {
        kind: 'file',
        name,
        getFile: async () => new File([content], name),
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable: async () => ({ write: async (d) => { window.__written[name] = d; content = d; }, close: async () => {} }),
      };
    };
    const pous = { 'PRG_Line.TcPOU': file('PRG_Line.TcPOU', line), 'FB_Other.TcPOU': file('FB_Other.TcPOU', '<TcPlcObject><POU Name="FB_Other"><Declaration><![CDATA[FUNCTION_BLOCK FB_Other]]></Declaration></POU></TcPlcObject>') };
    const dir = (name, entries) => ({ kind: 'directory', name, values: async function* () { yield* entries; }, getDirectoryHandle: async () => { throw new Error('none'); }, resolve: async () => null });
    const pouDir = dir('POUs', Object.values(pous));
    window.showDirectoryPicker = async () => {
      window.__picked++;
      return dir('Commander', [pouDir]);
    };
  }, LINE);
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1000);

  // Rename cmd_bUnclamp (a VAR_INPUT of the sample) from the POU Editor
  await p.click('#dock-tab-pou');
  await p.waitForSelector('#pou-declaration-editor', { timeout: 10000 });
  let open = false;
  for (let i = 0; i < 4 && !open; i++) {
    await h.sleep(400);
    await p.evaluate(() => {
      const ta = document.getElementById('pou-declaration-editor');
      const at = ta.value.indexOf('cmd_bUnclamp') + 2;
      ta.focus();
      ta.setSelectionRange(at, at);
      ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 }));
    });
    await h.sleep(300);
    open = !!(await p.$(MENU));
  }
  expect(open && !!(await p.$('#editor-menu-rename')), 'the menu on cmd_bUnclamp: Rename…');
  await p.click('#editor-menu-rename');
  await p.waitForSelector('#text-prompt-input', { timeout: 4000 });
  await p.evaluate(() => { const el = document.getElementById('text-prompt-input'); el.focus(); el.select(); });
  await p.keyboard.type('cmd_bRelease', { delay: 5 });
  let preview = '';
  for (let i = 0; i < 20 && !/PRG_Line\.TcPOU/.test(preview); i++) {
    await h.sleep(200);
    preview = await p.$eval('#text-prompt-preview', (e) => e.innerText).catch(() => '');
  }
  expect((await p.evaluate(() => window.__picked)) === 1 && /PRG_Line\.TcPOU \(written at once\):/.test(preview) && /smTable\.cmd_bRelease := bButton;/.test(preview) && !/FB_Other/.test(preview), `the project folder asked for once; the preview lists PRG_Line: ${preview.split('\n').filter((l) => /PRG_Line|smTable/.test(l)).join(' / ')}`);
  await p.keyboard.press('Enter');
  await h.sleep(1500);
  const written = await p.evaluate(() => window.__written);
  expect(Object.keys(written).join() === 'PRG_Line.TcPOU' && /smTable\.cmd_bRelease := bButton;/.test(written['PRG_Line.TcPOU'] ?? ''), `PRG_Line.TcPOU written back with the new name (${Object.keys(written).join(', ') || 'nothing'})`);
  expect(/cmd_bRelease/.test(await p.$eval('#pou-declaration-editor', (e) => e.value)), 'and the POU itself renamed');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
