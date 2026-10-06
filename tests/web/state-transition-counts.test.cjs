// The Identified States list: each state's "in" and "out" count its transitions in the code, one per transition (two
// to the same state are two: EFX_IDLE's 3 out to 2 states read "2 out"), not the states they connect to; the badges'
// tooltips say how many states. Expected: the chart's generator on the same sample (each drawn edge's transitions)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// (the generator and the samples, bundled for node)
const entry = path.join(h.OUT, 'state-counts-entry.ts');
const bundle = path.join(h.OUT, 'state-counts-entry.cjs');
fs.writeFileSync(entry, `export { generateStatechartModel } from ${JSON.stringify(path.join(h.REPO, 'src', 'generator.ts').replace(/\\/g, '/'))};\nexport { SAMPLES } from ${JSON.stringify(path.join(h.REPO, 'src', 'samples', 'samplesData.ts').replace(/\\/g, '/'))};\n`);
require('esbuild').buildSync({ entryPoints: [entry], bundle: true, platform: 'node', outfile: bundle, logLevel: 'silent' });
const { generateStatechartModel, SAMPLES } = require(bundle);
const expected = (id) => {
  const s = SAMPLES.find((x) => x.id === id);
  const counts = {};
  const of = (k) => (counts[k] ??= { in: 0, out: 0, to: new Set() });
  for (const e of generateStatechartModel(s.dutContent, s.pouContent, {}).edges) {
    for (const t of e.members) {
      of(t.from).out++;
      of(t.from).to.add(t.to);
      of(t.to).in++;
    }
  }
  return counts;
};

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  for (const sample of ['table-manager-202', 'door-dasher-237']) {
    await p.select('#sample-selector', sample);
    await h.sleep(3000);
    const want = expected(sample);
    const rows = await p.evaluate(() =>
      [...document.querySelectorAll('[id$="-incoming-badge"]')].map((badge) => {
        const id = badge.id.replace(/^state-/, '').replace(/-incoming-badge$/, '');
        return { id, inn: parseInt(badge.textContent, 10), out: parseInt(document.getElementById(`state-${id}-outgoing-badge`)?.textContent ?? '', 10), title: badge.getAttribute('title') ?? '', outTitle: document.getElementById(`state-${id}-outgoing-badge`)?.getAttribute('title') ?? '' };
      })
    );
    const wrong = rows.filter((r) => r.inn !== (want[r.id]?.in ?? 0) || r.out !== (want[r.id]?.out ?? 0));
    expect(rows.length > 5 && wrong.length === 0, `${sample}: each state's in / out: its transitions (${rows.length} states${wrong.length ? `; not: ${wrong.slice(0, 4).map((r) => `${r.id} ${r.inn}/${r.out} vs ${want[r.id]?.in ?? 0}/${want[r.id]?.out ?? 0}`).join(', ')}` : ''})`);
    // (a state with more transitions out than states it goes to: counted as transitions, its tooltip says both)
    const multi = rows.find((r) => want[r.id] && want[r.id].out > want[r.id].to.size);
    if (multi) {
      const w = want[multi.id];
      expect(multi.out === w.out && new RegExp(`^${w.out} outgoing transitions to ${w.to.size} states?: `).test(multi.outTitle), `${sample}: ${multi.id}: "${multi.outTitle.slice(0, 70)}"`);
    }
  }
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
