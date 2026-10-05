#!/usr/bin/env node
// Kval MachineScope gateway: serves the web edition over HTTPS and gives its Live tab read-only access to the PLCs in
// its configuration, over ADS (one connection per PLC, one change notification per variable shared by all viewers).
//
//   node gateway.cjs init [--host <name>]   create config.json and a self-signed certificate
//   node gateway.cjs add-token <name>       create an access token (shown once; only its hash is stored)
//   node gateway.cjs remove-token <name>
//   node gateway.cjs [start]                run the gateway; its setup page: https://localhost:<port>/admin
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
const sharedDir = fs.existsSync(path.join(__dirname, 'shared', 'tcAds.cjs')) ? './shared' : '../shared';
const ads = require(`${sharedDir}/tcAds.cjs`);
const { readPlcSources } = require(`${sharedDir}/tcSources.cjs`);
const { buildFromPlc, buildFromProject, checkEdits, closeXae } = require(`${sharedDir}/tcBuild.cjs`);
const { ProjectMirror } = require(`${sharedDir}/projectMirror.cjs`);
const { readTrialLicense, licenseState } = require(`${sharedDir}/tcLicense.cjs`);
const { checkConnection } = require(`${sharedDir}/tcCheck.cjs`);
const { plcAppInfo, startPlc } = require(`${sharedDir}/tcAppInfo.cjs`);
const { instancesAt, startAt } = require(`${sharedDir}/liveSession.cjs`);
const { describePlc } = require(`${sharedDir}/tcPlcState.cjs`);
const { VarWatcher, parseWatchRequest } = require(`${sharedDir}/liveVars.cjs`);
const discovery = require(`${sharedDir}/tcDiscovery.cjs`);
const { createAdmin } = require('./admin.cjs');
const { createAlerts, checkRule, postWebhook } = require('./alerts.cjs');
const { createAuth } = require('./auth.cjs');
const { createAlertLog, createBoards, createMaintenance, mutedFor } = require('./board.cjs');
const { createRecorders, checkRecording } = require('./recorder.cjs');
const { createAudit } = require('./audit.cjs');
const { createReports, checkShifts } = require('./report.cjs');
const { createService } = require('./service.cjs');

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
    maxWatchedVariables: 100,
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
  console.log(' 1. The PLCs: start the gateway and open https://localhost:8443/admin on this computer (it searches the');
  console.log('    network for them), or edit config.json (id, name, netId, ip, port). Replace cert.pem / key.pem with a certificate');
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
    this.dtCache = null; // symbol browser: the next connection may have another program
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
    this.dtCache = null; // symbol browser: the next connection may have another program
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
    return res.end(JSON.stringify({ gateway: 'Kval MachineScope', version: VERSION, live: '/live' }));
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
  const plcs = new Map((config.plcs ?? []).map((p) => [p.id, p]));
  const connections = new Map(); // plc id -> PlcConnection
  const connectionFor = (plc) => {
    if (!connections.has(plc.id)) connections.set(plc.id, new PlcConnection(plc, config.localNetId));
    return connections.get(plc.id);
  };

  // Tokens and PLCs from config.json (the setup page, add-token / remove-token, an edit): a PLC whose settings changed
  // is disconnected, its viewers go live again
  const mtime = () => {
    try {
      return fs.statSync(configPath).mtimeMs;
    } catch {
      return 0;
    }
  };
  let configMtime = mtime();
  const applyConfig = (next) => {
    config.tokens = next.tokens ?? [];
    const netIdChanged = (next.localNetId ?? '') !== (config.localNetId ?? '');
    const nextPlcs = new Map((next.plcs ?? []).map((p) => [p.id, p]));
    for (const [id, conn] of connections) {
      const p = nextPlcs.get(id);
      if (p && !netIdChanged && JSON.stringify(p) === JSON.stringify(conn.plc)) continue;
      for (const v of conn.viewers) v.lost(`The gateway's settings for ${conn.plc.name} changed: go live again`);
      connections.delete(id);
      conn.close().catch(() => {});
    }
    config.localNetId = next.localNetId;
    config.plcs = next.plcs ?? [];
    plcs.clear();
    for (const [id, p] of nextPlcs) plcs.set(id, p);
    config.alerts = next.alerts ?? [];
    alerts?.apply(config.alerts);
    config.boards = next.boards ?? [];
    config.shifts = next.shifts ?? [];
    config.reports = next.reports ?? {};
    config.recordings = next.recordings ?? [];
    recorders?.apply(config.recordings);
    config.oidc = next.oidc;
    configMtime = mtime();
  };
  // Alerts: the machines of the rules' PLCs followed by the gateway itself (webhooks when stuck / in error)
  let alerts = null;
  let recorders = null;
  setInterval(() => {
    if (mtime() === configMtime) return;
    try {
      applyConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
      log(`config: reloaded (${plcs.size} PLC(s), ${config.tokens.length} token(s))`);
    } catch {
      // keep the previous settings (a file being written)
    }
  }, 10000).unref();

  // Setup page: a PLC's connection tested. With a live connection to that PLC its client is used: a second connection
  // from the same AMS NetId could take the PLC's route from it
  const testPlc = async (plc) => {
    const localNetId = plc.localNetId || config.localNetId;
    const [host, tcp] = plc.ip.split(':');
    const net = discovery.localNetworks().find((n) => {
      const a = n.address.split('.').map(Number);
      const m = n.netmask.split('.').map(Number);
      const h = host.split('.').map(Number);
      return h.length === 4 && a.every((x, i) => (x & m[i]) === (h[i] & m[i]));
    });
    const route = `Does the PLC have an ADS route to the gateway: AMS NetId ${localNetId}, address ${net?.address ?? 'this computer\'s IP address'}?`;
    let client = [...connections.values()].find((c) => c.client && c.plc.netId === plc.netId)?.client;
    let own = null;
    if (!client) {
      own = new Client({
        targetAmsNetId: plc.netId, targetAdsPort: 10000, routerAddress: host, routerTcpPort: Number(tcp) || 48898,
        localAmsNetId: localNetId, localAdsPort: 32906, rawClient: true, autoReconnect: false, timeoutDelay: 2000, hideConsoleWarnings: true,
      });
      try {
        await own.connect();
      } catch (err) {
        return { ok: false, message: `No TwinCAT router at ${host}:${Number(tcp) || 48898} (${ads.adsErrorText(err)}): is the address right, the PLC on, TCP 48898 open?` };
      }
      client = own;
    }
    try {
      let system;
      try {
        system = ads.ADS_STATES[(await client.readState({ amsNetId: plc.netId, adsPort: 10000 })).adsState] ?? 'unknown';
      } catch (err) {
        return { ok: false, message: `${host} did not answer as ${plc.netId} (${ads.adsErrorText(err)}). ${route}` };
      }
      let device = '';
      try {
        const d = await client.readDeviceInfo({ amsNetId: plc.netId, adsPort: 10000 });
        device = ` (${String(d.deviceName ?? '').trim() || 'TwinCAT'} ${d.majorVersion}.${d.minorVersion}.${d.versionBuild})`;
      } catch {
        // the version is only for the message
      }
      const runtimes = [];
      for (const port of [...new Set([plc.port, 851, 852, 853, 854])]) {
        try {
          runtimes.push({ port, state: ads.ADS_STATES[(await client.readState({ amsNetId: plc.netId, adsPort: port })).adsState] ?? 'unknown' });
        } catch {
          // no runtime on that port
        }
      }
      const mine = runtimes.find((r) => r.port === plc.port);
      const others = runtimes.filter((r) => r.port !== plc.port).map((r) => `${r.port}: ${r.state}`).join(', ');
      if (!mine) return { ok: false, system, runtimes, message: `TwinCAT ${system}${device}, but no PLC runtime on port ${plc.port}${others ? ` (found ${others})` : ''}` };
      return { ok: true, system, runtimes, message: `OK: PLC on port ${plc.port} ${mine.state}, TwinCAT ${system}${device}${others ? `; also ${others}` : ''}` };
    } finally {
      if (own) await own.disconnect(true).catch(() => {});
    }
  };
  // The alert history (listed and acknowledged in the web app) and the operator boards' monitors
  const plcOf = (id) => plcs.get(id);
  const rulesNow = () => config.alerts ?? [];
  const alertLog = createAlertLog({ file: path.join(baseDir, 'alerts-history.json'), log, rules: rulesNow });
  // Maintenance (set on the board: a PLC's alerts muted until a time)
  // Audit log: who did what (audit-YYYY-MM.jsonl next to config.json)
  const audit = createAudit({ dir: baseDir, log });
  const maintenance = createMaintenance({ file: path.join(baseDir, 'maintenance.json'), log, rules: rulesNow, plcOf, audit });
  const boards = createBoards({ connectionFor, plcOf, rules: rulesNow, log, retryMs: config.alertRetryMs ?? 30000, maintenance });
  alerts = createAlerts({ connectionFor, plcOf, log, retryMs: config.alertRetryMs ?? 30000, onEvent: (e) => alertLog.add(e), maintenanceOf: (id) => maintenance.get(id) });
  alerts.apply(config.alerts ?? []);
  // Escalation: open alerts not acknowledged in time, posted again
  const muted = mutedFor(maintenance);
  setInterval(() => alertLog.escalate(Date.now(), muted), config.escalationCheckMs ?? 30000).unref();
  // Recordings on the gateway (config.recordings)
  recorders = createRecorders({ dir: path.join(baseDir, 'recordings'), connectionFor, plcOf, log, retryMs: config.alertRetryMs ?? 30000, rules: rulesNow, maintenance, onEvent: (e) => alertLog.add(e), audit });
  recorders.apply(config.recordings ?? []);
  // Shift reports (config.shifts, config.reports.webhook): posted when a shift ends; the board downloads them
  const maintenanceOfAll = (from, to) => [...plcs.keys()].flatMap((id) => maintenance.windowsBetween(id, from, to).map((w) => ({ plc: id, from: new Date(w.from).toISOString(), until: new Date(w.until).toISOString() })));
  const reports = createReports({ file: path.join(baseDir, 'reports.json'), getConfig: () => config, events: () => alertLog.all(), maintenanceOf: maintenanceOfAll, log, audit });
  // Run at startup (Windows): the gateway as a scheduled task
  const service = createService({ configPath, log, audit });
  const admin = createAdmin({
    configPath,
    getConfig: () => config,
    applyConfig,
    plcStatus: (id) => {
      const c = connections.get(id);
      return c?.client ? { connected: true, viewers: c.viewers.size, plcState: c.plcState } : { connected: false };
    },
    testPlc,
    // (the Live tab's Check, from the gateway: its NetId, its network)
    checkPlc: (plc) => checkConnection({ netId: plc.netId, ip: plc.ip, adsPort: plc.port || 851, localNetId: plc.localNetId || config.localNetId || '', discoveryPort: Number(process.env.KSS_DISCOVERY_PORT) || 48899 }),
    discover: discovery.discover,
    localNetworks: discovery.localNetworks,
    sha256,
    version: VERSION,
    log,
    recordings: { list: () => recorders.list(), check: checkRecording, checkSlowerNow: (id) => recorders.checkSlowerNow(id) },
    audit,
    reports: { checkShifts, report: (which) => reports.report(which), send: (which) => reports.send(which) },
    service: { status: () => service.status(), install: () => service.install('setup page'), remove: () => service.remove('setup page'), switchToTask: () => service.switchToTask('setup page', () => shutdown()) },
    alerts: { status: () => alerts.status(), checkRule, test: (webhook, format) => postWebhook(webhook, format, { event: 'test', text: `Kval MachineScope gateway on ${os.hostname()}: a test message from its setup page`, at: new Date().toISOString() }, log) },
  });
  const auth = createAuth({ getConfig: () => config, log, secure: !!(config.tls?.pfx || config.tls?.cert) });
  const handleRequest = async (req, res) => {
    if (await auth.handle(req, res)) return;
    if (!admin(req, res)) serveStatic(config, req, res);
  };

  let server;
  if (config.tls?.pfx || config.tls?.cert) {
    const tls = config.tls.pfx
      ? { pfx: fs.readFileSync(path.resolve(baseDir, config.tls.pfx)), passphrase: config.tls.passphrase }
      : { cert: fs.readFileSync(path.resolve(baseDir, config.tls.cert)), key: fs.readFileSync(path.resolve(baseDir, config.tls.key)) };
    server = https.createServer(tls, handleRequest);
  } else if (config.insecure === true) {
    log('WARNING: running WITHOUT TLS ("insecure": true). Tokens and PLC data travel in clear text: only for tests.');
    server = http.createServer(handleRequest);
  } else {
    console.error('No TLS certificate in config.json (tls.cert/tls.key or tls.pfx). Run "node gateway.cjs init" or add one.');
    process.exit(1);
  }
  const failures = new Map(); // ip -> [times]
  let viewerCount = 0;

  // liveWatch carries the guard variables with their candidate paths
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
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
    const ssoUser = auth.userOf(req);
    // Operator board and alert history of this connection
    let boardStop = null;
    let alertsOff = null;
    const boardViewer = {};
    let user = null;
    let session = null; // { conn, entry, vars }
    // (Build from the page's project folder: its files mirrored on this computer, only with allowBuild)
    const mirror = new ProjectMirror();
    // Guard variables asked for before the session was connected
    let desiredVars = null;
    // Raised by every start / stop / close: a start still connecting for an older request is dropped
    let startSeq = 0;
    let queue = [];
    let flushTimer = null;
    const send = (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    const viewer = {
      send,
      push: (sample) => queue.push(sample),
      lost: (message) => {
        if (session) {
          viewerCount--;
          // The connection is closed with its handles: nothing left to release
          session.vars.closed = true;
        }
        session = null;
        clearInterval(flushTimer);
        send({ type: 'liveStatus', state: 'lost', message });
      },
    };
    const helloTimer = setTimeout(() => !user && ws.close(4401, 'no hello'), 10000);
    // (what this gateway offers its pages, by its settings)
    const features = () => {
      const browse = config.allowBrowse !== false;
      return ['appInfo', ...(browse ? ['deviceInfo', 'instancesOffline', 'plcStatesRefresh'] : []), ...(browse && config.allowSources !== false ? ['sourcesOffline'] : []), ...(config.allowBuild === true ? ['projectBuild'] : []), ...(config.allowWrite === true ? ['plcStart', 'plcStartAt', 'plcStopAt', 'plcHistory'] : [])];
    };

    const stopSession = async () => {
      startSeq++;
      clearInterval(flushTimer);
      flushTimer = null;
      queue = [];
      if (session) {
        const s = session;
        session = null;
        viewerCount--;
        await s.vars.close();
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
        if (m.type !== 'hello' || (typeof m.token !== 'string' && m.sso !== true)) return ws.close(4401, 'hello expected');
        // Signed in with the company account (the page's session cookie came with the connection)
        if (m.sso === true) {
          if (!ssoUser) {
            send({ type: 'denied', message: 'Sign in first (your session may have ended)' });
            return ws.close(4401, 'denied');
          }
          user = ssoUser;
          clearTimeout(helloTimer);
          log(`auth: ${user} connected from ${ip} (signed in)`);
          audit.add(user, 'sign-in', { ip, how: 'company account' });
          return send({ type: 'welcome', user, plcs: [...plcs.values()].map((p) => ({ id: p.id, name: p.name })), features: features() });
        }
        if (!auth.tokensAllowed()) {
          send({ type: 'denied', message: 'This gateway uses sign-in with company accounts: sign in instead of a token' });
          return ws.close(4401, 'denied');
        }
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
        audit.add(user, 'sign-in', { ip, how: 'token' });
        return send({ type: 'welcome', user, plcs: [...plcs.values()].map((p) => ({ id: p.id, name: p.name })), features: features() });
      }

      // Before going live on one of its PLCs (over connections of their own, closed after): a POU type's instances
      // there, the one to follow chosen first; the PLCs' states (the Live tab, while not live); one started, stopped,
      // restarted or set to Run mode (a write: allowWrite, writeUsers, as Start PLC)
      const ownConnection = (plc) => ({ netId: plc.netId, ip: plc.ip || undefined, port: Number(plc.port) || 851, localNetId: plc.localNetId || config.localNetId, localAdsPort: 32909 });
      if (m.type === 'liveInstances') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (config.allowBrowse === false) return send({ type: 'liveInstancesResult', requestId, error: 'Browsing the PLCs is turned off on this gateway' });
        const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
        if (!plc) return send({ type: 'liveInstancesResult', requestId, error: 'Choose one of the gateway\'s PLCs' });
        return void instancesAt(send, { requestId, connection: ownConnection(plc), typeName: m.typeName, stateVar: m.stateVar });
      }
      if (m.type === 'plcStates') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const list = (Array.isArray(m.plcs) ? m.plcs : []).slice(0, 32).map((id) => plcs.get(String(id))).filter(Boolean);
        const timeout = () => new Promise((r) => setTimeout(() => r({ error: 'no answer in time' }), 4000));
        const states = await Promise.all(list.map((p) => Promise.race([describePlc({ netId: p.netId, ip: p.ip || '' }, { plcPort: Number(p.port) || 851, localNetId: p.localNetId || config.localNetId, localAdsPort: 32909 }), timeout()])));
        return send({ type: 'plcStatesResult', requestId, devices: list.map((p, i) => ({ id: p.id, name: p.name, netId: p.netId, state: states[i] })) });
      }
      if (m.type === 'plcStartAt') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const writers = Array.isArray(config.writeUsers) ? config.writeUsers.map((u) => String(u).toLowerCase()) : null;
        if (config.allowWrite !== true || (writers && !writers.includes(String(user ?? '').toLowerCase()))) return send({ type: 'plcStartAtResult', requestId, state: null, ok: false, error: config.allowWrite !== true ? 'Writing to the PLC is turned off on this gateway (allowWrite)' : `${user ?? 'This account'} may not write to the PLCs of this gateway (writeUsers)` });
        const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
        const mode = ['plc', 'stop', 'restart', 'run'].includes(m.mode) ? m.mode : null;
        if (!plc || !mode) return send({ type: 'plcStartAtResult', requestId, state: null, ok: false, error: !plc ? 'Choose one of the gateway\'s PLCs' : 'Start, stop, restart or Run mode?' });
        return void startAt((r) => {
          // (in the audit log with what it answered: the Live tab's history of this PLC)
          audit.add(user, `plc.${mode === 'plc' ? 'start' : mode}`, { plc: plc.id, live: false, ok: r.ok, state: r.state ?? null, ...(r.error ? { error: String(r.error).slice(0, 200) } : {}) });
          log(`plc: ${user} ${{ plc: 'started', stop: 'stopped', restart: 'restarted', run: 'set Run mode on' }[mode]} ${plc.id}: ${r.ok ? r.state : r.error}`);
          send(r);
        }, { requestId, connection: ownConnection(plc), mode });
      }
      // What was done to one of its PLCs (started, stopped, restarted, Run mode; live or not): from its audit log, the
      // last 20 (limit: up to 500, for its CSV), for the users who may see its states (allowWrite: the actions exist
      // only then)
      if (m.type === 'plcHistory') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
        if (config.allowWrite !== true) return send({ type: 'plcHistoryResult', requestId, error: 'Starting and stopping PLCs is turned off on this gateway (allowWrite)' });
        if (!plc) return send({ type: 'plcHistoryResult', requestId, error: 'Choose one of the gateway\'s PLCs' });
        const modes = { 'plc.start': 'plc', 'plc.stop': 'stop', 'plc.restart': 'restart', 'plc.run': 'run' };
        const entries = audit
          .search({ from: Date.now() - 90 * 86400000, q: `"plc":"${plc.id}"`, limit: 2000 })
          .filter((e) => modes[e.action] && e.plc === plc.id)
          .slice(0, Math.min(500, Math.max(1, Number(m.limit) || 20)))
          .map((e) => ({ t: e.t, netId: plc.netId, name: plc.name, mode: modes[e.action], ok: e.ok !== false, state: e.state ?? null, ...(e.error ? { error: e.error } : {}), user: e.user, ...(e.live === false ? {} : { live: true }) }));
        return send({ type: 'plcHistoryResult', requestId, entries });
      }

      // Operator board: the machines of these PLCs (default: all), once a second
      if (m.type === 'boardWatch') {
        const ids = Array.isArray(m.plcs) && m.plcs.length ? m.plcs.filter((id) => plcs.has(id)).slice(0, 20) : [...plcs.keys()].slice(0, 20);
        const root = typeof m.root === 'string' && ads.isSymbolPath(m.root) ? m.root : 'MAIN.mainStateMachine';
        boardStop?.();
        boardStop = boards.watch(ids, root, boardViewer, send);
        log(`board: ${user} watches ${ids.join(', ') || '(no PLCs)'}`);
        return;
      }
      // Alert history: the latest alerts, then each new or changed one (alertEvent)
      if (m.type === 'alertsList') {
        send({ type: 'alertsList', events: alertLog.list() });
        alertsOff ??= alertLog.subscribe((event) => send({ type: 'alertEvent', event }));
        return;
      }
      // Saved boards (config.json "boards", the setup page edits them)
      if (m.type === 'boardList') return send({ type: 'boardList', boards: config.boards ?? [] });
      // Maintenance: a PLC's alerts muted for some minutes (0: ends it, or with id removes a planned window); from: planned
      if (m.type === 'maintenanceSet') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const minutes = Number(m.minutes);
        const from = m.from == null ? null : Number(m.from);
        if (!plcs.has(m.plc) || !Number.isFinite(minutes) || minutes < 0 || minutes > 7 * 24 * 60 || (from !== null && !(from > 0 && from < Date.now() + 90 * 86400000))) {
          return send({ type: 'maintenanceResult', requestId, ok: false, message: 'A PLC of this gateway, up to 7 days, starting within 90 days' });
        }
        const now = maintenance.set(m.plc, Math.round(minutes), user, typeof m.note === 'string' ? m.note : '', from, typeof m.id === 'string' ? m.id : undefined);
        return send({ type: 'maintenanceResult', requestId, ok: true, maintenance: now, planned: maintenance.planned(m.plc) });
      }
      // Shift report: the last shift, today, yesterday (summary and CSV)
      if (m.type === 'report') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const which = ['last', 'today', 'yesterday'].includes(m.which) ? m.which : 'last';
        try {
          const r = reports.report(which);
          audit.add(user, 'report', { which, alerts: r.summary.alerts });
          return send({ type: 'reportResult', requestId, summary: r.summary, csv: r.csv });
        } catch (err) {
          return send({ type: 'reportResult', requestId, error: err.message });
        }
      }
      // Availability of a recording's machines over time windows (days or shifts)
      if (m.type === 'recordingAvailability') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const wins = Array.isArray(m.windows) ? m.windows.filter((w) => w && Number(w.from) < Number(w.to) && Number(w.to) - Number(w.from) <= 31 * 86400000).slice(0, 62).map((w) => ({ label: String(w.label ?? '').slice(0, 40), from: Number(w.from), to: Number(w.to) })) : [];
        if (typeof m.id !== 'string' || !wins.length) return send({ type: 'recordingAvailability', requestId, error: 'A recording and time windows' });
        audit.add(user, 'availability', { recording: m.id, windows: wins.length });
        return send({ type: 'recordingAvailability', requestId, ...recorders.availability(m.id, wins) });
      }
      // Recordings on the gateway: the list, and one machine's values over a time window
      if (m.type === 'recordingsList') {
        let shifts = [];
        try {
          shifts = checkShifts(config.shifts);
        } catch {
          shifts = [];
        }
        return send({ type: 'recordingsList', requestId: Number.isInteger(m.requestId) ? m.requestId : 0, recordings: recorders.list(), shifts });
      }
      // State-time trends of one machine from a recording: per day and state (the latest 1 to 90 days)
      if (m.type === 'recordingStats') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const n = Number.isInteger(m.days) && m.days >= 1 && m.days <= 90 ? m.days : 14;
        if (typeof m.id !== 'string' || !ads.isSymbolPath(m.machine)) return send({ type: 'recordingStats', requestId, error: 'A recording and a machine' });
        return send({ type: 'recordingStats', requestId, ...recorders.stats(m.id, m.machine, n) });
      }
      if (m.type === 'recordingQuery') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const from = Number(m.from);
        const to = Number(m.to);
        if (typeof m.id !== 'string' || !ads.isSymbolPath(m.machine) || !(from < to) || to - from > 31 * 86400000) {
          return send({ type: 'recordingData', requestId, error: 'A recording, a machine and a time window of at most 31 days' });
        }
        log(`recordings: ${user} replays ${m.machine} from ${m.id}`);
        audit.add(user, 'replay', { recording: m.id, machine: m.machine, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
        return send({ type: 'recordingData', requestId, ...recorders.query(m.id, m.machine, from, to) });
      }
      if (m.type === 'alertAck') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const e = typeof m.id === 'string' ? alertLog.ack(m.id, user, typeof m.note === 'string' ? m.note : '') : null;
        if (e) audit.add(user, 'acknowledge', { alert: e.event, machine: e.machine, note: e.ack?.note ?? '' });
        return send({ type: 'alertAckResult', requestId, ok: !!e, event: e, message: e ? 'Acknowledged' : 'No such alert' });
      }
      // Guard variables of the running session: read like the state variable (a malformed request is ignored)
      if (m.type === 'liveWatch') {
        const vars = parseWatchRequest(m.vars, config.maxWatchedVariables ?? 100);
        if (!vars) return;
        if (session) session.vars.set(vars);
        else desiredVars = vars;
        return;
      }
      // Symbol browser: a symbol's members in the PLC this viewer follows (config.allowBrowse: false turns it off)
      if (m.type === 'liveBrowse') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const symbolPath = typeof m.path === 'string' ? m.path.trim() : '';
        const stateVar = typeof m.stateVar === 'string' && /^[A-Za-z_]\w*$/.test(m.stateVar) ? m.stateVar : 'machineState';
        if (config.allowBrowse === false) return send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: 'Symbol browsing is turned off on this gateway' });
        if (!ads.isSymbolPath(symbolPath)) return send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: 'Not a symbol path' });
        if (!session?.conn.client) return send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: 'Not connected' });
        try {
          session.conn.dtCache ??= new Map();
          send({ type: 'liveBrowseResult', requestId, ...(await ads.browseSymbol(session.conn.client, symbolPath, { stateVar, cache: session.conn.dtCache })) });
        } catch (err) {
          send({ type: 'liveBrowseResult', requestId, path: symbolPath, error: ads.adsErrorText(err) });
        }
        return;
      }
      // The PLC project's sources as the PLC keeps them (read-only: its boot folder), read once per PLC connection;
      // off with symbol browsing (config.allowBrowse: false) or on its own (config.allowSources: false)
      // Rebuild the PLC's project with the page's edits (TwinCAT XAE on the gateway's computer), write it back: only
      // when the gateway allows it (allowBuild; writing: allowWrite too), logged in the audit
      // The connected PLC's TwinCAT trial license (read-only)
      if (m.type === 'plcLicense') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (!session?.conn.client) return send({ type: 'plcLicenseResult', requestId, trial: null, state: null, error: 'Not connected' });
        const trial = await readTrialLicense(session.conn.client).catch(() => null);
        return send({ type: 'plcLicenseResult', requestId, trial, state: licenseState(trial) });
      }
      // The PLC application's state and online change count (did an online change from XAE take? read-only)
      if (m.type === 'plcAppInfo') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (!session?.conn.client) return send({ type: 'plcAppInfoResult', requestId, state: null, onlineChanges: null, error: 'Not connected' });
        return send({ type: 'plcAppInfoResult', requestId, ...(await plcAppInfo(session.conn.client)) });
      }
      // The PLC application started (after a write left it in Stop): a write, so allowWrite and writeUsers apply
      if (m.type === 'plcStart') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const writers = Array.isArray(config.writeUsers) ? config.writeUsers.map((u) => String(u).toLowerCase()) : null;
        if (config.allowWrite !== true || (writers && !writers.includes(String(user ?? '').toLowerCase()))) return send({ type: 'plcStartResult', requestId, state: null, ok: false, error: config.allowWrite !== true ? 'Writing to the PLC is turned off on this gateway (allowWrite)' : `${user ?? 'This account'} may not write to the PLCs of this gateway (writeUsers)` });
        if (!session?.conn.client) return send({ type: 'plcStartResult', requestId, state: null, ok: false, error: 'Not connected' });
        const plcId = session.conn.plc.id;
        const r = await startPlc(session.conn.client);
        audit.add(user, 'plc.start', { plc: plcId, ok: r.ok, state: r.state ?? null, ...(r.error ? { error: String(r.error).slice(0, 200) } : {}) });
        log(`plc: ${user} started ${session.conn.plc.id}: ${r.ok ? 'Run' : r.error}`);
        return send({ type: 'plcStartResult', requestId, ...r });
      }
      if (m.type === 'plcBuildClose') {
        if (config.allowBuild !== true) return send({ type: 'plcBuildClosed', requestId: Number.isInteger(m.requestId) ? m.requestId : 0, closed: false });
        return send({ type: 'plcBuildClosed', requestId: Number.isInteger(m.requestId) ? m.requestId : 0, closed: closeXae(typeof m.key === 'string' ? m.key : undefined) });
      }
      // A build, or a write, refused: turned off on this gateway (allowBuild, allowWrite), or not this user's (writeUsers)
      const buildRefused = (write) => {
        if (config.allowBuild !== true) return 'Building the PLC\'s project is turned off on this gateway (allowBuild)';
        if (write && config.allowWrite !== true) return 'Writing to the PLC is turned off on this gateway (allowWrite)';
        // (writeUsers: only these may write; builds stay open to everyone signed in)
        const writers = Array.isArray(config.writeUsers) ? config.writeUsers.map((u) => String(u).toLowerCase()) : null;
        if (write && writers && !writers.includes(String(user ?? '').toLowerCase())) {
          audit.add(user, 'plc.write.refused', { plc: session?.conn.plc?.id ?? null });
          return `${user ?? 'This account'} may not write to the PLCs of this gateway (writeUsers)`;
        }
        return null;
      };
      // Build from the page's project folder: its file list (which ones are needed), the files in pieces, the build
      if (m.type === 'projectSync' || m.type === 'projectPut') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const reply = m.type === 'projectSync' ? 'projectSyncResult' : 'projectPutResult';
        const refused = buildRefused(false);
        if (refused) return send({ type: reply, requestId, error: refused });
        let r;
        try {
          r = m.type === 'projectSync' ? mirror.sync(m.project, m.files) : mirror.put(String(m.uploadId ?? ''), m);
        } catch (err) {
          r = { error: err.message };
        }
        return send({ type: reply, requestId, ...r });
      }
      if (m.type === 'projectBuild') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const refused = buildRefused(!!m.write);
        if (refused) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: refused, items: [] });
        if (m.write != null && !['online', 'download', 'activate'].includes(m.write)) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'write: online, download or activate', items: [] });
        if (!session?.conn.client) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'Not connected', items: [] });
        const uploadId = String(m.uploadId ?? '');
        const fileAt = mirror.fullPath(uploadId, m.file);
        if (!fileAt) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'The project is not on the gateway yet: build again', items: [] });
        const edits = (Array.isArray(m.edits) ? m.edits : []).slice(0, 100).map((e) => ({ file: mirror.fullPath(uploadId, e?.file), content: e?.content })).filter((e) => e.file && typeof e.content === 'string');
        const conn = session.conn;
        if (conn.building) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'A build for this PLC is already running', items: [] });
        conn.building = true;
        audit.add(user, m.write ? 'plc.write' : 'plc.build', { plc: conn.plc.id, files: (m.edits ?? []).map((e) => String(e?.file ?? '')), write: m.write ?? null, from: 'project folder' });
        try {
          const r = await buildFromProject(conn.client, { file: fileAt, edits, write: m.write ?? null, netId: conn.plc.netId, adsPort: Number(conn.plc?.port) || 851, onStep: (text) => send({ type: 'plcBuildProgress', requestId, text }) });
          if (r.written) conn.sources = null;
          // Written: the new compile information back to the page (into its project folder)
          if (r.compileInfoFiles?.length) {
            const root = mirror.root(uploadId);
            r.compileInfo = r.compileInfoFiles.slice(0, 50).map((f) => {
              try {
                return { path: f, data: fs.readFileSync(path.join(root, f)).toString('base64') };
              } catch {
                return null;
              }
            }).filter(Boolean);
          }
          log(`build: ${user} ${m.write ? 'wrote to' : 'built for'} ${conn.plc.id} from a project folder: ${r.ok ? 'ok' : r.fatal ?? `${r.errors} error(s)`}`);
          send({ type: 'plcBuildResult', requestId, ...r });
        } catch (err) {
          send({ type: 'plcBuildResult', requestId, ok: false, fatal: err?.message ?? String(err), items: [] });
        } finally {
          conn.building = false;
        }
        return;
      }
      if (m.type === 'plcBuild') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const refused = buildRefused(!!m.write);
        if (refused) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: refused, items: [] });
        if (!session?.conn.client) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'Not connected', items: [] });
        const bad = checkEdits(m);
        if (bad) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: bad, items: [] });
        const conn = session.conn;
        if (conn.building) return send({ type: 'plcBuildResult', requestId, ok: false, fatal: 'A build for this PLC is already running', items: [] });
        conn.building = true;
        audit.add(user, m.write ? 'plc.write' : 'plc.build', { plc: conn.plc.id, files: (m.edits ?? []).map((e) => e.path), write: m.write ?? null });
        try {
          const r = await buildFromPlc(conn.client, { edits: m.edits, plcProject: typeof m.plcProject === 'string' ? m.plcProject : '', write: m.write ?? null, netId: conn.plc.netId, adsPort: Number(conn.plc?.port) || 851, onStep: (text) => send({ type: 'plcBuildProgress', requestId, text }) });
          if (r.written) conn.sources = null;
          log(`build: ${user} ${m.write ? `wrote to` : 'built for'} ${conn.plc.id}: ${r.ok ? 'ok' : r.fatal ?? `${r.errors} error(s)`}`);
          send({ type: 'plcBuildResult', requestId, ...r });
        } catch (err) {
          send({ type: 'plcBuildResult', requestId, ok: false, fatal: err?.message ?? String(err), items: [] });
        } finally {
          conn.building = false;
        }
        return;
      }
      // The PLC's I/O tree (read-only), with the sources' permission
      if (m.type === 'ioTree') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (config.allowBrowse === false || config.allowSources === false) return send({ type: 'ioTreeResult', requestId, error: 'Reading the PLC\'s configuration is turned off on this gateway' });
        if (!session?.conn.client) return send({ type: 'ioTreeResult', requestId, error: 'Not connected' });
        try {
          const { readIoTree } = require('../shared/tcIoTree.cjs');
          const { readBootFile } = require('../shared/tcSources.cjs');
          send({ type: 'ioTreeResult', requestId, ...(await readIoTree((rel) => readBootFile(session.conn.client, rel))) });
        } catch (err) {
          send({ type: 'ioTreeResult', requestId, error: ads.adsErrorText(err) });
        }
        return;
      }
      // A device's details for the I/O tab (read-only, this server): TwinCAT's device descriptions here, the pictures in
      // its Devices folder (config.devicesFolder, else Devices beside config.json), with the browser's permission
      if (m.type === 'deviceInfo') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (config.allowBrowse === false) return send({ type: 'deviceInfoResult', requestId, esi: null, images: [], folder: '', error: 'Turned off on this gateway' });
        const req = { productCode: String(m.productCode ?? ''), revision: String(m.revision ?? ''), type: String(m.deviceType ?? ''), product: String(m.product ?? '') };
        const folder = path.resolve(baseDir, config.devicesFolder || 'Devices');
        return send({ type: 'deviceInfoResult', requestId, ...require('../shared/tcDeviceInfo.cjs').deviceInfo(req, null, folder) });
      }
      // The EtherCAT masters' slave states (read-only), with the browser's permission (the connected PLC's own devices)
      if (m.type === 'ecatStates') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (config.allowBrowse === false) return send({ type: 'ecatStatesResult', requestId, error: 'Reading the PLC\'s I/O states is turned off on this gateway' });
        if (!session?.conn.client) return send({ type: 'ecatStatesResult', requestId, error: 'Not connected' });
        try {
          const { readMasters } = require('../shared/tcEcat.cjs');
          send({ type: 'ecatStatesResult', requestId, ...(await readMasters(session.conn.client, session.conn.plc.netId, m.netIds)) });
        } catch (err) {
          send({ type: 'ecatStatesResult', requestId, error: ads.adsErrorText(err) });
        }
        return;
      }
      if (m.type === 'plcSources') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (config.allowBrowse === false || config.allowSources === false) return send({ type: 'plcSourcesResult', requestId, error: 'Reading the PLC\'s sources is turned off on this gateway' });
        if (!session?.conn.client) {
          // (not live: one of the gateway's PLCs named, its sources read from its boot folder over a connection of
          // their own to its system service, then closed; its PLC need not run)
          const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
          if (!plc) return send({ type: 'plcSourcesResult', requestId, error: 'Not connected' });
          const [host, tcp] = (plc.ip || plc.netId.split('.').slice(0, 4).join('.')).split(':');
          const own = new Client({
            targetAmsNetId: plc.netId, targetAdsPort: 10000, routerAddress: host, routerTcpPort: Number(tcp) || 48898,
            localAmsNetId: plc.localNetId || config.localNetId, localAdsPort: 32907, rawClient: true, autoReconnect: false, timeoutDelay: 5000, hideConsoleWarnings: true,
          });
          try {
            await own.connect();
            const key = typeof m.plcProject === 'string' ? m.plcProject.slice(0, 100) : '';
            send({ type: 'plcSourcesResult', requestId, ...(await readPlcSources(own, Number(plc.port) || 851, { plcProject: key })) });
          } catch (err) {
            send({ type: 'plcSourcesResult', requestId, error: `${plc.name} did not answer (${ads.adsErrorText(err)}). Does the PLC have an ADS route to the gateway (AMS NetId ${plc.localNetId || config.localNetId})?` });
          } finally {
            await own.disconnect().catch(() => {});
          }
          return;
        }
        const conn = session.conn;
        try {
          // (per PLC project: plcProject, another one on the same target; read once each)
          const key = typeof m.plcProject === 'string' ? m.plcProject.slice(0, 100) : '';
          conn.sources ??= new Map();
          if (!conn.sources.has(key)) conn.sources.set(key, readPlcSources(conn.client, Number(conn.plc?.port) || 851, { plcProject: key }));
          const r = await conn.sources.get(key);
          if (r.error) conn.sources.delete(key);
          send({ type: 'plcSourcesResult', requestId, ...r });
        } catch (err) {
          conn.sources = null;
          send({ type: 'plcSourcesResult', requestId, error: ads.adsErrorText(err) });
        }
        return;
      }
      if (m.type === 'liveStop') {
        await stopSession();
        return send({ type: 'liveStatus', state: 'stopped', message: 'Not connected' });
      }
      if (m.type !== 'liveStart') return;
      await stopSession();
      desiredVars = null;
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
      // Monitor (another PLC in the Machine Overview): the connection for browsing and watched values, no state variable
      if (m.monitor === true) {
        try {
          await conn.connect();
          if (seq !== startSeq) return;
          conn.viewers.add(viewer);
          clearTimeout(conn.idleTimer);
          session = { conn, entry: null, vars: new VarWatcher(conn.client, send) };
          if (desiredVars) session.vars.set(desiredVars);
          viewerCount++;
          flushTimer = setInterval(() => {
            const values = session?.vars.drain();
            if (values) send({ type: 'liveVars', values });
          }, 50);
          log(`live: ${user} watches ${plc.id} (overview)`);
          send({ type: 'liveStatus', state: 'connected', message: `${plc.name} (PLC ${conn.plcState})`, target: plc.name, plcState: conn.plcState, instances: [], monitor: true });
        } catch (err) {
          if (seq !== startSeq) return;
          send({ type: 'liveStatus', state: 'error', message: err instanceof Error ? err.message : String(err), instances: [] });
        }
        return;
      }
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
        session = { conn, entry, vars: new VarWatcher(conn.client, send) };
        if (desiredVars) session.vars.set(desiredVars);
        viewerCount++;
        flushTimer = setInterval(() => {
          if (queue.length) send({ type: 'liveValues', events: queue.splice(0) });
          const values = session?.vars.drain();
          if (values) send({ type: 'liveVars', values });
        }, 50);
        log(`live: ${user} follows ${symbol} on ${plc.id} (${entry.viewers.size} viewer(s))`);
        audit.add(user, 'live', { plc: plc.id, symbol });
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
      mirror.dispose();
      boardStop?.();
      alertsOff?.();
      startSeq++;
      await stopSession();
      if (user) log(`auth: ${user} disconnected`);
    });
  });

  server.listen(config.port ?? 8443, () => {
    const scheme = config.insecure && !config.tls ? 'http' : 'https';
    log(`Kval MachineScope gateway ${VERSION} on ${scheme}://${os.hostname()}:${config.port ?? 8443}/ (${plcs.size} PLC(s), ${config.tokens.length} token(s))`);
    if (config.admin?.enabled !== false) log(`Setup page (PLCs, tokens), on this computer: ${scheme}://localhost:${config.port ?? 8443}/admin`);
  });
  // A malformed reply from a device can throw inside the ADS client's socket handling: drop the PLC connections
  // (viewers go live again) instead of stopping the gateway for everyone
  // (a failure in an async message handler: logged, not silent)
  process.on('unhandledRejection', (err) => log(`internal error (async): ${err?.stack ?? err}`));
  process.on('uncaughtException', async (err) => {
    log(`internal error: ${err?.stack ?? err}`);
    for (const c of connections.values()) {
      for (const v of c.viewers) v.lost('The gateway had an internal error: go live again');
      await c.close().catch(() => {});
    }
  });
  const shutdown = async () => {
    log('stopping');
    alerts.stop();
    boards.stop();
    recorders.stop();
    reports.stop();
    maintenance.stop();
    audit.stop();
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
