#!/usr/bin/env node
// Kval StateScope gateway: serves the web edition over HTTPS and gives its Live tab read-only access to the PLCs in
// its configuration, over ADS (one connection per PLC, one change notification per variable shared by all viewers).
//
//   node gateway.cjs init [--host <name>]   create config.json and a self-signed certificate
//   node gateway.cjs add-token <name>       create an access token (shown once; only its hash is stored)
//   node gateway.cjs remove-token <name>
//   node gateway.cjs [start]                run the gateway
// Options: --config <file> (default: config.json next to this file)
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Client } = require('ads-client');
// shared/ sits next to the gateway when installed, one level up in the repository
const ads = fs.existsSync(path.join(__dirname, 'shared', 'tcAds.cjs')) ? require('./shared/tcAds.cjs') : require('../shared/tcAds.cjs');

const VERSION = '1.0.0';
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const configPath = path.resolve(option('--config') ?? path.join(__dirname, 'config.json'));
const baseDir = path.dirname(configPath);
const command = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true) ?? 'start';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    console.error(`No configuration at ${configPath}: run "node gateway.cjs init" first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
const saveConfig = (config) => fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

function localIPv4() {
  return Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal)?.address ?? '127.0.0.1';
}

// ---------------------------------------------------------------------------------------------------------------
// Commands

async function init() {
  if (fs.existsSync(configPath)) {
    console.log(`${configPath} exists already; not changed.`);
    return;
  }
  const host = option('--host') ?? os.hostname();
  const ip = localIPv4();
  const config = {
    port: 8443,
    tls: { cert: 'cert.pem', key: 'key.pem' },
    appDir: 'public',
    localNetId: `${ip}.1.1`,
    allowedOrigins: [],
    maxViewers: 50,
    plcs: [{ id: 'line1', name: 'Line 1 (example)', netId: '192.168.1.20.1.1', ip: '192.168.1.20', port: 851 }],
    tokens: [],
  };
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: host }], {
    keySize: 2048,
    days: 825,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'subjectAltName', altNames: [{ type: 2, value: host }, { type: 2, value: 'localhost' }, { type: 7, ip }, { type: 7, ip: '127.0.0.1' }] },
    ],
  });
  fs.writeFileSync(path.join(baseDir, 'cert.pem'), pems.cert);
  fs.writeFileSync(path.join(baseDir, 'key.pem'), pems.private, { mode: 0o600 });
  saveConfig(config);
  console.log(`Created ${configPath} and a self-signed certificate for ${host} / ${ip}.`);
  console.log('Next:');
  console.log(' 1. Edit config.json: the PLCs (id, name, netId, ip, port). Replace cert.pem / key.pem with a certificate');
  console.log('    from your CA if you have one (browsers warn about a self-signed one).');
  console.log(` 2. On each PLC, add an ADS route to this computer: AMS NetId ${config.localNetId}, address ${ip}.`);
  console.log(' 3. node gateway.cjs add-token <name>   (one token per person or team)');
  console.log(' 4. node gateway.cjs start');
}

function addToken(name) {
  if (!name) return console.error('Usage: node gateway.cjs add-token <name>');
  const config = loadConfig();
  if (config.tokens.some((t) => t.name === name)) return console.error(`A token named "${name}" exists; remove it first.`);
  const token = crypto.randomBytes(24).toString('base64url');
  config.tokens.push({ name, sha256: sha256(token), created: new Date().toISOString() });
  saveConfig(config);
  console.log(`Access token for "${name}" (shown only now; give it to that person):\n\n  ${token}\n`);
}

function removeToken(name) {
  const config = loadConfig();
  const before = config.tokens.length;
  config.tokens = config.tokens.filter((t) => t.name !== name);
  saveConfig(config);
  console.log(before === config.tokens.length ? `No token named "${name}".` : `Removed "${name}" (running gateways pick this up within 10 s).`);
}

// ---------------------------------------------------------------------------------------------------------------
// ADS: one connection per PLC, one notification per variable, fanned out to the viewers

class PlcConnection {
  constructor(plc, localNetId) {
    this.plc = plc;
    this.localNetId = plc.localNetId || localNetId;
    this.client = null;
    this.connecting = null;
    this.symbols = new Map(); // symbol (lower case) -> { symbol, handle, size, type, subscription, viewers, last }
    this.discovered = new Map(); // type name -> { at, paths }
    this.viewers = new Set();
    this.stateTimer = null;
    this.idleTimer = null;
    this.plcState = null;
  }

  async connect() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    const [host, tcp] = (this.plc.ip || this.plc.netId.split('.').slice(0, 4).join('.')).split(':');
    const client = new Client({
      targetAmsNetId: this.plc.netId,
      targetAdsPort: this.plc.port || 851,
      routerAddress: host,
      routerTcpPort: Number(tcp) || 48898,
      localAmsNetId: this.localNetId,
      localAdsPort: 32905,
      rawClient: true,
      autoReconnect: false,
      timeoutDelay: 3000,
      hideConsoleWarnings: true,
    });
    this.connecting = (async () => {
      try {
        await client.connect();
      } catch (err) {
        throw new Error(`${this.plc.name} (${host}) did not accept the connection: ${ads.adsErrorText(err)}. Does the PLC have an ADS route to the gateway (AMS NetId ${this.localNetId})?`);
      }
      try {
        this.plcState = ads.ADS_STATES[(await client.readState()).adsState] ?? 'unknown';
      } catch (err) {
        await client.disconnect(true).catch(() => {});
        throw new Error(`${this.plc.name} did not answer on ADS port ${this.plc.port || 851}: ${ads.adsErrorText(err)}. Does the PLC have an ADS route to the gateway (AMS NetId ${this.localNetId})?`);
      }
      this.client = client;
      this.stateTimer = setInterval(() => this.checkState(), 2000);
      log(`ads: connected to ${this.plc.id} (${this.plc.netId}:${this.plc.port || 851}, PLC ${this.plcState})`);
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async checkState() {
    if (!this.client) return;
    try {
      const state = ads.ADS_STATES[(await this.client.readState()).adsState] ?? 'unknown';
      if (state !== this.plcState) {
        this.plcState = state;
        for (const v of this.viewers) v.send({ type: 'liveStatus', state: 'plcState', plcState: state });
      }
    } catch (err) {
      log(`ads: lost ${this.plc.id}: ${ads.adsErrorText(err)}`);
      for (const v of this.viewers) v.lost(`Connection to ${this.plc.name} lost: ${ads.adsErrorText(err)}`);
      await this.close();
    }
  }

  async instances(typeName) {
    const hit = this.discovered.get(typeName.toLowerCase());
    if (hit && Date.now() - hit.at < 60000) return hit.paths;
    let paths = [];
    try {
      paths = await ads.discoverInstances(this.client, typeName);
    } catch (err) {
      log(`ads: instance discovery on ${this.plc.id} failed: ${ads.adsErrorText(err)}`);
    }
    this.discovered.set(typeName.toLowerCase(), { at: Date.now(), paths });
    return paths;
  }

  /** Adds a viewer to the variable's notification (created for the first one) */
  async watch(viewer, symbol, info) {
    const key = symbol.toLowerCase();
    let entry = this.symbols.get(key);
    if (!entry) {
      entry = { symbol, size: info.size, type: info.type, handle: 0, subscription: null, viewers: new Set(), last: null, ready: null };
      this.symbols.set(key, entry);
      entry.ready = (async () => {
        entry.handle = await ads.createHandle(this.client, symbol);
        entry.last = { t: Date.now(), value: await ads.readByHandle(this.client, entry.handle, info.size) };
        entry.subscription = await ads.subscribeHandle(this.client, entry.handle, info.size, (sample) => {
          entry.last = sample;
          for (const v of entry.viewers) v.push(sample);
        });
      })();
      try {
        await entry.ready;
      } catch (err) {
        this.symbols.delete(key);
        await this.unwatchEntry(entry);
        throw err;
      }
    } else {
      await entry.ready;
    }
    entry.viewers.add(viewer);
    this.viewers.add(viewer);
    clearTimeout(this.idleTimer);
    if (entry.last) viewer.push(entry.last);
    return entry;
  }

  async unwatch(viewer) {
    this.viewers.delete(viewer);
    for (const [key, entry] of this.symbols) {
      if (!entry.viewers.delete(viewer) || entry.viewers.size) continue;
      this.symbols.delete(key);
      await this.unwatchEntry(entry);
    }
    // Keep the connection a little while for the next viewer
    if (this.viewers.size === 0) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.viewers.size === 0 && this.close(), 30000);
    }
  }

  async unwatchEntry(entry) {
    try {
      if (entry.subscription) await this.client?.unsubscribe(entry.subscription);
      if (entry.handle) await ads.releaseHandle(this.client, entry.handle);
      log(`ads: released ${entry.symbol} on ${this.plc.id}`);
    } catch {
      // connection gone
    }
  }

  async close() {
    clearInterval(this.stateTimer);
    clearTimeout(this.idleTimer);
    const client = this.client;
    this.client = null;
    this.viewers.clear();
    for (const entry of this.symbols.values()) await this.unwatchEntry(entry);
    this.symbols.clear();
    this.discovered.clear();
    if (client) {
      await client.disconnect(true).catch(() => {});
      log(`ads: disconnected from ${this.plc.id}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function serveStatic(config, req, res) {
  const appDir = path.resolve(baseDir, config.appDir || 'public');
  const url = new URL(req.url, 'https://gateway');
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
  if (url.pathname === '/gateway.json') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ gateway: 'Kval StateScope', version: VERSION, live: '/live' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, headers);
    return res.end();
  }
  let file = path.resolve(appDir, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(appDir)) {
    res.writeHead(403, headers);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(appDir, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
    return res.end('The web app is not installed next to the gateway (appDir).');
  }
  res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function start() {
  let config = loadConfig();
  // Token changes (add-token / remove-token) are picked up without a restart
  setInterval(() => {
    try {
      config.tokens = JSON.parse(fs.readFileSync(configPath, 'utf8')).tokens ?? [];
    } catch {
      // keep the previous tokens
    }
  }, 10000).unref();

  let server;
  if (config.tls?.pfx || config.tls?.cert) {
    const tls = config.tls.pfx
      ? { pfx: fs.readFileSync(path.resolve(baseDir, config.tls.pfx)), passphrase: config.tls.passphrase }
      : { cert: fs.readFileSync(path.resolve(baseDir, config.tls.cert)), key: fs.readFileSync(path.resolve(baseDir, config.tls.key)) };
    server = https.createServer(tls, (req, res) => serveStatic(config, req, res));
  } else if (config.insecure === true) {
    log('WARNING: running WITHOUT TLS ("insecure": true). Tokens and PLC data travel in clear text: only for tests.');
    server = http.createServer((req, res) => serveStatic(config, req, res));
  } else {
    console.error('No TLS certificate in config.json (tls.cert/tls.key or tls.pfx). Run "node gateway.cjs init" or add one.');
    process.exit(1);
  }

  const plcs = new Map((config.plcs ?? []).map((p) => [p.id, p]));
  const connections = new Map(); // plc id -> PlcConnection
  const connectionFor = (plc) => {
    if (!connections.has(plc.id)) connections.set(plc.id, new PlcConnection(plc, config.localNetId));
    return connections.get(plc.id);
  };
  const failures = new Map(); // ip -> [times]
  let viewerCount = 0;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'https://gateway');
    const origin = req.headers.origin;
    const sameHost = origin && new URL(origin).host === req.headers.host;
    if (url.pathname !== '/live' || (origin && !sameHost && !(config.allowedOrigins ?? []).includes(origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    let user = null;
    let session = null; // { conn, entry }
    // Raised by every start / stop / close: a start still connecting for an older request is dropped
    let startSeq = 0;
    let queue = [];
    let flushTimer = null;
    const send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    const viewer = {
      send,
      push: (sample) => queue.push(sample),
      lost: (message) => {
        if (session) viewerCount--;
        session = null;
        clearInterval(flushTimer);
        send({ type: 'liveStatus', state: 'lost', message });
      },
    };
    const helloTimer = setTimeout(() => !user && ws.close(4401, 'no hello'), 10000);

    const stopSession = async () => {
      startSeq++;
      clearInterval(flushTimer);
      flushTimer = null;
      queue = [];
      if (session) {
        const s = session;
        session = null;
        viewerCount--;
        await s.conn.unwatch(viewer);
      }
    };

    ws.on('message', async (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!user) {
        if (m.type !== 'hello' || typeof m.token !== 'string') return ws.close(4401, 'hello expected');
        const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < 60000);
        if (recent.length >= 10) {
          log(`auth: ${ip} blocked (too many failed attempts)`);
          return ws.close(4429, 'too many attempts');
        }
        const hash = Buffer.from(sha256(m.token), 'hex');
        const hit = config.tokens.find((t) => {
          const stored = Buffer.from(t.sha256, 'hex');
          return stored.length === hash.length && crypto.timingSafeEqual(stored, hash);
        });
        if (!hit) {
          failures.set(ip, [...recent, Date.now()]);
          log(`auth: rejected token from ${ip}`);
          send({ type: 'denied', message: 'The access token was not accepted by the gateway' });
          return ws.close(4401, 'denied');
        }
        user = hit.name;
        clearTimeout(helloTimer);
        log(`auth: ${user} connected from ${ip}`);
        return send({ type: 'welcome', user, plcs: [...plcs.values()].map((p) => ({ id: p.id, name: p.name })) });
      }

      if (m.type === 'liveStop') {
        await stopSession();
        return send({ type: 'liveStatus', state: 'stopped', message: 'Not connected' });
      }
      if (m.type !== 'liveStart') return;
      await stopSession();
      const seq = startSeq;
      const plc = plcs.get(m.plc);
      const stateVar = m.stateVar || 'machineState';
      if (!plc) return send({ type: 'liveStatus', state: 'error', message: 'Choose one of the gateway\'s PLCs' });
      if (!/^[A-Za-z_]\w*$/.test(stateVar) || (m.typeName && !/^[A-Za-z_]\w*$/.test(m.typeName)) || (m.instance && !ads.isSymbolPath(m.instance))) {
        return send({ type: 'liveStatus', state: 'error', message: 'Invalid variable or instance path' });
      }
      if (viewerCount >= (config.maxViewers ?? 50)) return send({ type: 'liveStatus', state: 'error', message: 'The gateway has reached its maximum number of viewers' });
      const conn = connectionFor(plc);
      send({ type: 'liveStatus', state: 'connecting', message: `Connecting to ${plc.name} through the gateway...` });
      const found = [];
      try {
        await conn.connect();
        const candidates = m.typeName ? [...(await conn.instances(m.typeName))] : [];
        if (m.instance) candidates.unshift(m.instance);
        let chosen = null;
        let info = null;
        for (const c of [...new Map(candidates.map((p) => [p.toLowerCase(), p])).values()]) {
          const i = await ads.probe(conn.client, `${c}.${stateVar}`);
          if (!i) continue;
          found.push(c);
          if (!chosen) {
            chosen = c;
            info = i;
          }
        }
        if (!chosen) {
          throw new Error(candidates.length === 0
            ? `${plc.name} has no instance of ${m.typeName ?? 'the POU'}: enter its path (e.g. MAIN.fbX)`
            : `${plc.name} has none of ${candidates.slice(0, 3).join(', ')}${candidates.length > 3 ? ', ...' : ''} with ${stateVar}`);
        }
        if (![1, 2, 4, 8].includes(info.size)) throw new Error(`${chosen}.${stateVar} is ${info.size} bytes: only integer / enum variables can be followed`);
        const symbol = `${chosen}.${stateVar}`;
        if (seq !== startSeq) return;
        const entry = await conn.watch(viewer, symbol, info);
        if (seq !== startSeq) {
          await conn.unwatch(viewer);
          return;
        }
        session = { conn, entry };
        viewerCount++;
        flushTimer = setInterval(() => {
          if (queue.length) send({ type: 'liveValues', events: queue.splice(0) });
        }, 50);
        log(`live: ${user} follows ${symbol} on ${plc.id} (${entry.viewers.size} viewer(s))`);
        send({
          type: 'liveStatus', state: 'connected', message: `${symbol} on ${plc.name} (PLC ${conn.plcState})`,
          target: plc.name, plcState: conn.plcState, instance: chosen, instances: found, symbolType: info.type,
        });
      } catch (err) {
        if (seq !== startSeq) return;
        const message = err instanceof Error ? err.message : String(err);
        log(`live: ${user} on ${plc.id}: ${message}`);
        send({ type: 'liveStatus', state: 'error', message, instances: found });
      }
    });

    ws.on('close', async () => {
      clearTimeout(helloTimer);
      startSeq++;
      await stopSession();
      if (user) log(`auth: ${user} disconnected`);
    });
  });

  server.listen(config.port ?? 8443, () => {
    log(`Kval StateScope gateway ${VERSION} on ${config.insecure && !config.tls ? 'http' : 'https'}://${os.hostname()}:${config.port ?? 8443}/ (${plcs.size} PLC(s), ${config.tokens.length} token(s))`);
  });
  // A malformed reply from a device can throw inside the ADS client's socket handling: drop the PLC connections
  // (viewers go live again) instead of stopping the gateway for everyone
  process.on('uncaughtException', async (err) => {
    log(`internal error: ${err?.stack ?? err}`);
    for (const c of connections.values()) {
      for (const v of c.viewers) v.lost('The gateway had an internal error: go live again');
      await c.close().catch(() => {});
    }
  });
  const shutdown = async () => {
    log('stopping');
    for (const c of connections.values()) await c.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

switch (command) {
  case 'init':
    init();
    break;
  case 'add-token':
    addToken(args[args.indexOf('add-token') + 1]);
    break;
  case 'remove-token':
    removeToken(args[args.indexOf('remove-token') + 1]);
    break;
  case 'start':
    start();
    break;
  default:
    console.error(`Unknown command "${command}". Commands: init, add-token <name>, remove-token <name>, start`);
    process.exit(1);
}
