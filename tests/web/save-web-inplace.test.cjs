// Web edition, Chrome / Edge: a .TcPOU dropped with its file handle is saved in place (write access asked for once,
// its BOM kept); changed in the file meanwhile: asked before overwriting. (A fake handle stands in for the file.)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);

  // The POU dropped on the header, with a (fake) file handle
  const text = fs.readFileSync(path.join(h.FIXTURES, 'sample0', 'SM_TableManager.TcPOU'), 'utf8').replace(/^﻿/, '');
  await p.evaluate((text) => {
    window.__disk = '﻿' + text;
    window.__writes = 0;
    window.__asked = 0;
    const fake = {
      kind: 'file',
      name: 'SM_TableManager.TcPOU',
      async getFile() { return new File([window.__disk], 'SM_TableManager.TcPOU'); },
      async queryPermission() { return window.__perm || 'prompt'; },
      async requestPermission() { window.__asked++; window.__perm = 'granted'; return 'granted'; },
      async createWritable() {
        let buf = '';
        return { async write(d) { buf += typeof d === 'string' ? d : await d.text(); }, async close() { window.__disk = buf; window.__writes++; } };
      },
    };
    const file = new File([window.__disk], 'SM_TableManager.TcPOU');
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], items: [{ kind: 'file', getAsFile: () => file, getAsFileSystemHandle: async () => fake }] } });
    document.getElementById('source-files-header').dispatchEvent(ev);
  }, text);
  await h.sleep(2500);
  expect(/SM_TableManager/.test(await p.$eval('#status-file', (e) => e.textContent).catch(() => '')), 'the dropped POU is loaded');

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
  const disk = () => p.evaluate(() => ({ text: window.__disk, writes: window.__writes, asked: window.__asked }));
  await del(S('UNCLAMPING'));
  // (a doState() change: the POU; the sample's enum has no file here, it is not written)
  await p.evaluate(() => document.getElementById('save-sources-btn').click());
  await h.sleep(1500);
  let d = await disk();
  expect(d.writes >= 1 && d.asked === 1, `saved in place, write access asked once (${d.writes} write, asked ${d.asked})`);
  expect(d.text.startsWith('﻿') && !/TABLEMANAGER_UNCLAMPING\s*:/.test(d.text), 'the file: its BOM, the edit');

  // Changed in the file meanwhile: asked; Overwrite writes ours
  await p.evaluate(() => { window.__disk = window.__disk.replace('</TcPlcObject>', '<!-- saved in TwinCAT -->\r\n</TcPlcObject>'); });
  await del(S('HALT_FEED'));
  const before = (await disk()).writes;
  await p.evaluate(() => document.getElementById('save-sources-btn').click());
  await p.waitForSelector('#text-prompt-dialog', { timeout: 5000 }).catch(() => {});
  const ask = await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
  expect(/changed on disk/.test(ask) && /saved in TwinCAT/.test((await disk()).text), `changed meanwhile: asked, not written (${ask.split('\n')[0]})`);
  await p.click('#text-prompt-submit');
  await h.sleep(1500);
  d = await disk();
  expect(d.writes > before && !/saved in TwinCAT/.test(d.text) && !/TABLEMANAGER_HALT_FEED\s*:/.test(d.text) && d.asked === 1, 'Overwrite: our version, not asked for access again');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
