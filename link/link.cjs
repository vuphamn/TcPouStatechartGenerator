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
const { createLiveSession, localIpTowards, defaultLocalNetId } = require('../shared/liveSession.cjs');
const discovery = require('../shared/tcDiscovery.cjs');
const { isSymbolPath } = require('../shared/tcAds.cjs');
const { spawn } = require('child_process');

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(option('--port')) || 48960;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

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

const PAGE = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Kval StateScope Link</title>\n<style>\n  :root { color-scheme: dark; --bg: #020617; --card: #0f172a; --line: #1e293b; --text: #e2e8f0; --dim: #94a3b8; --accent: #38bdf8; --ok: #34d399; }\n  * { box-sizing: border-box; }\n  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, \"Segoe UI\", sans-serif; background: var(--bg); color: var(--text); }\n  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 40px; }\n  h1 { font-size: 18px; margin: 0 0 4px; }\n  .sub { color: var(--dim); margin: 0 0 20px; }\n  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }\n  .label { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }\n  .code { font: 600 30px/1.2 ui-monospace, \"Cascadia Mono\", Consolas, monospace; letter-spacing: .08em; color: var(--accent); word-break: break-all; }\n  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }\n  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: var(--text); cursor: pointer; }\n  button:hover { border-color: var(--accent); }\n  button.primary { background: #0369a1; border-color: #0284c7; }\n  .hint { color: var(--dim); font-size: 13px; }\n  table { width: 100%; border-collapse: collapse; font-size: 13px; }\n  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: top; }\n  th { color: var(--dim); font-weight: 500; }\n  td.mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; }\n  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ok); margin-right: 6px; }\n  .empty { color: var(--dim); }\n</style>\n</head>\n<body>\n<main>\n  <h1>Kval StateScope Link</h1>\n  <p class=\"sub\" id=\"version\">Gives the Kval StateScope web app's Live tab access to PLCs from this computer.</p>\n  <div class=\"card\">\n    <div class=\"label\">Pairing code</div>\n    <div class=\"code\" id=\"code\">…</div>\n    <div class=\"row\">\n      <button class=\"primary\" id=\"copy\">Copy</button>\n      <span class=\"hint\" id=\"copied\"></span>\n    </div>\n    <p class=\"hint\">In the web app: Live tab, <b>Via: This computer</b>, then enter this code once (Remember keeps it in that browser).\n      Only pages on this computer can connect, and only with this code.</p>\n  </div>\n  <div class=\"card\">\n    <div class=\"label\">Paired pages</div>\n    <table><thead><tr><th>Page</th><th>Since</th><th>Following</th></tr></thead><tbody id=\"clients\"><tr><td colspan=\"3\" class=\"empty\">None yet</td></tr></tbody></table>\n  </div>\n  <div class=\"card\">\n    <div class=\"label\">New code</div>\n    <p class=\"hint\">A new code stops the pages paired with the old one from connecting again: they need the new one.</p>\n    <div class=\"row\"><button id=\"new-code\">Make a new code</button></div>\n  </div>\n  <p class=\"hint\">Keep Link running while you go live: close its window to stop it.</p>\n</main>\n<script>\n  const $ = (id) => document.getElementById(id);\n  const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[c]);\n  async function refresh() {\n    try {\n      const s = await (await fetch('/status', { cache: 'no-store' })).json();\n      $('code').textContent = s.code;\n      $('version').textContent = 'Version ' + s.version + ' on port ' + s.port + ': gives the Kval StateScope web app\\'s Live tab access to PLCs from this computer.';\n      $('clients').innerHTML = s.clients.length\n        ? s.clients.map((c) => '<tr><td class=\"mono\"><span class=\"dot\"></span>' + esc(c.origin) + '</td><td>' + esc(new Date(c.since).toLocaleTimeString()) + '</td><td class=\"mono\">' + esc(c.following || '(not live)') + '</td></tr>').join('')\n        : '<tr><td colspan=\"3\" class=\"empty\">None yet</td></tr>';\n    } catch {\n      $('code').textContent = 'Link is not running';\n    }\n  }\n  $('copy').onclick = async () => {\n    try { await navigator.clipboard.writeText($('code').textContent); $('copied').textContent = 'Copied'; }\n    catch { const r = document.createRange(); r.selectNodeContents($('code')); getSelection().removeAllRanges(); getSelection().addRange(r); $('copied').textContent = 'Selected: press Ctrl+C'; }\n    setTimeout(() => ($('copied').textContent = ''), 2500);\n  };\n  $('new-code').onclick = async () => {\n    if (!confirm('Make a new pairing code? Pages paired with the old one have to enter the new one.')) return;\n    await fetch('/new-code', { method: 'POST' });\n    refresh();\n  };\n  refresh();\n  setInterval(refresh, 2000);\n</script>\n</body>\n</html>\n";

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
    return res.end(JSON.stringify({ version: VERSION, port, code: settings.code, clients: [...clients].map(({ origin, since, following }) => ({ origin, since, following })) }));
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
      return send({ type: 'welcome', user: os.userInfo().username, plcs: [], helper: 'link', version: VERSION });
    }
    if (m.type === 'liveStop') {
      client.following = null;
      return session.stop(true, send);
    }
    // Guard variables of the running session (a malformed request is ignored)
    if (m.type === 'liveWatch') return void session.watch(m.vars);
    // Symbol browser: a symbol's members in the connected PLC
    if (m.type === 'liveBrowse') return void session.browse(send, m);
    // The Live tab's Browse: the TwinCAT devices on the network; Add Route on one of them (with its credentials)
    const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
    const hostRx = /^[A-Za-z0-9.-]{1,253}$/;
    if (m.type === 'discover') {
      const addresses = (Array.isArray(m.addresses) ? m.addresses : []).map((a) => String(a).trim()).filter((a) => hostRx.test(a)).slice(0, 64);
      const result = await discovery.discover({ localNetId: discovery.localNetworks()[0]?.netId, addresses, broadcast: process.env.KSS_DISCOVERY_BROADCAST !== '0', port: Number(process.env.KSS_DISCOVERY_PORT) || 48899 });
      log(`browse: ${origin} searched the network, ${result.devices.length} device(s)`);
      return send({ type: 'discoverResult', requestId, ...result });
    }
    if (m.type === 'probe') {
      const targets = (Array.isArray(m.targets) ? m.targets : []).slice(0, 50).map((t) => ({ key: String(t?.key ?? ''), ip: String(t?.ip ?? '') }));
      return send({ type: 'probeResult', requestId, reachable: await discovery.probeAll(targets) });
    }
    if (m.type === 'addRoute') {
      const plcIp = String(m.plcIp ?? '').trim().split(':')[0];
      if (!hostRx.test(plcIp)) return send({ type: 'addRouteResult', requestId, ok: false, message: 'The PLC\'s IP address is needed' });
      const hostAddress = localIpTowards(plcIp);
      const localNetId = /^\d{1,3}(\.\d{1,3}){5}$/.test(m.localNetId || '') ? m.localNetId : defaultLocalNetId(hostAddress);
      const result = await discovery.addRoute({ plcIp, localNetId, hostAddress, routeName: String(m.routeName || os.hostname()).slice(0, 60), user: String(m.user ?? ''), password: String(m.password ?? ''), port: Number(process.env.KSS_DISCOVERY_PORT) || 48899 });
      log(`route: ${origin} asked ${plcIp} for a route to ${localNetId}: ${result.message}`);
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
