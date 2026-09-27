const h = require('../lib/harness.cjs');
// The app's extras (XAE stand-in bridge): a path check kept from a live session and broken by an edit (Problems);
// Compare recordings; the state times as CSV (saveDocument); Review and save (the diagrams side by side); a replay's
// variable charts; the PLC switcher's reachability (probePlcs); the update banner (GitHub's releases answered here)
const fs = require('fs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const sent = [];
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  // GitHub's releases: a newer XAE release
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    if (/api\.github\.com\/repos\/.*\/releases/.test(r.url())) {
      return r.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([
        { tag_name: 'desktop-v9.9.9', name: 'Desktop edition 9.9.9', html_url: 'https://example.invalid/d', draft: false, prerelease: false },
        { tag_name: 'xae-v0.9.4', name: 'XAE edition 0.9.4', html_url: 'https://example.invalid/xae-0.9.4', draft: false, prerelease: false },
        { tag_name: 'xae-v0.9.10', name: 'XAE edition 0.9.10', html_url: 'https://example.invalid/xae-0.9.10', draft: false, prerelease: false },
      ]) });
    }
    r.continue();
  });
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const lv = await import('/src/utils/liveView.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent, values: Object.fromEntries([...lv.enumValueMap(s.dutContent)].map(([v, n]) => [n, v])) };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  const docs = [];
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\\\proj\\\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\\\proj\\\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'liveStart') await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
    else if (m.type === 'saveDocument') {
      docs.push(m);
      await toApp({ type: 'saveDocumentResult', path: `C:\\\\out\\\\${m.name}` });
    } else if (m.type === 'hostInfo') await toApp({ type: 'hostInfo', edition: 'xae', version: '0.9.2' });
    else if (m.type === 'probePlcs') await toApp({ type: 'probeResult', requestId: m.requestId, reachable: Object.fromEntries(m.targets.map((t) => [t.key, t.key === '5.1.2.3.1.1'])) });
    else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
  });
  await p.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kss.live.plcs', JSON.stringify([
      { name: 'Line A', netId: '5.1.2.3.1.1', ip: '', port: '', localNetId: '', used: 2 },
      { name: 'Line B', netId: '5.9.9.9.1.1', ip: '', port: '', localNetId: '', used: 1 },
    ]));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S('HOMMING')}"]`, { timeout: 60000 });
  await h.sleep(800);

  // The update banner (a quiet check a few seconds after start): 0.9.10 is newer than 0.9.2 (and than 0.9.4)
  await p.waitForSelector('#update-banner', { timeout: 15000 }).catch(() => {});
  const banner = await p.$eval('#update-banner', (e) => e.textContent).catch(() => '');
  expect(/for XAE 0\.9\.10 is available \(this is 0\.9\.2\)/.test(banner) && (await p.$eval('#update-open', (a) => a.getAttribute('href')).catch(() => '')) === 'https://example.invalid/xae-0.9.10', `update banner: ${banner}`);
  await p.evaluate(() => [...document.querySelectorAll('#update-banner button')].find((b) => /Later/.test(b.textContent))?.click());

  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(600);
  // Reachability in the PLC switcher
  await p.waitForFunction(() => /● Line A/.test(document.getElementById('live-plc-quick')?.innerText || ''), { timeout: 8000 }).catch(() => {});
  const quick = await p.$eval('#live-plc-quick', (e) => e.innerText).catch(() => '');
  expect(/● Line A/.test(quick) && /○ Line B \(not answering\)/.test(quick), `reachability: ${quick.replace(/\n/g, ' | ')}`);

  // Live, then a path check kept
  await p.click('#live-start-btn');
  await h.sleep(600);
  const t0 = Date.UTC(2026, 8, 20, 22, 0, 0);
  // (transitions the diagram has)
  const seq = ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED', 'REFEED_START'];
  await toApp({ type: 'liveValues', events: seq.map((s, i) => ({ t: t0 + i * 10000, value: sample.values[S(s)] })) });
  await h.sleep(800);
  await p.click('#live-keep-path');
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-input', { clickCount: 3 });
  await p.type('#text-prompt-input', 'Refeed cycle');
  await p.keyboard.press('Enter');
  await h.sleep(500);
  const check = await p.$eval('.live-path-check', (e) => ({ ok: e.getAttribute('data-ok'), text: e.textContent })).catch(() => null);
  expect(check?.ok === 'true' && /Refeed cycle/.test(check.text) && /3 transitions/.test(check.text), `path check kept: ${check?.text}`);

  // The state times as CSV
  await p.click('#live-state-times-csv');
  for (let i = 0; i < 20 && !docs.length; i++) await h.sleep(150);
  expect(/^state-times-SM_TableManager-.*\.csv$/.test(docs[0]?.name ?? '') && /^state,stays,average ms/.test(docs[0]?.content ?? '') && /TABLEMANAGER_CLAMPED,1,/.test(docs[0].content), `state times CSV: ${docs[0]?.name}`);

  // Save recording (for Compare), stop
  await p.click('#live-save-recording');
  for (let i = 0; i < 20 && docs.length < 2; i++) await h.sleep(150);
  const recA = docs[1] ? JSON.parse(docs[1].content) : null;
  await p.click('#live-stop-btn');
  await h.sleep(400);

  // Delete CLAMPED -> REFEED_START: the path check breaks (Problems)
  await p.evaluate(() => document.getElementById('dock-tab-diagram')?.click());
  await h.sleep(600);
  const key = `${S('CLAMPED')}->${S('REFEED_START')}`;
  const ep = await p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    if (!el) return null;
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.3, 0.4, 0.5, 0.6, 0.7, 0.2, 0.8]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
    }
    return null;
  }, key);
  if (ep) {
    await p.mouse.click(ep.x, ep.y, { button: 'right' });
    await h.sleep(400);
    await p.evaluate(() => document.getElementById('context-menu-delete-transition-btn')?.click());
    await p.waitForSelector('#text-prompt-dialog', { timeout: 3000 }).catch(() => {});
    await p.keyboard.press('Enter');
    await h.sleep(1500);
    await p.evaluate(() => document.getElementById('dock-tab-problems')?.click());
    await h.sleep(600);
    const problems = await p.evaluate(() => document.body.innerText);
    expect(/Recorded path broken/.test(problems) && /"Refeed cycle": TABLEMANAGER_CLAMPED → TABLEMANAGER_REFEED_START is no longer in the diagram/.test(problems), 'the edit breaks the path check: in Problems');
    await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
    await h.sleep(400);
    expect((await p.$eval('.live-path-check', (e) => e.getAttribute('data-ok')).catch(() => '')) === 'false', 'and in the Live tab: ✗');

    // Review and save: the two diagrams, the change listed
    await p.click('#save-sources-menu-btn');
    await p.waitForSelector('#dock-menu-review-save', { timeout: 3000 }).catch(() => {});
    await p.click('#dock-menu-review-save');
    await p.waitForSelector('#review-dialog', { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => document.querySelectorAll('#review-before svg, #review-after svg').length === 2, { timeout: 15000 }).catch(() => {});
    const list = await p.$eval('#review-list', (e) => e.innerText).catch(() => '');
    expect((await p.$$('#review-before svg, #review-after svg')).length === 2 && /− TABLEMANAGER_CLAMPED → TABLEMANAGER_REFEED_START/.test(list), `Review and save: both diagrams, the change: ${list.split('\n')[0]}`);
    await p.screenshot({ path: h.out('review-save.png') });
    await p.click('#review-save');
    await h.sleep(800);
    expect(sent.some((m) => m.type === 'save') || !!(await p.$('#text-prompt-dialog')), 'Save from the review');
    await p.keyboard.press('Escape');
    await h.sleep(300);
  } else expect(false, 'the CLAMPED -> REFEED_START edge on the canvas');

  // Compare: this session (A) against a recording with a slower CLAMPED (B)
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(300);
  const recB = JSON.parse(JSON.stringify(recA));
  recB.values = recB.values.map((v, i) => ({ ...v, t: v.t + (i >= 3 ? 30000 : 0) }));
  const fileB = h.out('compare-b.kssrec.json');
  fs.writeFileSync(fileB, JSON.stringify(recB));
  await p.click('#live-compare');
  await p.waitForSelector('#compare-dialog', { timeout: 3000 }).catch(() => {});
  await (await p.$('#compare-file-b')).uploadFile(fileB);
  await p.waitForSelector('.compare-row', { timeout: 5000 }).catch(() => {});
  const rows = await p.$$eval('.compare-row', (r) => r.map((x) => `${x.getAttribute('data-state')}=${x.querySelector('.compare-change').textContent}`));
  expect(rows[0] === `${S('CLAMPED')}=+300%` && rows.includes(`${S('CLAMPPING')}=0%`), `Compare: ${rows.join(' ')}`);
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.getElementById('compare-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await h.sleep(300);

  // A replay with recorded variables: their charts under the slider
  const recV = { ...recA, vars: [{ id: 'cmd_bhome', t: t0, v: false }, { id: 'cmd_bhome', t: t0 + 15000, v: true }, { id: 'fspeed', t: t0, v: 1.5 }, { id: 'fspeed', t: t0 + 30000, v: 2.5 }], watched: { cmd_bhome: { symbol: `${I}.cmd_bHome`, type: 'BOOL' }, fspeed: { symbol: `${I}.fSpeed`, type: 'REAL' } } };
  const fileV = h.out('vars.kssrec.json');
  fs.writeFileSync(fileV, JSON.stringify(recV));
  await (await p.$('#live-open-recording')).uploadFile(fileV);
  await p.waitForSelector('#live-replay-vars', { timeout: 5000 }).catch(() => {});
  const vars = await p.$$eval('.live-replay-var', (r) => r.map((x) => x.getAttribute('data-var')));
  expect(vars.join() === 'cmd_bhome,fspeed' && (await p.$$('#live-replay-vars svg path')).length === 2, `replay variable charts: ${vars.join(', ')}`);
  await p.screenshot({ path: h.out('replay-vars.png') });
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
