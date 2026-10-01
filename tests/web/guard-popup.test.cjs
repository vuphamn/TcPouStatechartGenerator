// The guard popup (an edge's label hovered): the mouse can reach it (it stays while on it), a click pins it (it stays
// whatever is hovered, until Esc or its pin), Copy copies the condition; a composite's collapsed edge lists the
// transitions it stands for (their states and priorities), one clicked opens its code
// (KPowerSupply, Collapse error-sink edges on: KPowerSupplyEnabled -> ERROR stands for RESET [2] and ENABLED [1])
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const FROM = 'KPowerSupplyEnabled';
const TO = 'ERROR';

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  await browser.defaultBrowserContext().overridePermissions(new URL(h.APP_URL).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await p.select('#sample-selector', 'k-power-supply-ax86x0');
  await p.waitForSelector('#mermaid-canvas-area g.node[data-state-id="RESET"]', { timeout: 60000 });
  await h.sleep(1200);
  if (await p.$eval('#collapse-errors-checkbox', (e) => !e.checked)) await p.click('#collapse-errors-checkbox');
  await h.sleep(2000);

  const popup = () => p.evaluate(() => {
    const el = document.getElementById('edge-guard-condition-hover-badge');
    if (!el || getComputedStyle(el).visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      pinned: el.getAttribute('data-pinned') === 'true',
      text: el.innerText,
      members: [...el.querySelectorAll('#guard-popup-members [data-member]')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
    };
  });
  // The collapsed edge's label: its centre (in view)
  const labelAt = async (from, to) => p.evaluate((from, to) => {
    const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') === from && x.getAttribute('data-to') === to && x.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, bottom: r.bottom, top: r.top };
  }, from, to);
  const hover = async () => {
    const l = await labelAt(FROM, TO);
    expect(!!l, `the label of ${FROM} -> ${TO} on screen`);
    if (!l) return null;
    await p.mouse.move(l.x - 30, l.y - 40);
    await h.sleep(150);
    await p.mouse.move(l.x, l.y, { steps: 4 });
    await h.sleep(500);
    return l;
  };

  const l = await hover();
  let pop = await popup();
  expect(!!pop, 'its label hovered: the guard popup');
  // (its ends lit: the composite it leaves too)
  const lit = await p.evaluate((from) => [...document.querySelectorAll('#mermaid-canvas-area svg g.cluster.tc-end-hover')].some((c) => c.id.endsWith(`-${from}`)), FROM);
  expect(lit, `its end, the composite ${FROM}, lit`);
  expect(pop && pop.members.length === 2 && pop.members.some((t) => /RESET.*ERROR.*\[2\]/.test(t)) && pop.members.some((t) => /ENABLED.*ERROR.*\[1\]/.test(t)), `it lists the 2 transitions it stands for, with their priorities (${pop?.members.join(' | ')})`);

  // The mouse onto the popup: it stays
  if (l && pop) {
    // (a spot of it with no label or badge beneath: the popup gives way to one under it while not pinned; its
    // title row, not a button; reached in one move, not over others on the way)
    const spot = await p.evaluate(() => {
      const el = document.getElementById('edge-guard-condition-hover-badge');
      const r = el.getBoundingClientRect();
      for (let fy = 0.06; fy < 0.95; fy += 0.04) for (let fx = 0.2; fx < 0.85; fx += 0.1) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const all = document.elementsFromPoint(x, y);
        if (all[0]?.closest('button, a')) continue;
        if (all.some((e) => !el.contains(e) && e.closest('g.edgeLabel, .tc-priority-badge, .priority-badge'))) continue;
        if (!el.contains(all[0])) continue;
        return { x, y };
      }
      return { x: r.x + r.width / 2, y: r.y + 10 };
    });
    const tx = spot.x;
    const ty = spot.y;
    await p.mouse.move(tx, ty);
    await h.sleep(500);
    expect(!!(await popup()), 'the mouse moved from the label onto the popup: it stays');
    // A click on it: pinned
    await p.mouse.click(tx, ty);
    await h.sleep(300);
    pop = await popup();
    expect(pop?.pinned === true, 'a click on it: pinned');
    // Away, over another label and the empty canvas: still there
    await p.mouse.move(40, 900, { steps: 6 });
    await h.sleep(600);
    const other = await p.evaluate((from) => { const el = [...document.querySelectorAll('#mermaid-canvas-area g.edgeLabel')].find((x) => x.getAttribute('data-from') && x.getAttribute('data-from') !== from && x.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, FROM);
    if (other) { await p.mouse.move(other.x, other.y, { steps: 4 }); await h.sleep(500); }
    pop = await popup();
    expect(pop?.pinned === true && /KPowerSupplyEnabled/.test(pop.text), 'pinned: it stays when the mouse leaves, over another label too');
    // Copy
    await p.click('#guard-popup-copy');
    await h.sleep(400);
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
    const icon = await p.$eval('#guard-popup-copy svg', (s) => s.getAttribute('class') || '').catch(() => '');
    expect(/emerald/.test(icon) || (clip && /hasErrors|collapsed/i.test(clip)), `Copy: the condition copied (${JSON.stringify(clip)})`);
    // Esc: closed
    await p.keyboard.press('Escape');
    await h.sleep(300);
    expect(!(await popup()), 'Esc: the pinned popup closes');
  }

  // Not pinned: the mouse off the label onto the canvas closes it soon
  if (await hover()) {
    await p.mouse.move(40, 900, { steps: 3 });
    await h.sleep(700);
    expect(!(await popup()), 'not pinned: the mouse away closes it');
  }

  // One of the transitions clicked: its code opened in the Method editor
  if (await hover()) {
    pop = await popup();
    const btn = await p.evaluate(() => { const b = [...document.querySelectorAll('#guard-popup-members [data-member]')].find((x) => /^RESET/.test(x.innerText.trim())); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    expect(!!btn, 'its RESET row');
    if (btn) {
      await p.mouse.move(btn.x, btn.y, { steps: 8 });
      await h.sleep(300);
      await p.mouse.click(btn.x, btn.y);
      await h.sleep(1200);
      const ed = await p.evaluate(() => {
        const t = document.getElementById('method-implementation-editor');
        if (!t || t.getBoundingClientRect().width === 0) return null;
        // (the line jumped to: highlighted)
        const line = +(document.querySelector('[data-highlighted-line]')?.getAttribute('data-highlighted-line') ?? 0);
        const lines = t.value.split('\n');
        // (its IF and the assignment under it)
        return { line, text: line ? lines.slice(line - 1, line + 2).join('\n') : '', state: lines.slice(0, line).reverse().map((x) => /^\s*(?:\w+\.)?(\w+)\s*:(?!=)/.exec(x)?.[1]).find(Boolean) ?? '' };
      });
      expect(!!ed, 'the Method editor opened');
      expect(!!ed && ed.line > 0 && /ERROR/.test(ed.text) && /^RESET\b/.test(ed.state), `at the transition's code: RESET's, to ERROR (line ${ed?.line} in ${ed?.state}: ${JSON.stringify(ed?.text.slice(0, 160))})`);
      expect(!(await popup()), 'the popup closed');
    }
  }

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
