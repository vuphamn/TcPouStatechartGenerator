// Sends a message from the StateScope app in an XAE tab to the extension (as the app would), through WebView2's
// debugging port. Usage: node post.cjs <tab title part> <file with the JSON message>
const puppeteer = require('puppeteer-core');
(async () => {
  const [, , titlePart, file] = process.argv;
  const json = require("fs").readFileSync(file, "utf8").replace(/^﻿/, "");
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9444', defaultViewport: null });
  const pages = (await browser.pages()).filter((p) => p.url().includes('statescope.example'));
  let target = null;
  for (const p of pages) if ((await p.title()).includes(titlePart)) target = p;
  if (!target) {
    console.log(`no page titled *${titlePart}*: ${(await Promise.all(pages.map((p) => p.title()))).join(' | ')}`);
    process.exit(1);
  }
  await target.evaluate((m) => window.chrome.webview.postMessage(JSON.parse(m)), json);
  console.log(`sent to "${await target.title()}"`);
  const titles = await Promise.all(pages.map((p) => p.title()));
  console.log(`pages: ${titles.join(' | ')}`);
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(2); });
