// The web edition's layout file (File System Access; the folder picker stood in by a folder in memory): kept in this
// browser at first; the status bar's menu: Keep it beside the POU, a folder chosen; one without the POU refused; the
// POU's folder: SM_TableManager.machinescope.json written there a moment after a state is dragged; changed there (git),
// read again
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.evaluateOnNewDocument(() => {
    // (a folder in memory: its files' texts; the picker answers the folder named in window.__pick)
    const folder = (name, files) => ({
      kind: 'directory',
      name,
      async *values() {
        for (const n of Object.keys(files)) yield { kind: 'file', name: n };
      },
      async resolve() {
        return null;
      },
      async queryPermission() {
        return 'granted';
      },
      async requestPermission() {
        return 'granted';
      },
      async getDirectoryHandle() {
        throw new DOMException('none', 'NotFoundError');
      },
      async removeEntry(n) {
        delete files[n];
      },
      async getFileHandle(n, opts) {
        if (!(n in files) && !opts?.create) throw new DOMException('none', 'NotFoundError');
        if (!(n in files)) files[n] = '';
        return {
          kind: 'file',
          name: n,
          async getFile() {
            return new File([files[n]], n);
          },
          async createWritable() {
            let text = '';
            return { async write(t) { text += t; }, async close() { files[n] = text; window.__writes = (window.__writes || 0) + 1; } };
          },
        };
      },
    });
    window.__folders = { other: {}, proj: { 'SM_TableManager.TcPOU': '<POU/>' } };
    window.showDirectoryPicker = async () => folder(window.__pick, window.__folders[window.__pick]);
  });
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  const S = 'TABLEMANAGER_HOMMING';
  await page.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S}"]`, { timeout: 60000 });
  await sleep(2000);
  await page.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  const status = () => page.evaluate(() => { const e = document.getElementById('status-layout'); return e ? { state: e.getAttribute('data-state'), text: e.textContent.trim() } : null; });
  const file = () => page.evaluate(() => window.__folders.proj['SM_TableManager.machinescope.json'] ?? null);
  const pick = async (name) => {
    await page.evaluate((n) => { window.__pick = n; }, name);
    await page.click('#status-layout');
    await page.waitForSelector('#status-layout-pick', { timeout: 3000 });
    await page.click('#status-layout-pick');
    await sleep(1200);
  };

  let st = await status();
  expect(st?.state === 'browser', `at first: this browser (${JSON.stringify(st)})`);

  // A folder without the POU: refused, said
  await pick('other');
  const said = await page.evaluate(() => document.getElementById('status-message')?.textContent ?? '');
  st = await status();
  expect(st?.state === 'browser' && /not in other/.test(said), `a folder without the POU: refused (${said.trim()})`);

  // The POU's folder: kept there
  await pick('proj');
  for (let i = 0; i < 20 && (await status())?.state === 'browser'; i++) await sleep(250);
  st = await status();
  expect(st?.state === 'new' && /SM_TableManager\.machinescope\.json/.test(st.text), `the POU's folder: kept there, none yet (${JSON.stringify(st)})`);

  // A state dragged: written there
  await page.evaluate((s) => document.getElementById(`btn-goto-state-${s}`)?.click(), S);
  await sleep(1500);
  const box = await page.evaluate((s) => { const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`); const r = (n?.querySelector('rect, path') ?? n)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, S);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 8 * i, box.y + 5 * i);
  await page.mouse.up();
  let text = null;
  for (let i = 0; i < 20 && !text; i++) { await sleep(250); text = await file(); }
  const j = text ? JSON.parse(text) : null;
  expect(!!j?.states?.[S] && j.pou === 'SM_TableManager.TcPOU' && !!j.places?.[S], `written beside the POU: ${text ? text.slice(0, 160).replace(/\s+/g, ' ') : 'nothing'}`);
  st = await status();
  expect(st?.state === 'saved', `the status bar: saved (${JSON.stringify(st)})`);

  // Changed there (a git pull): read again
  const inDrawing = (id) => page.evaluate((id) => { const svg = document.querySelector('#mermaid-diagram-svg-container svg'); const n = svg?.querySelector(`g.node[data-state-id="${id}"]`); const root = svg?.querySelector('g'); if (!n || !root) return null; const m = root.getCTM().inverse().multiply(n.getCTM()); return [m.e, m.f]; }, id);
  const at = await inDrawing(S);
  await page.evaluate((s) => { const f = JSON.parse(window.__folders.proj['SM_TableManager.machinescope.json']); f.states[s].y += 90; window.__folders.proj['SM_TableManager.machinescope.json'] = JSON.stringify(f, null, 2) + '\n'; }, S);
  let now = at;
  for (let i = 0; i < 30 && now && Math.abs(now[1] - at[1] - 90) > 3; i++) { await sleep(250); now = await inDrawing(S); }
  expect(!!now && Math.abs(now[1] - at[1] - 90) <= 3, `changed in the folder: read again (${at?.map(Math.round)} → ${now?.map(Math.round)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
