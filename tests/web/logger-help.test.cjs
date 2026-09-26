const h = require('../lib/harness.cjs');
// PLC Transition Logger as a MiddlePanel tab; How It Works as the header Help (hover)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const edge = { kill() {} }; // (the harness launches the browser)
  let browser;
  browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (let i = 0; i < 60; i++) { try { await page.goto(h.APP_URL, { waitUntil: 'load' }); break; } catch { await sleep(500); } }
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  await sleep(800);

  // --- Left panel: only Identified States
  const left = await page.$eval('#source-files-sidebar', (e) => e.innerText);
  expect(!/PLC Transition Logger/.test(left) && !/How It Works/i.test(left) && !(await page.$('#open-logger-modal-sidebar-btn')), 'left panel no longer has the logger card or How It Works');

  // --- The logger is a MiddlePanel tab, in the main group after Transition History
  const middleTabs = await page.$$eval('#middle-panel [id^="dock-tab-"]', (els) => els.map((e) => e.id.replace('dock-tab-', '')));
  expect(middleTabs.includes('logger') && middleTabs.indexOf('logger') === middleTabs.indexOf('history') + 1, `middle tabs: ${middleTabs.join(', ')}`);
  await page.click('#dock-tab-logger');
  await sleep(700);
  const tab = await page.$('#plc-transition-logger-tab');
  const pos = tab ? await page.evaluate((e) => getComputedStyle(e.closest('[class*="fixed"]') || e).position + ' in ' + !!e.closest('#middle-panel'), tab) : 'none';
  expect(tab && /in true/.test(pos) && !/fixed/.test(pos) && !(await page.$('#plc-transition-logger-modal')), `logger shown inside the MiddlePanel, not as a window (${pos})`);
  const rows = await page.$$eval('#plc-transition-logger-tab tbody tr', (r) => r.length);
  expect(rows > 0, `sample log parsed in the tab (${rows} rows)`);
  await page.screenshot({ path: path.join(h.OUT, 'logger-tab.png') });

  // --- Populate -> Transition History with the log, the logger tab stays open
  const count = await page.$eval('#populate-transition-history-btn', (b) => b.textContent.match(/(\d+)\s*$/)?.[1]);
  await page.click('#populate-transition-history-btn');
  await sleep(1200);
  const activeHistory = await page.$eval('#dock-tab-history', (e) => e.getAttribute('aria-selected') === 'true' || e.className.includes('active') || e.dataset.active === 'true');
  const historyText = await page.evaluate(() => document.querySelector('#middle-panel')?.innerText || '');
  console.log('   history:', historyText.replace(/\s+/g, ' ').slice(0, 300));
  expect(!!(await page.$('#dock-tab-logger')) && activeHistory && new RegExp(`\\b${count}\\b`).test(historyText) && /\b39\b/.test(historyText), `Transition History shows the logged transitions (history tab active: ${activeHistory}, ${count} events)`);
  const status = await page.$eval('#status-message', (e) => e.textContent);
  expect(/Populated Transition History/.test(status), `status bar: ${status.trim().slice(0, 80)}`);

  // --- History's logger button opens the tab
  await page.click('#dock-tab-history');
  await sleep(500);
  await page.click('#open-plc-transition-logger-btn');
  await sleep(600);
  const loggerVisible = await page.evaluate(() => { const e = document.getElementById('plc-transition-logger-tab'); return !!e && e.getBoundingClientRect().width > 0; });
  expect(loggerVisible && !(await page.$('#plc-transition-logger-modal')), 'History > PLC Transition Logger opens the tab');

  // --- Help: hover shows, leaving hides, click pins, Esc closes
  expect(!!(await page.$('#help-btn')) && !(await page.$('#help-card')), 'Help icon in the header, card hidden');
  const hb = await (await page.$('#help-btn')).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await sleep(300);
  const card = await page.$('#help-card');
  const cardText = card ? await page.$eval('#help-card', (e) => e.innerText) : '';
  expect(card && /How it works/i.test(cardText) && /doState\(\)/.test(cardText) && /Focus mode/.test(cardText), 'hovering shows the help');
  const cb = await card.boundingBox();
  expect(cb.x >= 0 && cb.x + cb.width <= 1600 && cb.y >= hb.y + hb.height - 1, `card fits on screen (${Math.round(cb.x)}..${Math.round(cb.x + cb.width)})`);
  await page.mouse.move(cb.x + cb.width / 2, cb.y + 40, { steps: 5 });
  await sleep(400);
  expect(!!(await page.$('#help-card')), 'the card stays open while the mouse moves onto it');
  await page.screenshot({ path: path.join(h.OUT, 'help-card.png') });
  await page.mouse.move(700, 600);
  await sleep(500);
  expect(!(await page.$('#help-card')), 'leaving hides it');
  await page.click('#help-btn');
  await page.mouse.move(700, 600);
  await sleep(500);
  expect(!!(await page.$('#help-card')), 'a click pins it');
  await page.keyboard.press('Escape');
  await sleep(300);
  expect(!(await page.$('#help-card')), 'Esc closes it');

  // --- Header still fits at a narrower width: Help stays visible
  await page.setViewport({ width: 1100, height: 900 });
  await sleep(800);
  const hb2 = await (await page.$('#help-btn')).boundingBox();
  const row = await page.$eval('#header-row-1', (e) => e.getBoundingClientRect().right);
  expect(hb2 && hb2.x + hb2.width <= row, `Help stays inside the header at 1100 px (${Math.round(hb2.x + hb2.width)} <= ${Math.round(row)})`);
  await page.screenshot({ path: path.join(h.OUT, 'header-1100.png'), clip: { x: 0, y: 0, width: 1100, height: 60 } });

  // --- A layout saved before the logger tab: the tab is added on load
  await page.setViewport({ width: 1600, height: 1000 });
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('tc_statechart_dock_layout_v1'));
    for (const g of l.middle.groups) { g.tabs = g.tabs.filter((t) => t !== 'logger'); if (g.active === 'logger') g.active = 'diagram'; }
    l.knownTabs = l.knownTabs.filter((t) => t !== 'logger');
    localStorage.setItem('tc_statechart_dock_layout_v1', JSON.stringify(l));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 30000 });
  expect(!!(await page.$('#dock-tab-logger')), 'an older saved layout gets the logger tab');

  console.log('page errors:', errors.slice(0, 5));
  await browser.close().catch(() => {});
  edge.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();
