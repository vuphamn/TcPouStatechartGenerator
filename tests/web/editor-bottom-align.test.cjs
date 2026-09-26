// Method Editor, POU Editor, Enum Editor: scrolled to the very bottom, the line numbers, the highlighting and the
// caret line band stay in step with the text (the textarea's horizontal scrollbar let it scroll further before)
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser();
  const page = await browser.newPage();
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });

  const check = (id) => page.evaluate((id) => {
    const ta = document.getElementById(id);
    const box = ta.closest('.relative.flex-1.min-h-0.flex');
    const gutter = box.firstElementChild;
    const pre = ta.previousElementSibling;
    const band = document.getElementById(`${id}-caret-line`);
    const row = gutter.querySelector('[data-caret-line]');
    return {
      scroll: [ta.scrollTop, pre.scrollTop, gutter.scrollTop].map(Math.round),
      atBottom: Math.abs(ta.scrollTop - (ta.scrollHeight - ta.clientHeight)) < 2,
      bandTop: band ? Math.round(band.getBoundingClientRect().top) : null,
      rowTop: row ? Math.round(row.getBoundingClientRect().top) : null,
      rowNumber: row ? row.textContent.trim() : null,
    };
  }, id);
  const scrollBottomAndClick = async (id) => {
    const at = await page.evaluate((id) => {
      const ta = document.getElementById(id);
      ta.scrollTop = ta.scrollHeight;
      ta.dispatchEvent(new Event('scroll'));
      const r = ta.getBoundingClientRect();
      return { x: r.x + 80, y: r.bottom - 40 };
    }, id);
    await h.sleep(200);
    await page.mouse.click(at.x, at.y);
    await h.sleep(250);
  };

  for (const [tab, id] of [['method', 'method-implementation-editor'], ['pou', 'pou-declaration-editor'], ['enum', 'st-dut-editor']]) {
    await page.click(`#dock-tab-${tab}`);
    await page.waitForSelector(`#${id}`, { timeout: 10000 });
    await h.sleep(600);
    for (const zoom of [1, 1.5]) {
      if (zoom !== 1) {
        await page.focus(`#${id}`);
        await page.keyboard.down('Control');
        for (let i = 0; i < 5; i++) {
          await page.keyboard.down('Shift');
          await page.keyboard.press('Period');
          await page.keyboard.up('Shift');
        }
        await page.keyboard.up('Control');
        await h.sleep(300);
      }
      await scrollBottomAndClick(id);
      const r = await check(id);
      const same = r.scroll[0] === r.scroll[1] && r.scroll[1] === r.scroll[2];
      expect(r.atBottom && same, `${tab} ${zoom * 100}%: at the bottom, text / highlighting / line numbers scrolled alike (${r.scroll.join(' / ')})`);
      expect(r.bandTop !== null && r.rowTop !== null && Math.abs(r.bandTop - r.rowTop) <= 1, `${tab} ${zoom * 100}%: the caret line's number (${r.rowNumber}) is level with its band (${r.rowTop} / ${r.bandTop})`);
    }
    // Back to 100% for the next editor
    await page.focus(`#${id}`);
    await page.keyboard.down('Control');
    await page.keyboard.press('Digit0');
    await page.keyboard.up('Control');
    await h.sleep(200);
  }
  await page.screenshot({ path: h.out('editor-bottom-align.png') });
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
