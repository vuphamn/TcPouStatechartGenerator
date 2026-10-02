// Kval MachineScope Link's page (http://127.0.0.1:<port>/): the pairing code, the paired pages; a new code only from
// its own page; another host name refused; started again while it runs: it points at the running one; Start when I
// sign in (a shortcut in the Startup folder: its command only, KSS_SERVICE_DRYRUN); updates: a newer released Link
// (a stand-in release list here) found at start, updated by itself (dry run: nothing replaced), Update now, auto off
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 48985;

const request = (method, p, headers = {}) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });
const pair = (code) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/live`, { headers: { origin: 'http://localhost:3000' } });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: code })));
    ws.on('message', (m) => resolve({ ws, reply: JSON.parse(m.toString()) }));
    ws.on('error', () => resolve({ ws, reply: null }));
    setTimeout(() => resolve({ ws, reply: null }), 4000);
  });

(async () => {
  const appdata = h.out('link-page-appdata');
  fs.rmSync(appdata, { recursive: true, force: true });
  const outFile = h.out('link-page-run.txt');
  // (an installed Link older than this one, both stand-in files: Replace offered; dry run, nothing copied)
  const installedExe = h.out('link-page-installed.exe');
  const thisExe = h.out('link-page-this.exe');
  fs.writeFileSync(installedExe, 'old');
  fs.writeFileSync(thisExe, 'new');
  fs.utimesSync(installedExe, new Date(Date.now() - 86400000), new Date(Date.now() - 86400000));
  // The releases (GitHub's list, a stand-in): Link 9.9.9, its SHA-256
  const newLink = Buffer.from('Link 9.9.9');
  const releases = http.createServer((req, res) => {
    if (req.url === '/releases') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify([{ tag_name: 'web-v9.9.9', html_url: 'https://example.invalid/web-v9.9.9', assets: [{ name: 'KvalMachineScope-Link-9.9.9.exe', browser_download_url: `http://127.0.0.1:${releases.address().port}/link.exe`, size: newLink.length, digest: `sha256:${require('crypto').createHash('sha256').update(newLink).digest('hex')}` }] }]));
    }
    res.end(newLink);
  });
  await new Promise((r) => releases.listen(0, '127.0.0.1', r));
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', String(PORT), '--no-open'], { env: { ...process.env, APPDATA: appdata, KSS_SERVICE_DRYRUN: '1', KSS_INSTALLED_LINK: installedExe, KSS_THIS_LINK: thisExe, KSS_LINK_RELEASES: `http://127.0.0.1:${releases.address().port}/releases`, KSS_LINK_UPDATE_DELAY_MS: '300' }, stdio: ['ignore', fs.openSync(outFile, 'w'), fs.openSync(outFile, 'a')] });
  const code = (await h.waitForText(outFile, /Pairing code:\s+(\S+)/))?.[1];
  expect(!!code && /http:\/\/127\.0\.0\.1:48985\//.test(fs.readFileSync(outFile, 'utf8')), `started: code ${code}, its page announced`);

  const page = await request('GET', '/');
  expect(page.status === 200 && /Kval MachineScope Link/.test(page.body) && /Pairing code/.test(page.body) && page.headers['x-frame-options'] === 'DENY', 'the page (not framed by other sites)');
  let status = JSON.parse((await request('GET', '/status')).body);
  expect(status.code === code && status.clients.length === 0 && status.port === PORT, `status: the code, no pages yet`);
  // Which code it runs: run from source, its stamp computed (the same as the app build's)
  expect(status.build?.from === 'source' && status.build.stamp === require('../../scripts/link-code-stamp.cjs').linkCodeStamp() && status.build.built === null, `its build: ${JSON.stringify(status.build)}`);
  expect(!page.headers['access-control-allow-origin'] && !(await request('GET', '/status', { origin: 'https://evil.example' })).headers['access-control-allow-origin'], 'no CORS: other sites cannot read the code');
  expect((await request('GET', '/status', { host: `evil.example:${PORT}` })).status === 421, 'another host name (DNS rebinding): refused');

  // A page pairs: listed
  const { ws, reply } = await pair(code);
  expect(reply?.type === 'welcome', `paired: ${reply?.type}`);
  status = JSON.parse((await request('GET', '/status')).body);
  expect(status.clients.length === 1 && status.clients[0].origin === 'http://localhost:3000' && status.clients[0].following === null, `listed: ${JSON.stringify(status.clients)}`);
  ws.close();
  await h.sleep(300);
  expect(JSON.parse((await request('GET', '/status')).body).clients.length === 0, 'closed: no longer listed');

  // A new code: refused from another origin (or none), made from Link's own page
  expect((await request('POST', '/new-code')).status === 403 && (await request('POST', '/new-code', { origin: 'https://evil.example' })).status === 403, 'new code: refused without Link\'s own origin');
  const made = await request('POST', '/new-code', { origin: `http://127.0.0.1:${PORT}` });
  const next = made.status === 200 ? JSON.parse(made.body).code : null;
  expect(!!next && next !== code, `a new code from its page: ${next}`);
  expect((await pair(code)).reply?.type === 'denied', 'the old code no longer pairs');
  expect((await pair(next)).reply?.type === 'welcome', 'the new one does');
  expect(JSON.parse(fs.readFileSync(path.join(appdata, 'KvalMachineScope', 'link.json'), 'utf8')).code === next, 'kept in the profile');

  // In a browser: the code shown (the page's script runs), the paired page listed
  const browser = await h.launchBrowser({ defaultViewport: { width: 900, height: 700 } });
  const bp = await browser.newPage();
  const pageErrors = [];
  bp.on('pageerror', (e) => pageErrors.push(e.message));
  bp.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  const paired2 = await pair(next);
  await bp.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await h.sleep(1200);
  const shown = await bp.evaluate(() => ({ code: document.getElementById('code').textContent, clients: document.getElementById('clients').innerText }));
  expect(shown.code === next && /localhost:3000/.test(shown.clients), `the browser shows the code and the paired page (${shown.code})`);
  expect(pageErrors.length === 0, `no errors in the page ${pageErrors.slice(0, 2).join(' | ')}`);
  // Start when I sign in: off, turned on from the page (the shortcut's command: this Link, minimized, not opening its page)
  const before = JSON.parse((await request('GET', '/status')).body).startup;
  expect(before.supported && before.on === false && /Startup[\\/]Kval MachineScope Link\.lnk$/.test(before.shortcut) && before.shortcut.startsWith(appdata), `startup: off, in this user's Startup folder (${before.shortcut})`);
  expect(/link\.cjs"? --no-open --port 48985$/.test(before.command), `its command: ${before.command}`);
  expect((await request('POST', '/startup', { origin: 'https://evil.example' })).status === 403, 'startup: refused from another origin');
  const vis = () => bp.evaluate(() => ({ on: !document.getElementById('startup-on').hidden, off: !document.getElementById('startup-off').hidden, state: document.getElementById('startup-state').textContent }));
  expect((await vis()).on && !(await vis()).off, 'the page offers to start at sign-in');
  await bp.click('#startup-on');
  await h.sleep(800);
  const after = await vis();
  expect(!after.on && after.off && /starts \(minimized\) when you sign in/.test(after.state) && JSON.parse((await request('GET', '/status')).body).startup.on === true, `turned on: "${after.state}"`);
  await bp.screenshot({ path: h.out('link-page.png') });
  // Replace the installed Link: offered (this one is newer), confirmed, done (dry run: the elevated copy's command)
  const replace = await bp.evaluate(() => ({ shown: !document.getElementById('replace-installed').hidden, installed: document.getElementById('installed').textContent }));
  expect(replace.shown && /The installed Link .*link-page-installed\.exe/.test(replace.installed), `an older installed Link: Replace offered ("${replace.installed.slice(0, 70)}")`);
  bp.once('dialog', (d) => d.accept());
  await bp.click('#replace-installed');
  await h.sleep(800);
  const replaced = await bp.$eval('#replace-state', (e) => e.textContent);
  expect(/Replaced: the Start menu now starts this Link/.test(replaced) && fs.readFileSync(installedExe, 'utf8') === 'old', `replaced (dry run, nothing copied): "${replaced}"`);
  expect((await request('POST', '/replace-installed', { origin: 'https://evil.example' })).status === 403, 'replace: refused from another origin');
  // Updates: 9.9.9 found at start and taken by itself (no page live: dry run, this Link's file left as it is)
  const logged = fs.readFileSync(outFile, 'utf8');
  const up = await bp.evaluate(() => ({ state: document.getElementById('update-state').textContent, install: !document.getElementById('update-install').hidden, auto: document.getElementById('update-auto').checked }));
  expect(/update: Link 9\.9\.9 is available/.test(logged) && /update: Link 1\.0\.0 -> 9\.9\.9/.test(logged) && fs.readFileSync(thisExe, 'utf8') === 'new', `updated by itself at start (dry run): ${logged.split('\n').filter((l) => /update:/.test(l)).join(' | ')}`);
  expect(/Link 9\.9\.9 is available: this is 1\.0\.0/.test(up.state) && up.install && up.auto, `the page: "${up.state}" (Update now: ${up.install}, by itself: ${up.auto})`);
  bp.once('dialog', (d) => d.accept());
  await bp.click('#update-install');
  await bp.waitForFunction(() => /Updated/.test(document.getElementById('update-state').textContent), { timeout: 8000 }).catch(() => {});
  const updated = await bp.$eval('#update-state', (e) => e.textContent);
  expect(/Updated \(dry run: nothing replaced\)/.test(updated), `Update now: "${updated}"`);
  await bp.click('#update-auto');
  await h.sleep(600);
  expect(JSON.parse((await request('GET', '/status')).body).updates.auto === false && JSON.parse(fs.readFileSync(path.join(appdata, 'KvalMachineScope', 'link.json'), 'utf8')).autoUpdate === false, 'by itself: turned off, kept in the profile');
  expect((await request('POST', '/update/install', { origin: 'https://evil.example' })).status === 403 && (await request('POST', '/update/check')).status === 403, 'updates: refused from another origin (or none)');
  await bp.click('#startup-off');
  await h.sleep(800);
  expect((await vis()).on && JSON.parse((await request('GET', '/status')).body).startup.on === false, `turned off: "${(await vis()).state}"`);
  paired2.ws.close();
  await browser.close();

  // Started again: it points at the running Link and exits
  const second = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', String(PORT), '--no-open'], { env: { ...process.env, APPDATA: appdata } });
  let out = '';
  second.stdout.on('data', (d) => (out += d));
  const code2 = await new Promise((r) => second.on('exit', r));
  expect(code2 === 0 && /already running: its page is http:\/\/127\.0\.0\.1:48985\//.test(out), `started again: "${out.trim()}" (exit ${code2})`);

  link.kill();
  releases.closeAllConnections();
  releases.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
