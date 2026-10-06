// The README's demo scenes: each prepared (the page loaded and settled, not recorded) and played (recorded). The
// first sample (SM_TableManager) throughout; the live scene feeds the app a PLC's values through the XAE bridge's
// messages (a stand-in: no PLC), as the tests do.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = (n) => `TABLEMANAGER_${n}`;
const MIME = 'application/x-kss-statechart-element';

/** The web edition with the first sample, this browser's storage cleared, the chart drawn */
async function openSample(page, url, { sidebar = false, rightPanel = true, before } = {}) {
  if (before) await before();
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 90000 });
  await sleep(2500);
  // (the minimap: closed, it covers the chart's corner at this size)
  await page.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
  page.__panels = { sidebar, rightPanel };
  await sleep(600);
}

/**
 * A state brought to the middle of the canvas, readable (prepare: not recorded): Go to State (the sidebar's), the
 * side panels as the scene wants them, zoomed in at it (the wheel), dragged to the middle (the empty canvas pans)
 */
async function focus(page, id, { notches = 6, dx = 0, dy = 0, center } = {}) {
  // (Go to State is the sidebar's: shown for it)
  await setPanels(page, { sidebar: true });
  await page.evaluate((id) => document.getElementById(`btn-goto-state-${id}`)?.click(), id);
  await sleep(1500);
  const { sidebar = false, rightPanel = true } = page.__panels ?? {};
  await setPanels(page, { sidebar, rightPanel });
  await sleep(1200);
  let st = await stateAt(page, id);
  if (!st) return;
  await page.mouse.move(st.x, st.y);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel({ deltaY: -120 });
    await sleep(120);
  }
  await sleep(800);
  for (let k = 0; k < 3; k++) {
    // (what goes to the middle: the state, or a point the scene gives, a transition's middle)
    st = center ? await center() : await stateAt(page, id);
    if (!st) break;
    const area = await page.evaluate(() => { const r = document.getElementById('mermaid-canvas-area').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const want = { x: area.x + dx, y: area.y + dy };
    const delta = { x: want.x - st.x, y: want.y - st.y };
    if (Math.hypot(delta.x, delta.y) < 8) break;
    const from = await emptyNear(page, area.x - delta.x / 2, area.y - delta.y / 2);
    if (!from) break;
    const step = { x: Math.max(-500, Math.min(500, delta.x)), y: Math.max(-300, Math.min(300, delta.y)) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + (step.x * i) / 12, from.y + (step.y * i) / 12);
    await page.mouse.up();
    await sleep(500);
  }
  // (the right panel kept on the scene's tab: not brought to the selected state's documentation)
  if (await page.$eval('#status-follow-selection', (e) => e.checked).catch(() => false)) await page.click('#status-follow-selection');
  // (a click on the empty canvas: nothing selected)
  await page.keyboard.press('Escape');
  await sleep(400);
}

/** The side panels shown or hidden (their buttons say which they are: Hide / Show) */
async function setPanels(page, want) {
  for (const [key, id] of [['sidebar', '#toggle-sidebar-btn'], ['rightPanel', '#toggle-right-panel-btn']]) {
    if (want[key] === undefined) continue;
    const shown = await page.$eval(id, (e) => /^Hide/.test(e.getAttribute('title') || '')).catch(() => null);
    if (shown !== null && shown !== want[key]) {
      await page.click(id);
      await sleep(700);
    }
  }
}

/** A state's box on screen (its center, size) */
const stateAt = (page, id) =>
  page.evaluate((id) => {
    const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
    const r = (n?.querySelector('rect, path, polygon, circle') ?? n)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, id);

/** The canvas centred on a state: the canvas' search (its name, Enter), cleared after */
async function goTo(page, id) {
  await page.click('#diagram-search-input', { clickCount: 3 });
  await page.keyboard.type(id);
  await sleep(1600);
  await page.click('#diagram-search-input', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await sleep(400);
}

/** A point on a transition's line on screen (a fraction along it, the first spot there that is its line), its id */
const edgeAt = (page, from, to, fractions = [0.5, 0.4, 0.6, 0.3, 0.7]) =>
  page.evaluate((from, to, fractions) => {
    const p = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-source-id="${from}"][data-target-id="${to}"]:not(.tc-edge-hitbox)`);
    if (!p) return null;
    const m = p.getScreenCTM();
    const key = p.getAttribute('data-path-id');
    for (const f of fractions) {
      const q = p.getPointAtLength(p.getTotalLength() * f);
      const at = new DOMPoint(q.x, q.y).matrixTransform(m);
      const hit = document.elementFromPoint(at.x, at.y);
      if (hit?.getAttribute('data-path-id') === key || hit?.closest?.(`[data-path-id="${key}"]`)) return { x: at.x, y: at.y, key };
    }
    const q = p.getPointAtLength(p.getTotalLength() * fractions[0]);
    const at = new DOMPoint(q.x, q.y).matrixTransform(m);
    return { x: at.x, y: at.y, key };
  }, from, to, fractions);

/** Zoomed in (or out: negative) around a point, a wheel notch at a time */
async function zoomAt(page, d, x, y, notches) {
  await d.move(x, y, 400);
  for (let i = 0; i < Math.abs(notches); i++) {
    await page.mouse.wheel({ deltaY: notches > 0 ? -120 : 120 });
    await sleep(110);
  }
  await sleep(600);
}
/** Zoomed in quietly (prepare): the zoom-in button n times */
async function zoomIn(page, n) {
  for (let i = 0; i < n; i++) {
    await page.click('#zoom-in-button');
    await sleep(120);
  }
  await sleep(500);
}
const zoomLabel = (page) => page.$eval('#zoom-label-button', (e) => e.textContent.trim()).catch(() => '');

/** An empty spot of the canvas near a point (no state, line, label or composite around it) */
const emptyNear = (page, x0, y0) =>
  page.evaluate((x0, y0) => {
    const area = document.getElementById('mermaid-canvas-area');
    const r = area.getBoundingClientRect();
    const free = (x, y) =>
      [[0, 0], [60, 0], [-60, 0], [0, 25], [0, -25], [60, 25], [-60, -25], [60, -25], [-60, 25]].every(([dx, dy]) => {
        const e = document.elementFromPoint(x + dx, y + dy);
        return e && area.contains(e) && !e.closest('g.node, g.edgeLabel, g.edgePaths, path, #statechart-palette, button, [role="dialog"]');
      });
    for (let rad = 0; rad < 400; rad += 20)
      for (let a = 0; a < 360; a += 30) {
        const x = x0 + rad * Math.cos((a * Math.PI) / 180);
        const y = y0 + rad * Math.sin((a * Math.PI) / 180);
        if (x > r.left + 110 && x < r.right - 40 && y > r.top + 30 && y < r.bottom - 40 && free(x, y)) return { x, y };
      }
    return null;
  }, x0, y0);

/** A tab opened (scrolled into its bar's view first: the right panel's bar has more tabs than room) */
const tab = async (page, d, id) => {
  await page.evaluate((id) => document.getElementById(`dock-tab-${id}`)?.scrollIntoView({ inline: 'center', block: 'nearest' }), id);
  await sleep(300);
  const at = await d.at(`#dock-tab-${id}`);
  const vw = await page.evaluate(() => innerWidth);
  if (at && at.x > 0 && at.x < vw) await d.click(at.x, at.y, { after: 700 });
  else {
    await page.evaluate((id) => document.getElementById(`dock-tab-${id}`)?.click(), id);
    await sleep(700);
  }
};

module.exports = {
  // 1. The chart from the code: zoom, a state's code, a transition's guard
  overview: {
    async prepare(page, d, url) {
      await openSample(page, url, { rightPanel: false });
      await setPanels(page, { sidebar: false, rightPanel: false });
      await sleep(1000);
      // (the whole chart fitted)
      await page.click('#zoom-reset-button').catch(() => {});
      await sleep(1200);
    },
    async play(page, d) {
      await d.caption('A TwinCAT state machine (<b>SM_*.TcPOU</b> and its enum) drawn as a statechart', 2600);
      let st = await stateAt(page, S('HOMMING'));
      await d.caption('Zoom and pan anywhere: wheel, drag, minimap, search', 200);
      await zoomAt(page, d, st.x, st.y, 14);
      st = await stateAt(page, S('HOMMING'));
      await d.caption('Click a state: its transitions light up; hover it: its code', 300);
      await d.click(st.x, st.y, { after: 2800 });
      const e = await edgeAt(page, S('HOMMING'), S('IDLE_FEED_OFF'));
      if (e) {
        await d.caption('Hover a transition: its guard, as written in doState()', 200);
        await d.move(e.x, e.y, 700);
        await sleep(3000);
      }
      await d.move(st.x - 260, st.y - 160, 500);
      await d.caption('Two layouts (ELK, Dagre), flowchart or stateDiagram-v2, themes, export as SVG / PNG / Mermaid', 2800);
    },
  },

  // 2. Editing from the chart: a transition's end moved to another state (the code follows), a state added
  edit: {
    async prepare(page, d, url) {
      await openSample(page, url, { rightPanel: false });
      await focus(page, S('AUTOFEED_START_DOOR_IN'), { notches: 10, dy: -150 });
    },
    async play(page, d) {
      const e = await edgeAt(page, S('AUTOFEED_START_DOOR_IN'), S('AUTOFEED_INSTOP'), [0.75, 0.8, 0.7, 0.6]);
      await d.caption('Edit the state machine from the chart: select a transition…', 300);
      await d.click(e.x, e.y, { after: 900 });
      const hd = await page.evaluate(() => {
        const el = [...document.querySelectorAll('#mermaid-canvas-area .tc-edge-handle[data-handle-type="end"]')].find((x) => {
          const q = x.getBoundingClientRect();
          const h = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
          return h && x.contains(h);
        });
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      const target = S('AUTOFEED_INSTOP_HALT');
      const to = await stateAt(page, target);
      if (hd && to) {
        await d.caption('…and drag its end onto another state', 200);
        await d.drag(hd.x, hd.y, to.x - to.w / 4, to.y, 1400);
        await sleep(1600);
        await d.caption(`The code follows: <b>machineState := ${target}</b> in doState()`, 300);
        const moved = await edgeAt(page, S('AUTOFEED_START_DOOR_IN'), target, [0.6, 0.5, 0.7, 0.4]);
        if (moved) {
          await d.click(moved.x, moved.y, { button: 'right', after: 900 });
          await d.clickOn('#context-menu-goto-code-btn', { after: 2400 });
          d.mark('code');
          await sleep(800);
        }
        await d.caption('Every edit is one <b>Ctrl+Z</b> away', 300);
        await tab(page, d, 'diagram');
        await page.keyboard.down('Control');
        await page.keyboard.press('z');
        await page.keyboard.up('Control');
        await sleep(2000);
      }
      // A state from the palette
      const near = await stateAt(page, S('AUTOFEED_START_DOOR_IN'));
      const spot = near ? await emptyNear(page, near.x + 260, near.y - 60) : null;
      const pal = await d.at('#palette-state');
      if (spot) {
        await d.caption('Drag a <b>State</b> from the palette: added to the enum and to doState()', 200);
        if (pal) await d.cursorTo(pal.x, pal.y, 500);
        await sleep(300);
        await d.cursorTo(spot.x, spot.y, 900);
        await page.evaluate((x, y, MIME) => {
          const dt = new DataTransfer();
          dt.setData(MIME, 'state');
          const el = document.elementFromPoint(x, y);
          for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
        }, spot.x, spot.y, MIME);
        const prompt = await page.waitForSelector('#text-prompt-input', { timeout: 5000 }).catch(() => null);
        if (prompt) {
          await page.evaluate(() => document.getElementById('text-prompt-input').select());
          await sleep(300);
          await d.type('TABLEMANAGER_WAIT_DOOR');
          await sleep(500);
          await page.keyboard.press('Enter');
          await sleep(2600);
          d.mark('added');
          console.log('dropped at', Math.round(spot.x), Math.round(spot.y), 'new state at', JSON.stringify(await stateAt(page, 'TABLEMANAGER_WAIT_DOOR')));
        }
      }
      await d.caption('Transitions, choices, composites, fork / join: drawn here, written as Structured Text', 2800);
    },
  },

  // 3. One transition laid out again, nothing else moved
  relayout: {
    async prepare(page, d, url) {
      await openSample(page, url, { rightPanel: false });
      await focus(page, S('HOMMING_READY_TO_START'), { notches: 10, center: () => edgeAt(page, S('HOMMING_READY_TO_START'), S('ERROR'), [0.5]) });
    },
    async play(page, d) {
      await d.caption('A transition with too many turns…', 1500);
      const e = await edgeAt(page, S('HOMMING_READY_TO_START'), S('ERROR'), [0.3, 0.4, 0.2, 0.5]);
      if (!e) return;
      await d.click(e.x, e.y, { after: 700 });
      d.mark('before');
      await d.caption('…right-click it: <b>Re-layout edge</b>', 300);
      await d.click(e.x, e.y, { button: 'right', after: 900 });
      await d.clickOn('#context-menu-relayout-edge', { after: 600 });
      await d.caption('Straight (or as few turns as it can), clear of the other states; nothing else moves', 1500);
      d.mark('after');
      await sleep(2000);
    },
  },

  // 4. Simulation: a state's transitions in the order they are checked, values set, Step, Back, Take
  simulate: {
    async prepare(page, d, url) {
      await openSample(page, url);
      await focus(page, S('CLAMPED'), { notches: 7 });
    },
    async play(page, d) {
      await d.caption('Simulate without a PLC: the <b>Simulation</b> tab', 300);
      await tab(page, d, 'simulate');
      await page.select('#sim-start-state', S('CLAMPED'));
      await sleep(400);
      await d.clickOn('#sim-start', { after: 1500 });
      await d.caption('Its transitions in the order the PLC checks them, each condition\'s result', 2500);
      await d.caption('Set a value the conditions read (cmd_bUnclamp = TRUE) and <b>Step</b>', 300);
      await d.clickOn('#sim-var-cmd_bUnclamp-true', { after: 900 });
      await d.clickOn('#sim-step', { after: 2000 });
      await d.caption('<b>Back</b> undoes a step; <b>Take</b> one directly', 300);
      await d.clickOn('#sim-back', { after: 1400 });
      await d.clickOn('#sim-take-3', { after: 2600 });
    },
  },

  // 4b. A sub-machine running: KAnalogMeasure's KANALOGMEASURE_ENABLING calls readDiagnostics(), a state machine of
  // its own, drawn inside it; simulated: its run condition set, it starts, the state glows with its sub-machine's
  // state inside, Step through it
  submachine: {
    async prepare(page, d, url) {
      await openSample(page, url);
      // (the samples' list: in the header, or its Hidden menu at this width)
      if (await page.$('#sample-selector')) await page.select('#sample-selector', 'k-analog-measure');
      else {
        await page.click('#header-hidden-controls-btn');
        await page.waitForSelector('#dock-menu-header-sample-k-analog-measure', { timeout: 5000 });
        await page.click('#dock-menu-header-sample-k-analog-measure');
      }
      await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="KANALOGMEASURE_ENABLING__readDiagnostics__DIAG_READ_FINISH_ADR"]', { timeout: 90000 });
      await sleep(2500);
      await page.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
      await focus(page, 'KANALOGMEASURE_ENABLING__readDiagnostics__DIAG_READ_FINISH_ADR', { notches: 4 });
    },
    async play(page, d) {
      await d.caption('A state that calls a method with its own state machine: <b>readDiagnostics()</b>, drawn inside it', 2600);
      await tab(page, d, 'simulate');
      await page.select('#sim-start-state', 'KANALOGMEASURE_ENABLING');
      await sleep(400);
      await d.clickOn('#sim-start', { after: 1200 });
      await d.caption('It runs while its call\'s condition holds: <b>status_bDiagnostics</b> = TRUE', 300);
      await d.clickOn('#sim-var-status_bDiagnostics-true', { after: 1800 });
      await d.caption('The state glows, and its sub-machine\'s state inside it', 1600);
      await d.caption('<b>Step</b> through its states (fbEcCoESdoRead.bBusy = FALSE)', 300);
      await d.clickOn('[id="sim-var-fbEcCoESdoRead.bBusy-false"]', { after: 900 }).catch(() => {});
      for (let i = 0; i < 4; i++) await d.clickOn('#sim-step', { after: 1300 });
      await d.caption('Live, the PLC\'s sub-machine state is marked the same way', 2200);
    },
  },

  // 5. Live: the PLC's state on the chart (values fed through the XAE bridge's messages: a stand-in, no PLC)
  live: {
    async prepare(page, d, url) {
      const I = 'MAIN.mainStateMachine.smTableManager';
      page.__toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
      let sample = null;
      await page.exposeFunction('__hostPost', async (m) => {
        if (m.type === 'ready' && sample) {
          await page.__toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
        } else if (m.type === 'liveStart') {
          await page.__toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
        } else if (m.type === 'projectPous') await page.__toApp({ type: 'projectPous', project: 'TransferTable', pous: [], duts: [] });
        else if (m.type === 'navigate') await page.__toApp({ type: 'navigateResult', ok: false });
        // (no layout file kept here)
        else if (m.type === 'layoutRead') await page.__toApp({ type: 'layoutResult', requestId: m.requestId, text: null });
        else if (m.type === 'layoutWrite') await page.__toApp({ type: 'layoutResult', requestId: m.requestId, written: true });
      });
      await page.evaluateOnNewDocument(() => {
        const listeners = [];
        window.chrome = window.chrome || {};
        window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
        window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
      });
      await page.goto(url, { waitUntil: 'load', timeout: 180000 });
      sample = await page.evaluate(async () => {
        const mod = await import('/src/samples/samplesData.ts');
        const lv = await import('/src/utils/liveView.ts');
        const s = mod.SAMPLES[0];
        return { pou: s.pouContent, dut: s.dutContent, values: Object.fromEntries([...lv.enumValueMap(s.dutContent)].map(([v, n]) => [n, v])) };
      });
      page.__values = sample.values;
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load', timeout: 180000 });
      await page.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S('CLAMPED')}"]`, { timeout: 90000 });
      await sleep(2500);
      await page.evaluate(() => document.querySelector('#diagram-minimap-container button[title^="Close Minimap"]')?.click());
      page.__panels = { sidebar: false, rightPanel: true };
      await focus(page, S('CLAMPED'), { notches: 7 });
      await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
      await sleep(600);
    },
    async play(page, d) {
      const v = page.__values;
      await d.captionAt('top');
      await d.caption('<b>Go live</b> on the PLC: in the desktop app, the XAE extension, or the browser (Link, gateway)', 300);
      await d.clickOn('#live-start-btn', { after: 1500 });
      // (a cycle of the chart's own transitions)
      const seq = [['HOMMING', 1000], ['IDLE_FEED_OFF', 1300], ['CLAMPPING', 1300], ['CLAMPED', 1600], ['UNCLAMP_START', 1100], ['UNCLAMPING', 1100], ['IDLE_FEED_OFF', 1200], ['CLAMPPING', 1100], ['CLAMPED', 1400], ['REFEED_START', 1100], ['REFEED_WAIT_FOR_CONTINUE', 1300], ['CLAMPED', 1500]];
      let t = Date.UTC(2026, 9, 1, 6, 0, 0);
      await d.caption('The PLC\'s state glows; the transitions it takes fill the trail, with their times', 0);
      for (const [s, ms] of seq) {
        await page.__toApp({ type: 'liveValues', events: [{ t, value: v[S(s)] }] });
        t += ms * 4;
        await sleep(ms);
      }
      await d.caption('State times: per state, the stays and how long; <b>On the diagram</b>', 300);
      await page.evaluate(() => document.getElementById('live-state-times')?.scrollIntoView({ block: 'center' }));
      await sleep(500);
      const cb = await d.at('#live-state-times-diagram');
      if (cb) await d.click(cb.x, cb.y, { after: 3200 });
      await d.caption('Every session is recorded: save it, replay it, compare two of them', 2600);
    },
  },

  // 6. The checks: a transition deleted leaves a state unreachable; Problems says so; Ctrl+Z
  problems: {
    async prepare(page, d, url) {
      await openSample(page, url);
      await focus(page, S('HOMMING'), { notches: 7, dy: 60 });
    },
    async play(page, d) {
      await d.caption('The chart is checked as you edit: delete a transition…', 300);
      const e = await edgeAt(page, S('HOMMING_READY_TO_START'), S('HOMMING'), [0.6, 0.5, 0.7, 0.4, 0.8]);
      if (!e) return;
      await d.click(e.x, e.y, { button: 'right', after: 900 });
      await d.clickOn('#context-menu-delete-transition-btn', { after: 1200 });
      await d.caption('…it shows its code first', 1500);
      await d.clickOn('#text-prompt-submit', { after: 1600 });
      await d.caption('<b>Problems</b>: Homing is unreachable now; a click shows it', 300);
      await tab(page, d, 'problems');
      await sleep(1500);
      const show = await page.evaluate(() => {
        const b = [...document.querySelectorAll('[data-problem-key] button')].find((x) => /Show in diagram/.test(x.textContent));
        const r = b?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      });
      if (show) await d.click(show.x, show.y, { after: 2400 });
      await d.caption('Unreachable and dead-end states, missing branches, duplicate or shadowed conditions…', 2400);
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');
      await d.caption('<b>Ctrl+Z</b>: back, no problems', 2400);
    },
  },
};

// The I/O scene's project: a small EtherCAT line (a coupler, digital and analog terminals, a drive), its PLC links
const box = (id, name, vendor, product, type, port, inner = '', extra = '') => `<Box Id="${id}"><Name>${name}</Name><EtherCAT VendorId="${vendor}" ProductCode="${product}" RevisionNo="#x00110000" Type="${type}" Desc="${name.replace(/.*\((.*)\)/, '$1')}" PortABoxInfo="${port}">${extra}</EtherCAT>${inner}</Box>`;
const pdo = (n) => Array.from({ length: n }, (_, i) => `<Pdo Name="Channel ${i + 1}" Index="#x1a0${i}"><Entry Name="Input" Index="#x6000" Sub="#x0${i + 1}"><Type>BIT</Type></Entry></Pdo>`).join('');
const IO_XTI = `<?xml version="1.0"?>
<TcSmItem><Device Id="1" AmsNetId="5.6.7.8.2.1" RemoteName="TransferTable (EtherCAT)"><Name>__FILENAME__</Name>
${box(1, 'Coupler (EK1100)', '#x00000002', '#x044c2c52', 'EK1100 EtherCAT Coupler (2A E-Bus)', '#x00ffffff',
  box(2, 'Sensors (EL1008)', '#x00000002', '#x03f03052', 'EL1008 8Ch. Dig. Input 24V, 3ms', '#x01000001', '', pdo(4)) +
  box(3, 'Valves (EL2008)', '#x00000002', '#x07d83052', 'EL2008 8Ch. Dig. Output 24V, 0.5A', '#x02000002') +
  box(4, 'Pressure (EL3064)', '#x00000002', '#x0bf83052', 'EL3064 4Ch. Ana. Input 0-10V', '#x03000003'))}
${box(5, 'Clamp drive (Inverter i550 Cabinet)', '#x0000003b', '#x69055000', 'i550 Inverter FW V05.02.xx', '#x04000004', '', '<SuName>Lenze i550</SuName>')}
${box(6, 'Feed drive (Inverter i550 Cabinet)', '#x0000003b', '#x69055000', 'i550 Inverter FW V05.02.xx', '#x05000005', '', '<SuName>Lenze i550</SuName>')}
</Device></TcSmItem>`;
const PLC_XTI = `<?xml version="1.0"?>
<TcSmItem><Mappings><OwnerA Name="InputDst"><OwnerB Name="TIID^TransferTable (EtherCAT)^Coupler (EK1100)^Sensors (EL1008)"><Link VarA="MAIN.di_DoorSense" TypeA="BOOL" VarB="Channel 1^Input"/><Link VarA="MAIN.di_BeforeInfeed" TypeA="BOOL" VarB="Channel 2^Input"/><Link VarA="MAIN.di_AfterInfeed" TypeA="BOOL" VarB="Channel 3^Input"/></OwnerB></OwnerA></Mappings></TcSmItem>`;

module.exports.io = {
  async prepare(page, d, url) {
    await openSample(page, url, { rightPanel: true });
    await setPanels(page, { sidebar: false, rightPanel: true });
    await page.evaluate((io, plc) => {
      const file = (name, text) => ({ kind: 'file', name, getFile: async () => new File([text], name) });
      const dir = (name, entries) => ({ kind: 'directory', name, values: async function* () { for (const e of entries) yield e; } });
      const root = dir('TransferTable', [dir('TransferTable', [file('TransferTable.tsproj', '<TcSmProject/>'), dir('_Config', [dir('IO', [file('TransferTable (EtherCAT).xti', io)]), dir('PLC', [dir('Plant', [file('Plant Instance.xti', plc)])])])])]);
      window.showDirectoryPicker = async () => root;
    }, IO_XTI, PLC_XTI);
    if (await page.$eval('#status-follow-selection', (e) => e.checked).catch(() => false)) await page.click('#status-follow-selection');
    await sleep(500);
  },
  async play(page, d) {
    await d.caption('The machine\'s EtherCAT I/O: the <b>I/O</b> tab', 300);
    await tab(page, d, 'io');
    await sleep(600);
    await d.caption('Offline, from the TwinCAT project folder (live: from the running master, with each box\'s state)', 300);
    await d.clickOn('#io-tree-load-folder', { after: 2200 });
    await d.caption('Each box, its channels and the PLC variables linked to them', 300);
    await d.clickOn('#io-tree-filter', { after: 300 });
    await d.type('di_');
    await sleep(2200);
    await page.click('#io-tree-filter', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await d.caption('The network: the boxes as they are cabled', 300);
    await d.clickOn('#io-view-network', { after: 2000 });
    const drive = await d.at('#io-network [data-io-node$="Clamp drive (Inverter i550 Cabinet)"]');
    if (drive) {
      await d.caption('A box\'s properties: its vendor, its ports, its documentation', 300);
      await d.click(drive.x, drive.y, { button: 'right', after: 3200 });
    }
    await d.caption('Live: the boxes not in OP shown at once, in the status bar too', 2400);
  },
};

// The layout file shared through git (the web edition: a folder chosen; a teammate's change: the file changed there)
module.exports['layout-git'] = {
  async prepare(page, d, url) {
    await openSample(page, url, {
      rightPanel: false,
      before: () =>
        page.evaluateOnNewDocument(() => {
          const files = { 'SM_TableManager.TcPOU': '<POU/>' };
          window.__layoutFiles = files;
          const folder = {
            kind: 'directory',
            name: 'TransferTable',
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
                  return { async write(t) { text += t; }, async close() { files[n] = text; } };
                },
              };
            },
          };
          window.showDirectoryPicker = async () => folder;
        }),
    });
    await focus(page, S('HOMMING'), { notches: 9 });
  },
  async play(page, d) {
    await d.caption('Places, routes, notes and colours: kept in a file beside the POU, for git', 300);
    await d.clickOn('#status-layout', { after: 900 });
    await d.clickOn('#status-layout-pick', { after: 1800 });
    const st = await stateAt(page, S('HOMMING'));
    await d.caption('Move a state: <b>SM_TableManager.machinescope.json</b> written a moment later', 300);
    await d.drag(st.x, st.y, st.x + 140, st.y + 30, 1100);
    await sleep(1800);
    await d.caption('Commit it with the project: the team sees the same chart', 2200);
    // A teammate's change pulled in: another state moved in the file
    await page.evaluate((s) => {
      const f = JSON.parse(window.__layoutFiles['SM_TableManager.machinescope.json']);
      f.states[s] = { x: (f.states[s]?.x ?? 0) - 160, y: (f.states[s]?.y ?? 0) + 60 };
      window.__layoutFiles['SM_TableManager.machinescope.json'] = JSON.stringify(f, null, 2) + '\n';
    }, S('IDLE_FEED_OFF'));
    await d.caption('A <b>git pull</b> changes it: the chart follows within seconds', 4200);
    await d.caption('ELK and Dagre users share it; a merge conflict in it is resolved here; your own look if you want', 300);
    await d.clickOn('#status-layout', { after: 1500 });
    await page.keyboard.press('Escape');
    await sleep(1500);
  },
};

module.exports.helpers = { focus, openSample, stateAt, goTo, edgeAt, zoomAt, zoomIn, zoomLabel, emptyNear, sleep, S };
