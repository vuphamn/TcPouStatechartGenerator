const h = require('../lib/harness.cjs');
// Desktop app (Electron, dev server): its update check at start against a stand-in for GitHub's releases
// (KSS_DESKTOP_RELEASES): a newer desktop release: the banner offers Update now (an installed app: the stand-in counts
// as one); quietly chosen; Update now downloads its installer and checks it against the release's SHA-256 (dry run:
// not started, the app stays)
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 48929;

(async () => {
  const installer = Buffer.from('MZ stand-in installer ' + 'y'.repeat(2000));
  const sha = crypto.createHash('sha256').update(installer).digest('hex');
  const releases = http.createServer((req, res) => {
    if (req.url.startsWith('/files/')) return res.end(installer);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify([{ tag_name: 'desktop-v99.0.0', name: 'Desktop 99.0.0', html_url: 'https://example.invalid/99', body: 'notes', draft: false, prerelease: false, assets: [{ name: 'KvalMachineScope-Setup-99.0.0.exe', browser_download_url: `http://127.0.0.1:${PORT}/files/setup.exe`, url: `http://127.0.0.1:${PORT}/api/1`, size: installer.length, digest: `sha256:${sha}` }] }]));
  });
  await new Promise((r) => releases.listen(PORT, '127.0.0.1', r));
  const electron = spawn(path.join(h.REPO, 'node_modules/electron/dist/electron.exe'), ['.', '--remote-debugging-port=9571', `--user-data-dir=${path.join(h.OUT, 'electron-prof-update-' + Date.now())}`], {
    cwd: h.REPO,
    env: (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: h.APP_ORIGIN, KSS_DESKTOP_RELEASES: `http://127.0.0.1:${PORT}/releases`, KSS_SERVICE_DRYRUN: '1' }; delete e.ELECTRON_RUN_AS_NODE; return e; })(),
    stdio: 'ignore',
  });
  let browser;
  try {
    for (let i = 0; i < 80 && !browser; i++) { await sleep(250); browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9571', defaultViewport: null }).catch(() => null); }
    let page;
    for (let i = 0; i < 40 && !page; i++) { page = (await browser.pages()).find((p) => p.url().startsWith(h.APP_ORIGIN)); if (!page) await sleep(250); }
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    // (checked quietly a few seconds after start)
    const banner = await page.waitForSelector('#update-banner', { timeout: 40000 }).catch(() => null);
    const text = banner ? await banner.evaluate((e) => e.textContent) : '';
    expect(!!banner && /99\.0\.0 is available/.test(text) && !!(await page.$('#update-install')), `the banner offers Update now ("${text.slice(0, 80)}")`);
    if (banner) {
      await page.click('#update-quiet');
      await page.click('#update-install');
      await page.waitForFunction(() => /dry run|SHA|not/i.test(document.getElementById('update-install-state')?.textContent ?? ''), { timeout: 30000 }).catch(() => {});
      const said = await page.$eval('#update-install-state', (e) => e.textContent).catch(() => '');
      const file = path.join(os.tmpdir(), 'KvalMachineScope-Setup-99.0.0.exe');
      const got = fs.existsSync(file) && fs.readFileSync(file).equals(installer);
      expect(/Downloaded and checked \(dry run: not started, quietly\)/.test(said) && got, `Update now, quietly: "${said.slice(0, 90)}" (the installer downloaded: ${got})`);
      fs.rmSync(file, { force: true });
      const kept = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('kss.update') || '{}').quiet === true; } catch { return false; } });
      expect(kept, 'quietly: kept for the next update');
    }
    expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    browser?.disconnect();
    electron.kill();
    releases.closeAllConnections();
    releases.close();
  }
  await sleep(200);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
