// A sub-machine's enum edited in its own .TcDUT (web edition): the K-Test Station POU dropped with its enum and
// Calibrate()'s (E_KTestStation_CalStates.TcDUT). A state of Calibrate() selected: the Enum Editor shows that enum,
// editable (no read-only note); an edit kept (Ctrl+S) counts as unsaved; Save writes that file (here: downloaded, the
// browser has no handle of it), the main enum not; one built from CASE labels (Measure()'s: no .TcDUT) stays read-only
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const CAL = 'KTESTSTATION_CALIBRATING__Calibrate__CAL_CHECK';
const MEAS = 'KTESTSTATION_CALIBRATING__Calibrate__CAL_MEASURE__Measure__MEAS_READ';
const CAL_DUT = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.12">
  <DUT Name="E_KTestStation_CalStates" Id="{6b1f2e3d-4c5a-4b6c-9d7e-8f9a0b1c2d3e}">
    <Declaration><![CDATA[TYPE E_KTestStation_CalStates :
(
	CAL_ZERO,
	CAL_MEASURE,
	CAL_CHECK,
	CAL_DONE
)INT;
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const downloads = path.join(h.OUT, 'sub-enum-downloads');
  fs.rmSync(downloads, { recursive: true, force: true });
  fs.mkdirSync(downloads, { recursive: true });
  await (await p.createCDPSession()).send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES.find((x) => x.id === 'k-test-station');
    return { pou: s.pouContent, pouName: s.pouName, dut: s.dutContent, dutName: s.dutName };
  });
  const waitFor = async (get, ok, ms = 10000) => {
    let v = await get();
    for (let t = 0; t < ms && !ok(v); t += 250) { await h.sleep(250); v = await get(); }
    return v;
  };

  // The POU dropped with both enums
  await p.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([f.content], f.name, { type: 'application/xml' }));
    document.getElementById('source-files-header').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [{ name: sample.pouName, content: sample.pou }, { name: sample.dutName, content: sample.dut }, { name: 'E_KTestStation_CalStates.TcDUT', content: CAL_DUT }]);
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${CAL}"]`, { timeout: 30000 }).catch(() => {});
  await h.sleep(800);

  // A state of Calibrate() selected: its enum, editable
  await p.click(`#state-list-item-${CAL}`);
  await p.click('#dock-tab-enum');
  const enumNow = () => p.evaluate(() => ({ text: document.getElementById('st-dut-editor')?.value ?? '', note: document.getElementById('enum-readonly-note')?.textContent ?? '' }));
  const e1 = await waitFor(enumNow, (x) => /E_KTestStation_CalStates/.test(x.text));
  expect(/E_KTestStation_CalStates/.test(e1.text) && !e1.note, `Calibrate()'s enum, from its .TcDUT: editable (note: "${e1.note}")`);

  // Hovering a member's line: its CASE branch, in Calibrate()
  const hoverTitle = await p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    const i = ta.value.split('\n').findIndex((l) => /^\s*CAL_CHECK\b/.test(l));
    const lh = parseFloat(getComputedStyle(ta).lineHeight);
    const r = ta.getBoundingClientRect();
    ta.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 30, clientY: r.top + 8 + (i + 0.5) * lh - ta.scrollTop }));
    return ta.title;
  });
  expect(/CAL_CHECK: its CASE branch/.test(hoverTitle) && /rMeasured >= 0\.0/.test(hoverTitle), `hovering CAL_CHECK: its branch in Calibrate() (${hoverTitle.split('\n').slice(0, 3).join(' / ')})`);

  // An edit: a new member after CAL_DONE; kept with Ctrl+S; unsaved; Save writes that file
  await p.evaluate(() => {
    const ta = document.getElementById('st-dut-editor');
    const i = ta.value.indexOf('CAL_DONE') + 'CAL_DONE'.length;
    ta.focus();
    ta.setSelectionRange(i, i);
  });
  await p.keyboard.type(',\n\tCAL_ABORTED');
  await h.sleep(300);
  await p.keyboard.down('Control'); await p.keyboard.press('KeyS'); await p.keyboard.up('Control');
  await h.sleep(800);
  const unsaved = await p.$eval('#header-save-btn', (b) => ({ on: !b.disabled, title: b.title })).catch(() => ({ on: false, title: '' }));
  expect(unsaved.on && /written/.test(unsaved.title), `kept: Save offered (${unsaved.title.slice(0, 90)})`);
  await p.click('#header-save-btn').catch(() => {});
  const files = await waitFor(() => fs.readdirSync(downloads).filter((f) => !/\.crdownload$/.test(f)), (x) => x.length > 0, 10000);
  const cal = files.find((f) => /CalStates/.test(f));
  const text = cal ? fs.readFileSync(path.join(downloads, cal), 'utf8') : '';
  expect(!!cal && /CAL_ABORTED/.test(text) && !files.some((f) => f === sample.dutName), `Save: Calibrate()'s enum written (${files.join(', ')}), the main one not`);
  const after = await waitFor(() => p.$eval('#header-save-btn', (b) => b.disabled).catch(() => false), (x) => x === true, 5000);
  expect(after === true, 'saved: nothing left to save (Save off)');

  // Measure()'s enum (no .TcDUT): from its CASE labels, read-only
  await p.click('#dock-tab-diagram');
  await p.click(`#state-list-item-${MEAS}`).catch(() => {});
  await p.click('#dock-tab-enum');
  const e2 = await waitFor(enumNow, (x) => /MEAS_READ/.test(x.text));
  expect(/MEAS_READ/.test(e2.text) && /read-only/.test(e2.note), `Measure()'s enum (no .TcDUT): read-only (${e2.note.slice(0, 80)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
