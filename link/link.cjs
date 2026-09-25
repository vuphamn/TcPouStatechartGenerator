#!/usr/bin/env node
// Kval StateScope Link: a small helper on this computer that gives the web edition's Live tab ADS access to PLCs
// (a browser cannot talk ADS itself). Listens on 127.0.0.1 only; a page must present the pairing code shown here.
//
//   statescope-link [--port 48960] [--new-code]
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createLiveSession } = require('../shared/liveSession.cjs');
const { isSymbolPath } = require('../shared/tcAds.cjs');

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
const codeHash = crypto.createHash('sha256').update(normalize(settings.code)).digest();
const failures = [];

// ---- Server: 127.0.0.1 only ----
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
const server = http.createServer((req, res) => {
  if (!allowedHosts.has(req.headers.host)) {
    res.writeHead(421);
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(`Kval StateScope Link ${VERSION} is running. Open the Kval StateScope web app, Live tab, and choose "This computer".\n`);
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
      clearTimeout(helloTimer);
      log(`connected: ${origin}`);
      return send({ type: 'welcome', user: os.userInfo().username, plcs: [], helper: 'link', version: VERSION });
    }
    if (m.type === 'liveStop') return session.stop(true, send);
    // Guard variables of the running session (a malformed request is ignored)
    if (m.type === 'liveWatch') return void session.watch(m.vars);
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
      netId: m.netId, ip: m.ip, port: m.port, localNetId: m.localNetId, stateVar: m.stateVar, typeName: m.typeName, instance: m.instance,
    });
    if (result) log(`live: following ${result.symbol} on ${result.netId}:${result.adsPort}`);
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    session.stop(false);
    if (paired) log(`disconnected: ${origin}`);
  });
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is in use: is Kval StateScope Link already running?` : String(err));
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Kval StateScope Link ${VERSION}: ws://127.0.0.1:${port}/live`);
  console.log('');
  console.log(`  Pairing code:  ${settings.code}`);
  console.log('');
  console.log('Enter it once in the web app (Live tab, "This computer"). Keep this window open while you go live.');
  console.log('Only this computer can connect. New code: statescope-link --new-code');
  console.log('');
});
