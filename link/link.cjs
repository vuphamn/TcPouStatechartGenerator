#!/usr/bin/env node
// Kval StateScope Link: a small helper on this computer that gives the web edition's Live tab ADS access to PLCs
// (a browser cannot talk ADS itself). Listens on 127.0.0.1 only; a page must present the pairing code shown here.
//
//   statescope-link [--port 48960] [--new-code] [--no-open]
// Its page, http://127.0.0.1:<port>/, shows the pairing code and the paired pages (opened at start from a console,
// and when Link is started again while it runs).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createLiveSession, localIpTowards, defaultLocalNetId, localTwinCatNetId } = require('../shared/liveSession.cjs');
const discovery = require('../shared/tcDiscovery.cjs');
const { isSymbolPath } = require('../shared/tcAds.cjs');
const { spawn } = require('child_process');
const { createStartup } = require('./startup.cjs');
const { checkConnection } = require('../shared/tcCheck.cjs');
const { addRoutes } = require('../shared/tcRoutes.cjs');
const update = require('./update.cjs');

const VERSION = '1.0.0';
// Which code this Link runs: its stamp (link/ and shared/ hashed) and build time, baked in by build-link.cjs; run
// from source, computed here
/* global __LINK_STAMP__, __LINK_BUILT__ */
// (the tests: KSS_LINK_STAMP, a Link of another version)
const BUILD = process.env.KSS_LINK_STAMP ? { stamp: process.env.KSS_LINK_STAMP, built: '2026-01-02T03:04:05.000Z', from: 'build' } : typeof __LINK_STAMP__ !== 'undefined'
  ? { stamp: __LINK_STAMP__, built: __LINK_BUILT__, from: 'build' }
  : { stamp: require('../scripts/link-code-stamp.cjs').linkCodeStamp(path.join(__dirname, '..')), built: null, from: 'source' };
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(option('--port')) || 48960;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const startup = createStartup({ port, log });

// ---- Pairing code (kept in the user's profile) ----
const dir = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'KvalStateScope');
const file = path.join(dir, 'link.json');
function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
  const bytes = crypto.randomBytes(15);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}`;
}
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  // first run
}
if (!settings.code || args.includes('--new-code')) {
  settings.code = newCode();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}
const normalize = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let codeHash = crypto.createHash('sha256').update(normalize(settings.code)).digest();
const failures = [];
/** The paired pages, for Link's page: origin, since, what they follow */
const clients = new Set();

// The page opens in the default browser (Windows / macOS / Linux)
function openPage() {
  const url = `http://127.0.0.1:${port}/`;
  const [cmd, argv] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  try {
    spawn(cmd, argv, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    // no browser: the console shows the code
  }
}
// From a console (the Start menu shortcut) unless --no-open; not when a program started it (the tests)
const shouldOpen = !args.includes('--no-open') && process.stdout.isTTY;

