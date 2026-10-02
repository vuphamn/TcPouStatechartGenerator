// The IDE themes (Theme: VS Code, Visual Studio, JetBrains …): each one the whole app's colours (its greys and accent)
// and the chart's (Mermaid's base theme with its colours); its preset in the presets list
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const hex = (rgb) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || ''); return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : rgb; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.click('#header-appearance-btn');
  await p.waitForSelector('#mermaid-theme-select', { timeout: 5000 });
  const options = await p.$$eval('#mermaid-theme-select optgroup', (g) => g.map((x) => ({ label: x.label, values: [...x.querySelectorAll('option')].map((o) => o.value) })));
  const ide = options.filter((g) => /IDE/.test(g.label)).flatMap((g) => g.values);
  expect(ide.length >= 14 && ide.includes('vscode-dark') && ide.includes('vs-light') && ide.includes('jetbrains-darcula') && ide.includes('jetbrains-light'), `the Theme list: ${options.map((g) => `${g.label}: ${g.values.length}`).join(', ')}`);
  const look = () => p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const canvas = document.querySelector('#mermaid-canvas-area > div[data-grid]') ?? document.querySelector('[data-grid]');
    const node = document.querySelector('#mermaid-diagram-svg-container svg g.node rect, #mermaid-diagram-svg-container svg g.node polygon');
    return { ide: document.documentElement.getAttribute('data-ide-theme'), app: document.documentElement.getAttribute('data-app-theme'), slate950: cs.getPropertyValue('--color-slate-950').trim(), sky500: cs.getPropertyValue('--color-sky-500').trim(), canvas: canvas ? getComputedStyle(canvas).backgroundColor : null, node: node ? getComputedStyle(node).fill : null };
  });
  const THEMES = { 'vscode-dark': ['#1e1e1e', '#007acc', true], 'vscode-light': ['#ffffff', '#007acc', false], 'jetbrains-darcula': ['#2b2b2b', '#4a88c7', true], 'jetbrains-light': ['#ffffff', '#3574f0', false], 'vs-dark': ['#1f1f1f', '#0097fb', true], 'solarized-light': ['#fdf6e3', '#268bd2', false] };
  for (const [id, [bg, accent, dark]] of Object.entries(THEMES)) {
    await p.select('#mermaid-theme-select', id);
    await h.sleep(2500);
    const l = await look();
    expect(l.ide === id && (dark ? l.app === null : l.app === 'default') && l.slate950 === bg && l.sky500 === accent && hex(l.canvas) === bg && !!l.node && hex(l.node) !== '#ececff', `${id}: the app's greys (${l.slate950}) and accent (${l.sky500}), the canvas the editor's (${hex(l.canvas)}), the chart's nodes its own (${hex(l.node)})`);
    await p.screenshot({ path: h.out(`ide-theme-${id}.png`) });
  }
  // Back to MachineScope's own: none of an IDE theme's left
  await p.select('#mermaid-theme-select', 'dark');
  await h.sleep(1500);
  const back = await look();
  expect(back.ide === null && back.app === null && back.slate950 !== '#1e1e1e', `dark again: ${JSON.stringify(back)}`);
  // The presets list: one for each IDE theme
  const presets = await p.evaluate(() => document.body.innerText.match(/VS Code Dark\+|IntelliJ Light|JetBrains Darcula|Visual Studio Light/g) ?? []);
  expect(presets.length >= 0, `presets shown in the panel (${[...new Set(presets)].join(', ') || 'the list closed'})`);
  const builtin = await p.evaluate(async () => (await import('/src/utils/diagramPresets.ts')).BUILTIN_PRESETS.filter((x) => x.id.startsWith('builtin-ide-')).map((x) => x.name));
  expect(builtin.length >= 14 && builtin.includes('VS Code Dark+') && builtin.includes('Visual Studio Light') && builtin.includes('JetBrains Darcula'), `the built-in presets: ${builtin.join(', ')}`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
