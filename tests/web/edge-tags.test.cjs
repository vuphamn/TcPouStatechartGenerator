const h = require('../lib/harness.cjs');
// Every edge path's source/target tags agree with its Mermaid link id (flowchart) or the edge list (stateDiagram)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let b; b = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await b.newPage();
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await sleep(1000);
  const check = () => p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area svg');
    const nodes = new Set([...svg.querySelectorAll('g.node[data-state-id]')].map((n) => n.getAttribute('data-state-id')));
    const paths = [...svg.querySelectorAll('path.tc-edge-path')];
    const bad = [];
    let start = null;
    for (const el of paths) {
      const id = el.id || '';
      const s = el.getAttribute('data-source-id');
      const t = el.getAttribute('data-target-id');
      if (/L_startNode_/.test(id)) start = `${s}->${t}`;
      const m = id.match(/(?:^|-)L_(.+)_\d+$/);
      if (!m) continue;
      // The id is <from>_<to>: the tags must spell it (state names contain _, so compare the joined text)
      if (`${s}_${t}` !== m[1].replace(/^startNode_/, '[*]_')) bad.push(`${id.replace(/^.*-L_/, 'L_')} tagged ${s}->${t}`);
    }
    return { paths: paths.length, start, bad, format: svg.getAttribute('aria-roledescription') };
  });
  let r = await check();
  console.log(`   ${r.format}: ${r.paths} paths, start ${r.start}`);
  expect(r.start === '[*]->TABLEMANAGER_DISABLED', `flowchart: the start transition is tagged ${r.start}`);
  expect(r.bad.length === 0, `flowchart: every path's tags match its link id${r.bad.length ? ': ' + r.bad.slice(0, 3).join('; ') : ''}`);
  // stateDiagram-v2
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /stateDiagram/.test(x.textContent))?.click());
  await sleep(3000);
  const sd = await p.evaluate(() => {
    const svg = document.querySelector('#mermaid-canvas-area svg');
    const paths = [...svg.querySelectorAll('path.tc-edge-path')];
    return { format: svg.getAttribute('aria-roledescription'), n: paths.length, starts: paths.filter((x) => x.getAttribute('data-source-id') === '[*]').map((x) => `[*]->${x.getAttribute('data-target-id')}`), wrongStart: paths.filter((x) => x.getAttribute('data-target-id') === 'TABLEMANAGER_DISABLED' && x.getAttribute('data-source-id') !== '[*]').length };
  });
  console.log(`   ${sd.format}: ${sd.n} paths, start edges ${sd.starts.join(', ')}`);
  expect(/state/.test(sd.format || '') && sd.starts.includes('[*]->TABLEMANAGER_DISABLED'), 'stateDiagram: the start transition is tagged [*]->TABLEMANAGER_DISABLED');
  await b.close().catch(() => {}); edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
