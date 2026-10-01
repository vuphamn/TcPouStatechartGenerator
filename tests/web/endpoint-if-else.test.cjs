// A transition in an IF / ELSE (Table Manager: HALT_FEED → IDLE_FEED_OFF, "IF cmd_eFeedMode = FEEDMODE_OFF … ELSE →
// AUTOFEED_IDLE", inside "IF NOT(smFeedMotor.status_bMoving)"): its start endpoint dragged onto HOMMING_READY_TO_START
// moves it there as an IF of its own, the ELSE left in HALT_FEED as IF NOT (…); a state's Copy state name: its name only
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const FROM = 'TABLEMANAGER_HALT_FEED';
const TO = 'TABLEMANAGER_IDLE_FEED_OFF';
const NEW = 'TABLEMANAGER_HOMMING_READY_TO_START';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => void d.accept().catch(() => {}));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${NEW}"]`, { timeout: 60000 });
  await h.sleep(2500);

  // Copy state name (a state's right-click menu): the name, not its description
  await p.evaluate(() => {
    window.__copied = [];
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void window.__copied.push(t) } });
    } catch {
      // (the fallback's execCommand is watched below)
    }
    const exec = document.execCommand.bind(document);
    document.execCommand = (cmd, ...rest) => {
      if (cmd === 'copy') window.__copied.push(document.activeElement?.value ?? window.getSelection()?.toString() ?? '');
      return exec(cmd, ...rest);
    };
  });
  const at = await p.evaluate((s) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, FROM);
  await p.mouse.click(at.x, at.y, { button: 'right' });
  await p.waitForSelector('#context-menu-copy-btn', { timeout: 3000 }).catch(() => {});
  await p.click('#context-menu-copy-btn').catch(() => {});
  await h.sleep(500);
  const copied = await p.evaluate(() => window.__copied);
  expect(copied.length > 0 && copied.every((t) => t === 'TABLEMANAGER_HALT_FEED'), `Copy state name: ${JSON.stringify(copied)}`);
  await p.keyboard.press('Escape');
  await h.sleep(800);

  // The transition selected, its start handle dragged onto HOMMING_READY_TO_START
  const key = `${FROM}->${TO}`;
  const pt = await p.evaluate((key) => {
    for (const el of document.querySelectorAll(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`)) {
      const len = el.getTotalLength(); const m = el.getScreenCTM();
      for (const f of [0.3, 0.5, 0.7, 0.2, 0.8]) {
        const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
        if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
      }
    }
    return null;
  }, key);
  expect(!!pt, `the transition ${key} on the canvas`);
  if (pt) {
    await p.mouse.click(pt.x, pt.y);
    await h.sleep(800);
    const hd = await p.evaluate(() => {
      const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="start"]')].find((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); return e && x.contains(e); });
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    const tgt = await p.evaluate((s) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${s}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, NEW);
    expect(!!hd, 'its start handle');
    if (hd) {
      await p.mouse.move(hd.x, hd.y);
      await p.mouse.down();
      for (let i = 1; i <= 20; i++) await p.mouse.move(hd.x + ((tgt.x - hd.x) * i) / 20, hd.y + ((tgt.y - hd.y) * i) / 20);
      await h.sleep(200);
      const drop = await p.evaluate(() => document.querySelector('.edge-drop-target')?.getAttribute('data-state-id'));
      await p.mouse.up();
      await h.sleep(1800);
      expect(drop === NEW, `dragged onto ${NEW} (${drop})`);
    }
  }
  const status = await p.$eval('#status-message', (e) => e.textContent).catch(() => '');
  expect(/ELSE stays in TABLEMANAGER_HALT_FEED as IF NOT/.test(status), `moved, the ELSE kept: ${status}`);
  const keys = await p.evaluate(() => [...new Set([...document.querySelectorAll('#mermaid-canvas-area path.tc-edge-path')].map((x) => x.getAttribute('data-edge-key')))]);
  expect(keys.includes(`${NEW}->${TO}`) && !keys.includes(key) && keys.includes(`${FROM}->TABLEMANAGER_AUTOFEED_IDLE`), `the chart: ${keys.filter((k) => /HALT_FEED|IDLE_FEED_OFF/.test(k)).join(', ')}`);
  await p.click('#dock-tab-method');
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 });
  await h.sleep(600);
  const code = await p.$eval('#method-implementation-editor', (t) => t.value);
  const halt = code.slice(code.indexOf(`${FROM}:`), code.indexOf(`${TO}:`));
  expect(/IF NOT\(smFeedMotor\.status_bMoving\)\s*THEN\s*IF NOT \(\(cmd_eFeedMode = FEEDMODE_OFF\)\) THEN\s*machineState := TABLEMANAGER_AUTOFEED_IDLE;\s*END_IF\s*END_IF/.test(halt), `HALT_FEED keeps its ELSE as IF NOT (…): ${halt.replace(/\s+/g, ' ').slice(0, 260)}`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
