// Web edition: Save downloads the edited .TcPOU / .TcDUT when the browser has no file to write back (a sample), with a
// BOM; the ▾ menu downloads either; unsaved edits: asked before another sample replaces them, and before a reload
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const downloads = h.out('save-web-downloads');
  fs.rmSync(downloads, { recursive: true, force: true });
  fs.mkdirSync(downloads, { recursive: true });
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  let stay = true;
  p.on('dialog', async (d) => {
    dialogs.push(d.type());
    if (stay) await d.dismiss();
    else await d.accept();
  });
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(1000);
  const saveBtn = () => p.$eval('#save-sources-btn', (e) => ({ text: e.textContent.trim(), disabled: e.disabled })).catch(() => null);
  const del = async (state) => {
    await p.evaluate((s) => [...document.getElementById(`state-list-item-${s}`).querySelectorAll('button')].find((x) => /Go to State/.test(x.textContent))?.click(), state);
    await h.sleep(1200);
    const pt = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, state);
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(400);
    await p.keyboard.press('Delete');
    await p.waitForSelector('#text-prompt-submit', { timeout: 5000 });
    await p.click('#text-prompt-submit');
    await h.sleep(1500);
  };
  const waitFile = async (name) => { for (let i = 0; i < 40; i++) { const f = path.join(downloads, name); if (fs.existsSync(f) && fs.statSync(f).size > 0) return f; await h.sleep(250); } return null; };

  expect((await saveBtn())?.disabled, 'Save: nothing to save');
  await del(S('UNCLAMPING'));
  expect(/Save \(2\)/.test((await saveBtn())?.text ?? ''), `after an edit: ${(await saveBtn())?.text}`);
  // A sample: no file to write back: downloaded
  await p.click('#save-sources-btn');
  const pouFile = await waitFile('SM_TableManager.TcPOU');
  const dutFile = await waitFile('E_TableManager_States.TcDUT');
  expect(!!pouFile && !!dutFile, `both downloaded: ${fs.readdirSync(downloads).join(', ')}`);
  if (pouFile && dutFile) {
    const raw = fs.readFileSync(pouFile);
    expect(raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && !/TABLEMANAGER_UNCLAMPING\s*:/.test(raw.toString('utf8')), 'the .TcPOU: a BOM, the edit');
    expect(!/TABLEMANAGER_UNCLAMPING\b/.test(fs.readFileSync(dutFile, 'utf8')), 'the .TcDUT: the edit');
  }
  expect((await saveBtn())?.disabled, 'then nothing to save');
  // The ▾ menu: Download either
  await p.click('#save-sources-menu-btn');
  await h.sleep(300);
  const items = await p.$$eval('#save-sources-menu button', (e) => e.map((x) => x.textContent.trim()));
  expect(items.includes('Download SM_TableManager.TcPOU') && items.includes('Download E_TableManager_States.TcDUT'), `the menu: ${items.join(' | ')}`);
  await p.keyboard.press('Escape');

  // Unsaved edits, then another sample: asked; Cancel keeps them
  await del(S('RESET_DONE'));
  const other = await p.evaluate(() => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /Door Dasher/.test(o.text)));
    if (!sel) return false;
    const opt = [...sel.options].find((o) => /Door Dasher/.test(o.text));
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  await h.sleep(600);
  const ask = await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
  expect(other && /unsaved edits/.test(ask), `another sample: asked (${ask.split('\n')[0]})`);
  await p.keyboard.press('Escape');
  await h.sleep(600);
  expect(/SM_TableManager/.test(await p.$eval('#status-file', (e) => e.textContent).catch(() => '')) && /Save \(2\)/.test((await saveBtn())?.text ?? ''), 'Cancel: the edits kept');

  // A reload: the browser asks (beforeunload); staying keeps them
  await p.reload({ waitUntil: 'load', timeout: 5000 }).catch(() => {});
  await h.sleep(800);
  expect(dialogs.includes('beforeunload') && /Save \(2\)/.test((await saveBtn())?.text ?? ''), `a reload: the browser asks first (${dialogs.join(', ')}); stayed`);
  stay = false;
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