const PAGE = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Kval StateScope Link</title>\n<style>\n  :root { color-scheme: dark; --bg: #020617; --card: #0f172a; --line: #1e293b; --text: #e2e8f0; --dim: #94a3b8; --accent: #38bdf8; --ok: #34d399; }\n  * { box-sizing: border-box; }\n  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, \"Segoe UI\", sans-serif; background: var(--bg); color: var(--text); }\n  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 40px; }\n  h1 { font-size: 18px; margin: 0 0 4px; }\n  .sub { color: var(--dim); margin: 0 0 20px; }\n  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }\n  .label { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }\n  .code { font: 600 30px/1.2 ui-monospace, \"Cascadia Mono\", Consolas, monospace; letter-spacing: .08em; color: var(--accent); word-break: break-all; }\n  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }\n  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: var(--text); cursor: pointer; }\n  button:hover { border-color: var(--accent); }\n  button.primary { background: #0369a1; border-color: #0284c7; }\n  .hint { color: var(--dim); font-size: 13px; }\n  table { width: 100%; border-collapse: collapse; font-size: 13px; }\n  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }\n  th { color: var(--dim); font-weight: 500; }\n  td.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; }\n  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); margin-right: 6px; }\n  .empty { color: var(--dim); }\n</style>\n</head>\n<body>\n<main>\n  <h1>Kval StateScope Link</h1>\n  <p class=\"sub\" id=\"version\">Gives the Kval StateScope web app's Live tab access to PLCs from this computer.</p>\n  <p class=\"hint\" id=\"build\"></p>\n  <p class=\"hint\" id=\"installed\" hidden></p>\n  <div class=\"row\"><button id=\"replace-installed\" hidden>Replace the installed Link with this one</button><span class=\"hint\" id=\"replace-state\"></span></div>\n  <div class=\"card\">\n    <div class=\"label\">Pairing code</div>\n    <div class=\"code\" id=\"code\">…</div>\n    <div class=\"row\">\n      <button class=\"primary\" id=\"copy\">Copy</button>\n      <span class=\"hint\" id=\"copied\"></span>\n    </div>\n    <p class=\"hint\">In the web app: Live tab, <b>Via: This computer</b>, then enter this code once (Remember keeps it in that browser).\n      Only pages on this computer can connect, and only with this code.</p>\n  </div>\n  <div class=\"card\">\n    <div class=\"label\">Paired pages</div>\n    <table><thead><tr><th>Page</th><th>Since</th><th>Following</th></tr></thead><tbody id=\"clients\"><tr><td colspan=\"3\" class=\"empty\">None yet</td></tr></tbody></table>\n  </div>\n  <div class=\"card\">\n    <div class=\"label\">Start with Windows</div>\n    <p class=\"hint\" id=\"startup-hint\">Link can start (minimized) each time you sign in, so the Live tab finds it without starting it first.</p>\n    <div class=\"row\"><button id=\"startup-on\">Start when I sign in</button><button id=\"startup-off\">Don't start when I sign in</button><span class=\"hint\" id=\"startup-state\"></span></div>\n  </div>\n  <div class=\"card\">\n    <div class=\"label\">New code</div>\n    <p class=\"hint\">A new code stops the pages paired with the old one from connecting again: they need the new one.</p>\n    <div class=\"row\"><button id=\"new-code\">Make a new code</button></div>\n  </div>\n  <p class=\"hint\">Keep Link running while you go live: close its window to stop it.</p>\n</main>\n<script>\n  const $ = (id) => document.getElementById(id);\n  const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[c]);\n  async function refresh() {\n    try {\n      const s = await (await fetch('/status', { cache: 'no-store' })).json();\n      $('code').textContent = s.code;\n      const st = s.startup || {};\n      $('startup-on').hidden = !st.supported || st.on;\n      $('startup-off').hidden = !st.supported || !st.on;\n      if (!st.supported) $('startup-hint').textContent = st.message || '';\n      else if (!$('startup-state').textContent) $('startup-state').textContent = st.on ? 'On: Link starts when you sign in' : '';\n      $('version').textContent = 'Version ' + s.version + ' on port ' + s.port + ': gives the Kval StateScope web app\\'s Live tab access to PLCs from this computer.';\n      const b = s.build || {};\n      $('build').textContent = (b.from === 'source' ? 'Run from source' : 'Built ' + (b.built ? new Date(b.built).toLocaleString() : '?')) + ', code ' + (b.stamp || '?');\n      const inst = s.installed;\n      $('installed').hidden = !inst;\n      if (inst) $('installed').textContent = 'The installed Link (' + inst.path + ', ' + new Date(inst.modified).toLocaleString() + ') is not this one: the Start menu starts that copy. Keep the newer one.';\n      $('replace-installed').hidden = !s.canReplace;\n      $('clients').innerHTML = s.clients.length\n        ? s.clients.map((c) => '<tr><td class=\"mono\"><span class=\"dot\"></span>' + esc(c.origin) + '</td><td>' + esc(new Date(c.since).toLocaleTimeString()) + '</td><td class=\"mono\">' + esc(c.following || '(not live)') + '</td></tr>').join('')\n        : '<tr><td colspan=\"3\" class=\"empty\">None yet</td></tr>';\n    } catch {\n      $('code').textContent = 'Link is not running';\n    }\n  }\n  $('copy').onclick = async () => {\n    try { await navigator.clipboard.writeText($('code').textContent); $('copied').textContent = 'Copied'; }\n    catch { const r = document.createRange(); r.selectNodeContents($('code')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copied').textContent = 'Selected: press Ctrl+C'; }\n    setTimeout(() => ($('copied').textContent = ''), 2500);\n  };\n  $('new-code').onclick = async () => {\n    if (!confirm('Make a new pairing code? Pages paired with the old one have to enter the new one.')) return;\n    await fetch('/new-code', { method: 'POST' });\n    refresh();\n  };\n  async function startup(on) {\n    try {\n      const r = await fetch('/startup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });\n      const s = await r.json();\n      $('startup-state').textContent = s.message || s.error || '';\n    } catch { $('startup-state').textContent = 'Link is not running'; }\n    refresh();\n  }\n  $('replace-installed').onclick = async () => {\n    if (!confirm('Replace the installed Link with this one? The Start menu then starts this version. (Program Files: Windows asks for an administrator.)')) return;\n    try {\n      const r = await (await fetch('/replace-installed', { method: 'POST' })).json();\n      $('replace-state').textContent = r.message || '';\n    } catch { $('replace-state').textContent = 'Link is not running'; }\n    refresh();\n  };\n  $('startup-on').onclick = () => startup(true);\n  $('startup-off').onclick = () => startup(false);\n  refresh();\n  setInterval(refresh, 2000);\n</script>\n</body>\n</html>\n";

// ---- Server: 127.0.0.1 only ----
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
const server = http.createServer((req, res) => {
  // (another name that resolves to 127.0.0.1, DNS rebinding: its own Host; no CORS headers: other sites cannot read)
  if (!allowedHosts.has(req.headers.host)) {
    res.writeHead(421);
    return res.end();
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const secure = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { ...secure, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
    return res.end(PAGE);
  }
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { ...secure, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ version: VERSION, port, code: settings.code, clients: [...clients].map(({ origin, since, following }) => ({ origin, since, following })), startup: startup.status(), build: BUILD, installed: update.installedLink(), canReplace: update.canReplace(BUILD) }));
  }
  // The installed Link replaced by this one: only from Link's own page
  if (req.method === 'POST' && url.pathname === '/replace-installed') {
    if (!allowedHosts.has(String(req.headers.origin || '').replace(/^http:\/\//, ''))) {
      res.writeHead(403, secure);
      return res.end();
    }
    void update.replaceInstalled(BUILD, log).then((r) => {
      res.writeHead(200, { ...secure, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    });
    return;
  }
  // Start when this user signs in: only from Link's own page, like a new code
  if (req.method === 'POST' && url.pathname === '/startup') {
    if (!allowedHosts.has(String(req.headers.origin || '').replace(/^http:\/\//, ''))) {
      res.writeHead(403, secure);
      return res.end();
    }
    let body = '';
    req.on('data', (d) => (body += d).length > 1000 && req.destroy());
    req.on('end', async () => {
      let on = false;
      try {
        on = JSON.parse(body).on === true;
      } catch {
        // not JSON: off
      }
      try {
        const r = await startup.set(on);
        res.writeHead(200, { ...secure, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...r, startup: startup.status() }));
      } catch (e) {
        res.writeHead(500, { ...secure, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  // A new code: only from Link's own page (a page elsewhere cannot send this Origin)
  if (req.method === 'POST' && url.pathname === '/new-code') {
    if (!allowedHosts.has(String(req.headers.origin || '').replace(/^http:\/\//, ''))) {
      res.writeHead(403, secure);
      return res.end();
    }
    settings.code = newCode();
    codeHash = crypto.createHash('sha256').update(normalize(settings.code)).digest();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    log('pairing: a new code was made on Link\'s page');
    console.log(`  Pairing code:  ${settings.code}`);
    res.writeHead(200, { ...secure, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ code: settings.code }));
  }
  res.writeHead(404, { ...secure, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});
// liveWatch carries up to 300 variables with their candidate paths
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  // DNS rebinding: a page on another name that resolves to 127.0.0.1 still sends its own Host
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!loopback || !allowedHosts.has(req.headers.host) || new URL(req.url, 'http://localhost').pathname !== '/live') {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin || '(no origin)';
  const session = createLiveSession();
  let paired = false;
  const client = { origin, since: Date.now(), following: null };
  const send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const helloTimer = setTimeout(() => !paired && ws.close(4401, 'no hello'), 10000);

  ws.on('message', async (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!paired) {
      if (m.type !== 'hello') return ws.close(4401, 'hello expected');
      const now = Date.now();
      while (failures.length && now - failures[0] > 60000) failures.shift();
      if (failures.length >= 10) {
        log(`pairing: refused ${origin} (too many wrong codes in the last minute)`);
        return ws.close(4429, 'too many attempts');
      }
      const given = crypto.createHash('sha256').update(normalize(m.token)).digest();
      if (!crypto.timingSafeEqual(given, codeHash)) {
        failures.push(now);
        log(`pairing: wrong code from ${origin}`);
        send({ type: 'denied', message: 'The pairing code does not match the one shown by Kval StateScope Link' });
        return ws.close(4401, 'denied');
      }
      paired = true;
      clients.add(client);
      clearTimeout(helloTimer);
      log(`connected: ${origin}`);
      return send({ type: 'welcome', user: os.userInfo().username, plcs: [], helper: 'link', version: VERSION, build: BUILD });
    }
    if (m.type === 'liveStop') {
      client.following = null;
      return session.stop(true, send);
    }
    // Guard variables of the running session (a malformed request is ignored)
    if (m.type === 'liveWatch') return void session.watch(m.vars);
    // Symbol browser: a symbol's members in the connected PLC
    if (m.type === 'liveBrowse') return void session.browse(send, m);
    if (m.type === 'plcSources') return void session.sources(send, m);
    // Rebuild the PLC's project with the page's edits (XAE on this computer), and write it back when asked
    if (m.type === 'plcBuildClose') return void session.closeBuild(send, m);
    if (m.type === 'plcLicense') return void session.license(send, m);
    if (m.type === 'plcBuild') {
      log(`build: ${origin} rebuilds the PLC's project (${Array.isArray(m.edits) ? m.edits.length : 0} edited file(s))${m.write ? `, then ${m.write}` : ''}`);
      return void session.build(send, m);
    }
    // The Live tab's Browse: the TwinCAT devices on the network; Add Route on one of them (with its credentials)
    const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
    const hostRx = /^[A-Za-z0-9.-]{1,253}$/;
    if (m.type === 'discover') {
      const addresses = (Array.isArray(m.addresses) ? m.addresses : []).map((a) => String(a).trim()).filter((a) => hostRx.test(a)).slice(0, 64);
      const result = await discovery.discover({ localNetId: defaultLocalNetId(localIpTowards(addresses[0] ?? '')), addresses, broadcast: process.env.KSS_DISCOVERY_BROADCAST !== '0', port: Number(process.env.KSS_DISCOVERY_PORT) || 48899 });
      log(`browse: ${origin} searched the network, ${result.devices.length} device(s)`);
      return send({ type: 'discoverResult', requestId, ...result, localTwinCat: localTwinCatNetId() });
    }
    // The Live tab's Check: why a PLC does not answer (all read-only)
    if (m.type === 'checkConnection') {
      const netId = String(m.netId ?? '').trim();
      const ip = String(m.ip ?? '').trim();
      if ((netId && !/^\d{1,3}(\.\d{1,3}){5}$/.test(netId)) || (ip && !/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(ip)) || (m.localNetId && !/^\d{1,3}(\.\d{1,3}){5}$/.test(m.localNetId))) {
        return send({ type: 'checkConnectionResult', requestId, steps: [], verdict: 'Check the PLC address and AMS NetIds' });
      }
      const result = await checkConnection({ netId, ip, adsPort: Number.isInteger(m.port) && m.port > 0 ? m.port : 851, localNetId: m.localNetId || '', discoveryPort: Number(process.env.KSS_DISCOVERY_PORT) || 48899 });
      log(`check: ${origin} checked ${ip || netId}: ${result.verdict.slice(0, 80)}`);
      return send({ type: 'checkConnectionResult', requestId, ...result });
    }
    if (m.type === 'probe') {
      const targets = (Array.isArray(m.targets) ? m.targets : []).slice(0, 50).map((t) => ({ key: String(t?.key ?? ''), ip: String(t?.ip ?? '') }));
      return send({ type: 'probeResult', requestId, reachable: await discovery.probeAll(targets) });
    }
    if (m.type === 'addRoute') {
      const result = await addRoutes({ plcIp: m.plcIp, plcNetId: m.plcNetId, plcName: m.plcName, user: m.user, password: m.password, localNetId: m.localNetId, routeName: m.routeName, both: m.both === true, localUser: m.localUser, localPassword: m.localPassword });
      log(`route: ${origin} asked ${String(m.plcIp ?? '').slice(0, 60)} for a route${m.both === true ? ' both ways' : ''}: ${result.message}`);
      return send({ type: 'addRouteResult', requestId, ...result });
    }
    if (m.type !== 'liveStart') return;
    const ident = /^[A-Za-z_]\w*$/;
    const netIdRx = /^\d{1,3}(\.\d{1,3}){5}$/;
    if (!netIdRx.test(m.netId || '') || (m.localNetId && !netIdRx.test(m.localNetId)) || (m.ip && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(m.ip))
      || (m.port && !(Number.isInteger(m.port) && m.port > 0 && m.port < 65536)) || !ident.test(m.stateVar || '')
      || (m.typeName && !ident.test(m.typeName)) || (m.instance && !isSymbolPath(m.instance))) {
      return send({ type: 'liveStatus', state: 'error', message: 'Check the PLC address, AMS NetIds, variable and instance path' });
    }
    log(`live: ${origin} -> ${m.netId}${m.ip ? ` (${m.ip})` : ''}, ${m.instance || m.typeName || ''}.${m.stateVar}`);
    const result = await session.start(send, {
      netId: m.netId, ip: m.ip, port: m.port, localNetId: m.localNetId, stateVar: m.stateVar, typeName: m.typeName, instance: m.instance, monitor: m.monitor === true,
    });
    if (result?.symbol === null) {
      client.following = `(overview) ${result.netId}:${result.adsPort}`;
      log(`live: ${origin} watches ${result.netId}:${result.adsPort} (overview)`);
    } else if (result) {
      client.following = `${result.symbol} on ${result.netId}:${result.adsPort}`;
      log(`live: following ${client.following}`);
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    clients.delete(client);
    session.stop(false);
    if (paired) log(`disconnected: ${origin}`);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Started again while it runs (the Start menu shortcut): its page, with the code
    http
      .get({ host: '127.0.0.1', port, path: '/status', headers: { host: `127.0.0.1:${port}` }, timeout: 1500 }, (res) => {
        const running = res.statusCode === 200;
        res.resume();
        console.log(running ? `Kval StateScope Link is already running: its page is http://127.0.0.1:${port}/` : `Port ${port} is in use by another program.`);
        if (running && !args.includes('--no-open')) openPage();
        process.exit(running ? 0 : 1);
      })
      .on('error', () => {
        console.error(`Port ${port} is in use by another program.`);
        process.exit(1);
      });
    return;
  }
  console.error(String(err));
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Kval StateScope Link ${VERSION}: ws://127.0.0.1:${port}/live`);
  console.log('');
  console.log(`  Pairing code:  ${settings.code}`);
  console.log('');
  console.log('Enter it once in the web app (Live tab, "This computer"). Keep this window open while you go live.');
  console.log('Only this computer can connect. New code: statescope-link --new-code');
  console.log(`Link's page (the code, the paired pages): http://127.0.0.1:${port}/`);
  console.log('');
  if (shouldOpen) openPage();
});
