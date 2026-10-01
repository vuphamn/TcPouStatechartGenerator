// The Theme for the whole app: dark (Tailwind's palette as it is); default / base / neutral / forest: light (the
// panels, the editors, the header light, their text dark; forest's greys green-tinted); back to dark
const h = require('../lib/harness.cjs');
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
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(500);

  // The lightness (OKLab L, 0..1) of an element's background and text: the panels' and the editor's
  const look = () => p.evaluate(() => {
    const L = (css) => {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = css;
      c.fillRect(0, 0, 1, 1);
      const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      }
      return 'rgb(255,255,255)';
    };
    const card = document.querySelector('[id^="state-list-item-"]');
    const editor = document.getElementById('method-implementation-editor');
    return {
      theme: document.documentElement.getAttribute('data-app-theme'),
      card: card && { bg: L(bgOf(card)), text: L(getComputedStyle(card).color) },
      editor: editor && { bg: L(bgOf(editor)) },
      greenish: (() => { const m = getComputedStyle(document.documentElement).getPropertyValue('--color-slate-950').match(/oklch\([^)]*\s([\d.]+)\)/); return m ? Number(m[1]) : null; })(),
    };
  });

  const dark = await look();
  expect(dark.theme === null && dark.card.bg < 0.3 && dark.card.text > 0.6 && dark.editor.bg < 0.3, `dark: dark panels, light text (${JSON.stringify(dark)})`);
  for (const t of ['default', 'base', 'neutral', 'forest']) {
    await p.select('#mermaid-theme-select', t);
    await h.sleep(800);
    const l = await look();
    expect(l.theme === t && l.card.bg > 0.8 && l.card.text < 0.4 && l.editor.bg > 0.8, `${t}: light panels and editor, dark text (${JSON.stringify(l)})`);
    if (t === 'forest') expect(l.greenish === 155, `forest: its greys green (hue ${l.greenish})`);
  }
  await p.select('#mermaid-theme-select', 'dark');
  await h.sleep(800);
  const back = await look();
  expect(back.theme === null && back.card.bg < 0.3, 'dark again');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
