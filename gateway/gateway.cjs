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
const { readPlcSources, activeProjectOf } = require(`${sharedDir}/tcSources.cjs`);
const { buildFromPlc, buildFromProject, checkEdits, closeXae } = require(`${sharedDir}/tcBuild.cjs`);
const { ProjectMirror } = require(`${sharedDir}/projectMirror.cjs`);
const { readTrialLicense, licenseState } = require(`${sharedDir}/tcLicense.cjs`);
const { checkConnection } = require(`${sharedDir}/tcCheck.cjs`);
const { plcAppInfo, startPlc } = require(`${sharedDir}/tcAppInfo.cjs`);
const { instancesAt, startAt, localTwinCatNetId, defaultLocalNetId } = require(`${sharedDir}/liveSession.cjs`);
const { describePlc } = require(`${sharedDir}/tcPlcState.cjs`);
const { VarWatcher, parseWatchRequest } = require(`${sharedDir}/liveVars.cjs`);
const discovery = require(`${sharedDir}/tcDiscovery.cjs`);
const { createAdmin } = require('./admin.cjs');
const { createAlerts, checkRule, postWebhook } = require('./alerts.cjs');
const { createAuth } = require('./auth.cjs');
const { createAlertLog, createBoards, createMaintenance, mutedFor } = require('./board.cjs');
const { createBoardFilters } = require('./boardFilters.cjs');
const { createIoBoards } = require('./ioBoard.cjs');
const { SharedVars } = require('./sharedVars.cjs');
const { createLoad } = require('./load.cjs');
const { createDrives } = require('./drives.cjs');
const { createRoles, checkRoles, LABELS: ROLE_LABELS, PAGES: BOARD_PAGES, PAGE_LABELS, DEFAULT_PAGES, DEFAULT_LANGS } = require('./roles.cjs');
const { createFaults } = require('./faults.cjs');
const { createFleet } = require('./fleet.cjs');
const { risks: risksOf, inventory: inventoryOf } = require('./risk.cjs');
const { createRecorders, checkRecording } = require('./recorder.cjs');
const { createAudit } = require('./audit.cjs');
const { createProjectSync } = require('./projectSync.cjs');
const { createReports, checkShifts, shiftWindows } = require('./report.cjs');
const { createOee, withCounters } = require('./oee.cjs');
const { createHandover } = require('./handover.cjs');
const { createRecovery } = require('./recovery.cjs');
const { createEventLog } = require('./eventlog.cjs');
const { createSpares } = require('./spares.cjs');
const { createPush } = require('./push.cjs');
const { createPm } = require('./pm.cjs');
const { alarmHealth } = require('./alarmHealth.cjs');
const { sendEmail, sendSms } = require('./channels.cjs');
const { createChanges } = require('./changes.cjs');
const { createAxes } = require('./axes.cjs');
const { createAnomalies } = require('./anomaly.cjs');
const { createSites } = require('./sites.cjs');
const { createExports } = require('./exports.cjs');
const { createBackup } = require('./backup.cjs');
const { createCerts } = require('./certs.cjs');
const { zipOf } = require('./support.cjs');
const { createWorkOrders, reliability } = require('./workorders.cjs');
const { createAttachments } = require('./attachments.cjs');
const { lastTime } = require('./lastTime.cjs');
const { maintenanceKpis } = require('./kpis.cjs');
const { createShelves } = require('./shelves.cjs');
const { createEngineering } = require('./engineering.cjs');
const { createSupport } = require('./support.cjs');
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

// The log: the console, and (running: start) gateway.log beside config.json, read when it runs without a console (Run
// at startup's task, as SYSTEM); at 5 MB it moves to gateway.log.1 (the one before it dropped)
const logFile = path.join(path.dirname(configPath), 'gateway.log');
const log = (...a) => {
  const line = `${new Date().toISOString()} ${require('util').format(...a)}`;
  console.log(line);
  if (process.argv[2] !== 'start') return;
  try {
    if ((fs.statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
    fs.appendFileSync(logFile, `${line}\r\n`);
  } catch {
    // (a log that cannot be written: the console's only)
  }
};
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    console.error(`No configuration at ${configPath}: run "node gateway.cjs init" first.`);
    process.exit(1);
  }
  // (saved with a BOM by an editor or PowerShell: read all the same)
  return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
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
    // (TwinCAT on this computer has its IP + .1.1 already: the gateway's own is .1.2 then)
    localNetId: defaultLocalNetId(ip),
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
  console.log(` 2. On each PLC, add an ADS route to this computer: AMS NetId ${config.localNetId}, address ${ip}. A PLC on this computer`);
  console.log('    (TwinCAT here) needs none: its address 127.0.0.1, its AMS NetId TwinCAT\'s own.');
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
// A PLC on the gateway's own computer (TwinCAT there: the PLC's NetId is its own, or its address is 127.0.0.1, localhost
// or one of this computer's): reached through the local TwinCAT router, as the desktop app does. A connection with the
// gateway's own NetId to this computer's router is refused (no route to itself), so the gateway could not reach a PLC
// running beside it. A forwarded or simulated ADS port (not 48898) is used as given.
const ownAddresses = () => new Set(Object.values(os.networkInterfaces()).flat().filter(Boolean).map((a) => a.address));
function isLocalPlc(plc, { twinCatNetId = localTwinCatNetId(), addresses = ownAddresses() } = {}) {
  const [host, tcp] = String(plc.ip || String(plc.netId).split('.').slice(0, 4).join('.')).split(':');
  if ((Number(tcp) || 48898) !== 48898) return false;
  if (/^(127\.\d+\.\d+\.\d+|localhost)$/i.test(host)) return true;
  if (!twinCatNetId) return false;
  return plc.netId === twinCatNetId || addresses.has(host);
}
/** ads-client's options to reach a PLC's port: through the local router (a PLC here), else straight with the gateway's NetId */
function adsTarget(plc, adsPort, localNetId, localAdsPort) {
  if (isLocalPlc(plc)) return { targetAmsNetId: plc.netId, targetAdsPort: adsPort, routerAddress: '127.0.0.1', routerTcpPort: 48898 };
  const [host, tcp] = String(plc.ip || String(plc.netId).split('.').slice(0, 4).join('.')).split(':');
  return { targetAmsNetId: plc.netId, targetAdsPort: adsPort, routerAddress: host, routerTcpPort: Number(tcp) || 48898, localAmsNetId: localNetId, localAdsPort };
}
/** The shared helpers' connection to a PLC: a PLC here through the local router (no NetId of the gateway's own) */
const sharedConnection = (plc, localNetId, extra = {}) => (isLocalPlc(plc) ? { netId: plc.netId, ip: '127.0.0.1', port: Number(plc.port) || 851 } : { netId: plc.netId, ip: plc.ip || undefined, port: Number(plc.port) || 851, localNetId, ...extra });

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
    // (its symbol version: a change is another program; read again on each connection)
    this.symbolVersion = null;
  }

  /** Its shared notifications (sharedVars.cjs): one per variable for the boards, alarms, recordings, live sessions */
  sharedVars() {
    if (!this.client) return null;
    if (this.shared?.client !== this.client) this.shared = new SharedVars(this.client, ads);
    return this.shared;
  }

  async connect() {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    const [host] = (this.plc.ip || this.plc.netId.split('.').slice(0, 4).join('.')).split(':');
    const client = new Client({
      ...adsTarget(this.plc, this.plc.port || 851, this.localNetId, 32905),
      rawClient: true,
      autoReconnect: false,
      timeoutDelay: 3000,
      hideConsoleWarnings: true,
    });
    this.connecting = (async () => {
      try {
        await client.connect();
      } catch (err) {
        // (no TCP connection at all: the PLC off, another address, or TCP 48898 blocked; a route is asked for only once
        // its router answers)
        const text = ads.adsErrorText(err);
        const noTcp = /Connecting to .* failed|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|No response from target/i.test(text);
        throw new Error(`${this.plc.name} (${host}) did not accept the connection: ${text}. ${noTcp ? `Nothing answers at ${host} (TCP 48898): is the PLC on, its address right, TCP 48898 open on its firewall and on the way?` : `Does the PLC have an ADS route to the gateway (AMS NetId ${this.localNetId})?`}`);
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
      // Another program (a download, an activation): its viewers connect again (the old handles are gone), the
      // symbol browser's types read anew
      const version = await ads.symbolVersion(this.client);
      if (version !== null) {
        const changed = this.symbolVersion != null && version !== this.symbolVersion;
        this.symbolVersion = version;
        if (changed) {
          this.dtCache = null;
          log(`ads: ${this.plc.id}: the program changed (symbol version ${version})`);
          for (const v of this.viewers) v.send({ type: 'liveStatus', state: 'programChanged', plcState: state, message: "The PLC's program changed (a download or an activation)" });
        }
      }
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
    this.symbolVersion = null;
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
  '.webmanifest': 'application/manifest+json',
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
  res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') || file.endsWith('sw.js') || file.endsWith('.webmanifest') ? 'no-cache' : 'max-age=3600' });
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
    // (with the new settings' part counters, product variables, energy meters)
    config.energy = next.energy;
    config.backup = next.backup;
    recorders?.apply(withCounters(config.recordings, next.oee, next.energy));
    config.oidc = next.oidc;
    config.boardEditors = next.boardEditors;
    config.drives = next.drives;
    drives?.apply();
    config.axes = next.axes;
    config.anomalies = next.anomalies;
    config.sites = next.sites;
    config.tls = next.tls;
    config.mqtt = next.mqtt;
    config.cmms = next.cmms;
    config.api = next.api;
    config.publicUrl = next.publicUrl;
    exportsApi?.apply();
    sites?.apply();
    axes?.apply();
    config.roles = next.roles;
    config.faults = next.faults;
    faults?.apply();
    config.fleet = next.fleet;
    fleet?.apply();
    // (read where they are used: taken as they are saved, without a restart)
    config.projectSync = next.projectSync;
    config.oee = next.oee;
    config.andon = next.andon;
    config.workorders = next.workorders;
    config.smtp = next.smtp;
    config.sms = next.sms;
    config.push = next.push;
    configMtime = mtime();
    // (the boards: which machines are recorded or alarmed now)
    for (const fn of boardRuleListeners) fn();
  };
  const boardRuleListeners = new Set();
  // config.json read fresh, changed and written whole (a temporary file renamed over it), then applied: the board's
  // recordings and alarms (the setup page does the same)
  const updateConfig = (change) => {
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    change(onDisk);
    const tmp = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2) + '\n');
    fs.renameSync(tmp, configPath);
    applyConfig(onDisk);
    return onDisk;
  };
  // Alerts: the machines of the rules' PLCs followed by the gateway itself (webhooks when stuck / in error)
  let alerts = null;
  let recorders = null;
  let drives = null;
  let axes = null;
  let sites = null;
  let faults = null;
  let fleet = null;
  setInterval(() => {
    if (mtime() === configMtime) return;
    try {
      applyConfig(JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')));
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
    const route = isLocalPlc(plc) ? 'It is on this computer: is TwinCAT running here (the TwinCAT router), and is that its AMS NetId?' : `Does the PLC have an ADS route to the gateway: AMS NetId ${localNetId}, address ${net?.address ?? 'this computer\'s IP address'}?`;
    let client = [...connections.values()].find((c) => c.client && c.plc.netId === plc.netId)?.client;
    let own = null;
    if (!client) {
      own = new Client({ ...adsTarget(plc, 10000, localNetId, 32906), rawClient: true, autoReconnect: false, timeoutDelay: 2000, hideConsoleWarnings: true });
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
  // Roles (roles.cjs): who may do what, their start pages, who is told of what
  const roles = createRoles({ getConfig: () => config, postWebhook, log, sendEmail: (x) => sendEmail(config.smtp, x), sendSms: (x) => sendSms(config.sms, x) });
  // (who is told: the roles' channels, the devices subscribed to push notifications)
  let push = null;
  let exportsApi = null;
  const notifyAll = (e) => {
    roles.notify(e);
    exportsApi?.alert(e);
    if (push) void push.notify(e).catch((err) => log(`push: ${err.message}`));
  };
  const alertLog = createAlertLog({ file: path.join(baseDir, 'alerts-history.json'), log, rules: rulesNow, onNew: notifyAll });
  // Maintenance (set on the board: a PLC's alerts muted until a time)
  // Audit log: who did what (audit-YYYY-MM.jsonl next to config.json)
  const audit = createAudit({ dir: baseDir, log });
  // Alarm shelving (ISA-18.2): a shelved alarm is logged muted, whoever raises it (rules, drives, axes, anomalies)
  const shelves = createShelves({ baseDir, getConfig: () => config, log, audit, onEvent: (e) => alertLog.add(e) });
  const addAlert = alertLog.add;
  alertLog.add = (e) => addAlert(shelves.apply(e));
  // Push notifications (push.cjs): the board's alerts on devices, the board closed
  push = createPush({ baseDir, getConfig: () => config, log, audit });
  const maintenance = createMaintenance({ file: path.join(baseDir, 'maintenance.json'), log, rules: rulesNow, plcOf, audit });
  // The notes written live through this gateway (the Live tab's + Note: the audit log's live.event "note"), the last
  // 24 h per PLC, newest first: on the board's PLCs (a minute's cache; a new one drops it)
  let notesCache = null;
  const notesOf = (plcId) => {
    if (!notesCache || Date.now() - notesCache.at > 60000) {
      const by = new Map();
      for (const e of audit.search({ from: Date.now() - 24 * 3600_000, q: '"kind":"note"', limit: 500 })) {
        if (e.action !== 'live.event' || e.kind !== 'note' || typeof e.plc !== 'string') continue;
        if (!by.has(e.plc)) by.set(e.plc, []);
        if (by.get(e.plc).length < 5) by.get(e.plc).push({ t: e.at ?? e.t, user: e.user, text: e.text, pou: e.pou || undefined });
      }
      notesCache = { at: Date.now(), by };
    }
    return notesCache.by.get(plcId) ?? [];
  };
  const boards = createBoards({ connectionFor, plcOf, rules: rulesNow, log, retryMs: config.alertRetryMs ?? 30000, maintenance, notesOf });
  // The board's saved filters (board-filters.json) and its I/O page's monitors (ioBoard.cjs)
  const boardFilters = createBoardFilters({ file: path.join(baseDir, 'board-filters.json'), log, audit });
  const ioBoards = createIoBoards({ connectionFor, plcOf, log, sharedDir, retryMs: config.alertRetryMs ?? 30000 });
  // (who may save filters, recordings and alarms from the board: everyone signed in (not a view-only token), or the
  // users of config.boardEditors)
  const canEditBoard = (user, viewOnly) => !viewOnly && (!Array.isArray(config.boardEditors) || config.boardEditors.map((u) => String(u).toLowerCase()).includes(String(user ?? '').toLowerCase()));
  // The recordings and alarms as the board shows them (which machines and signals each one covers)
  const boardRules = () => ({
    alarms: (config.alerts ?? []).map((r) => ({ id: r.id, name: r.name, enabled: r.enabled !== false, plc: r.plc, root: r.root, machines: Array.isArray(r.machines) ? r.machines : null, stuckAfterMs: r.stuckAfterMs ?? null, onError: r.onError !== false, webhook: !!r.webhook, fromBoard: r.fromBoard ?? null })),
    recordings: (config.recordings ?? []).map((r) => ({ id: r.id, name: r.name, enabled: r.enabled !== false, plc: r.plc, root: r.root, machines: Array.isArray(r.machines) ? r.machines : null, vars: r.vars ?? [], days: r.days, fromBoard: r.fromBoard ?? null })),
  });
  alerts = createAlerts({ connectionFor, plcOf, log, retryMs: config.alertRetryMs ?? 30000, onEvent: (e) => alertLog.add(e), maintenanceOf: (id) => maintenance.get(id), shelvedOf: (plc, machine, state) => shelves.why(plc, machine, state) });
  alerts.apply(config.alerts ?? []);
  // Escalation: open alerts not acknowledged in time, posted again
  const muted = mutedFor(maintenance);
  setInterval(() => alertLog.escalate(Date.now(), muted), config.escalationCheckMs ?? 30000).unref();
  // Recordings on the gateway (config.recordings)
  // (anomalies, live: each machine's stays and transitions as the recordings take them)
  let anomalies = null;
  recorders = createRecorders({ dir: path.join(baseDir, 'recordings'), connectionFor, plcOf, log, retryMs: config.alertRetryMs ?? 30000, rules: rulesNow, maintenance, onEvent: (e) => alertLog.add(e), audit, onStateSample: (rule, m, v, t) => {
      anomalies?.sample(rule.id, m, v, t);
      exportsApi?.state(rule.plc, m.path, m.stateNames?.[String(v)] ?? v, t);
    } });
  anomalies = createAnomalies({ recorders, getConfig: () => config, log, onEvent: (e) => alertLog.add(e) });
  recorders.apply(withCounters(config.recordings ?? [], config.oee, config.energy));
  // Shift reports (config.shifts, config.reports.webhook): posted when a shift ends; the board downloads them
  const maintenanceOfAll = (from, to) => [...plcs.keys()].flatMap((id) => maintenance.windowsBetween(id, from, to).map((w) => ({ plc: id, from: new Date(w.from).toISOString(), until: new Date(w.until).toISOString() })));
  // (the notes written live through this gateway in a report's window: the audit log's live.event "note")
  const notesBetween = (from, to) =>
    audit
      .search({ from, to, q: '"kind":"note"', limit: 1000 })
      .filter((e) => e.action === 'live.event' && e.kind === 'note')
      .map((e) => ({ t: e.at ?? e.t, user: e.user, plc: e.plc, pou: e.pou, text: e.text }));
  // The PLCs' projects kept here (PlcProjects/<plc id>/), the PLC's copy the golden one (projectSync.cjs): over the
  // PLC's live connection when there is one (a second one from the same NetId could take its route), else one of its own
  // Several gateways in one view (sites.cjs): the plant's other gateways, followed as displays
  sites = createSites({ getConfig: () => config, log });
  sites.start();
  // Change control (changes.cjs): each change of a PLC's program (seen by the project copy), explained, approved
  const changes = createChanges({ baseDir, log, audit, notify: notifyAll, rolesOn: () => roles.enabled() });
  const projectSync = createProjectSync({
    onVersion: (c) => changes.add(c),
    baseDir,
    getConfig: () => config,
    plcList: () => [...plcs.values()],
    clientFor: async (plc) => {
      const live = [...connections.values()].find((c) => c.client && c.plc.id === plc.id)?.client;
      // (the live one when it still answers: after the PLC restarted, it may not yet know it is gone)
      if (live && (await live.readState().then(() => true).catch(() => false))) return { client: live, own: false };
      const own = new Client({ ...adsTarget(plc, Number(plc.port) || 851, plc.localNetId || config.localNetId, 32908), rawClient: true, autoReconnect: false, timeoutDelay: 10000, hideConsoleWarnings: true });
      await own.connect();
      return { client: own, own: true };
    },
    ads,
    sources: require(`${sharedDir}/tcSources.cjs`),
    log,
    audit,
  });
  projectSync.start();
  // The drives' health (drives.cjs): each PLC's drives read by the gateway itself; the load panel's numbers (load.cjs)
  drives = createDrives({ baseDir, getConfig: () => config, plcList: () => [...plcs.values()], connectionFor, sharedDir, ads, log, onEvent: (e) => alertLog.add(e), postWebhook, onSettingsChange: (c) => changes.add(c) });
  drives.start();
  // Servo axis health (axes.cjs): each AXIS_REF's following error and torque against its own past, NC errors
  axes = createAxes({ baseDir, getConfig: () => config, plcList: () => [...plcs.values()], connectionFor, ads, log, onEvent: (e) => alertLog.add(e) });
  axes.start();
  // The fault recorder (faults.cjs): each PLC's last minute kept, a fault's minute before and after saved
  faults = createFaults({ baseDir, getConfig: () => config, plcList: () => [...plcs.values()], connectionFor, log, retryMs: config.alertRetryMs ?? 30000 });
  faults.start();
  // The fleet (fleet.cjs): every I/O box, its state over the days; the risk list (risk.cjs) from it, the drives, the alerts
  fleet = createFleet({ baseDir, getConfig: () => config, plcList: () => [...plcs.values()], connectionFor, sharedDir, ads, log });
  fleet.start();
  // OEE and downtime (oee.cjs): from the recordings, the reasons operators give, the weekly summary
  const shiftsNow = () => {
    try {
      return checkShifts(config.shifts);
    } catch {
      return checkShifts(null);
    }
  };
  const oee = createOee({ baseDir, getConfig: () => config, recorders, rules: rulesNow, shiftWindowsOf: (f, t) => shiftWindows(shiftsNow(), f, t), log, audit, postWebhook });
  const downtimeListeners = new Set();
  // The andon's "what to do": each state's description in the PLC's sources (the copy kept here when in step), read
  // once every 10 minutes per PLC; config.andon.steps over them
  const andonSources = new Map();
  const sourceFilesOf = (plc) => {
    const hit = andonSources.get(plc.id);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.p;
    const p = (async () => {
      const conn = connectionFor(plc);
      await conn.connect();
      const r = (await projectSync.storedSources(plc, conn.client, '').catch(() => null)) ?? (await readPlcSources(conn.client, Number(plc.port) || 851));
      return r.files ?? [];
    })();
    andonSources.set(plc.id, { at: Date.now(), p });
    p.catch(() => andonSources.delete(plc.id));
    return p;
  };
  const CALL_REASONS = ['Mechanical', 'Electrical', 'Material', 'Quality', 'Safety', 'Other'];
  // Work orders (workorders.cjs): kept in workorders.json, told to the roles that want them
  const workOrders = createWorkOrders({ file: path.join(baseDir, 'workorders.json'), getConfig: () => config, log, audit, notify: notifyAll });
  // (photos and PDFs on work orders, calls, handovers: attachments/ beside config.json)
  const attachments = createAttachments({ baseDir, log, audit });
  // Variables read once (the recovery guides' checks): through the PLC's connection (borrowed: held by none, let go)
  const readVarsOnce = async (plcId, vars) => {
    const plc = plcs.get(plcId);
    if (!plc) throw new Error(`No PLC "${plcId}"`);
    const conn = connectionFor(plc);
    const viewer = { send: () => {}, push: () => {}, lost: () => {} };
    await conn.connect();
    conn.viewers.add(viewer);
    clearTimeout(conn.idleTimer);
    try {
      const out = {};
      for (const v of vars) {
        try {
          const info = await ads.probe(conn.client, v);
          if (!info) {
            out[v] = { error: 'not in the PLC' };
            continue;
          }
          const handle = await ads.createHandle(conn.client, v);
          try {
            out[v] = { value: await ads.readTyped(conn.client, handle, info) };
          } finally {
            await ads.releaseHandle(conn.client, handle).catch(() => {});
          }
        } catch (err) {
          out[v] = { error: ads.adsErrorText(err) };
        }
      }
      return out;
    } finally {
      conn.viewers.delete(viewer);
      if (conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
    }
  };
  // Guided recovery (recovery.cjs): the steps to bring a stopped machine back, their checks read from the PLC
  const recovery = createRecovery({ baseDir, log, audit, readVars: readVarsOnce });
  // Preventive maintenance (pm.cjs): plans by days or operating hours (a drive's own, a PLC counter's), their work
  // orders made by themselves when due
  const pm = createPm({
    baseDir, getPlc: (id) => plcs.get(id), workOrders, readVars: readVarsOnce, log, audit,
    hoursOfDrive: (plcId, x) => {
      const d = drives.view([plcId])[0]?.drives.find((v) => v.path === x || v.name.toLowerCase() === String(x).toLowerCase());
      return typeof d?.latest?.opHours?.v === 'number' ? d.latest.opHours.v : null;
    },
  });
  // TwinCAT logged events (eventlog.cjs): imported on the setup page, shown with the fault records
  const eventLog = createEventLog({ baseDir, log, audit });
  // Spare parts (spares.cjs): the stock kept for the machines; a work order done takes the parts it used
  const spares = createSpares({ baseDir, log, audit, notify: notifyAll });
  // Shift handover (handover.cjs): the shift's summary and a note, handed to the next shift
  const handover = createHandover({ baseDir, shiftWindowsOf: (f, t) => shiftWindows(shiftsNow(), f, t), alertLog, workOrders, oee, drives, log, audit, notify: notifyAll });
  // Exports (exports.cjs): the REST/JSON API, MQTT, the CMMS hook
  exportsApi = createExports({
    baseDir, getConfig: () => config, log, audit, sha256, workOrders, publicUrl: () => String(config.publicUrl ?? '').replace(/\/+$/, ''),
    data: {
      plcs: () => [...plcs.values()].map((p) => ({ id: p.id, name: p.name, connected: !!connections.get(p.id)?.client, plcState: connections.get(p.id)?.plcState ?? null })),
      alerts: (n) => alertLog.list(n),
      workOrders: () => workOrders.list(),
      oee: (q) => oee.report(q),
      drives: () => drives.view(),
      axes: () => axes?.view() ?? [],
      risks: () => fleetState().risks,
      changes: () => changes.list(500),
    },
  });
  exportsApi.apply();
  // The Engineering page (engineering.cjs): state timing, transitions, compare, what changed in the PLC projects
  const engineering = createEngineering({ recorders, projectsDir: () => path.resolve(baseDir, String(config.projectSync?.folder || 'PlcProjects')), sources: require(`${sharedDir}/tcSources.cjs`) });
  // The support bundle (support.cjs): what support needs, in one zip, by a link that expires
  const support = createSupport({ baseDir, log, audit });
  const supportFiles = (hours, withFaults, user) => {
    const since = Date.now() - hours * 3600_000;
    const j = (x) => JSON.stringify(x, null, 2);
    const files = {
      'gateway.json': j({ gateway: 'Kval MachineScope', version: VERSION, host: os.hostname(), at: new Date().toISOString(), uptimeS: Math.round(process.uptime()), node: process.version, platform: `${os.platform()} ${os.release()}`, by: user, hours }),
      'config.json': j(support.sanitized(config)),
      'load.json': j(load.snapshot()),
      'alerts.json': j(alertLog.all().filter((a) => Date.parse(a.at) >= since)),
      'faults.json': j(faults.list({ since, limit: 500 })),
      'drives.json': j(drives.view()),
      'fleet.json': j(fleetState([])),
      'projects.json': j(projectSync.list()),
      'workorders.json': j(workOrders.list().filter((o) => (o.status !== 'done' && o.status !== 'cancelled') || Date.parse(o.doneAt ?? o.createdAt) >= since)),
      'recordings.json': j(recorders.list().map((r) => ({ ...r, machines: r.machines.map((x) => ({ path: x.path, type: x.type })) }))),
      'audit.jsonl': audit.search({ from: since, limit: 5000 }).map((e) => JSON.stringify(e)).join('\n'),
    };
    if (withFaults) for (const f of faults.list({ since, limit: 50 })) {
      const r = faults.get(f.id);
      if (r) files[`faults/${f.id}.json`] = JSON.stringify(r);
    }
    // (the end of its log: the last 2 MB)
    try {
      const lf = path.join(baseDir, 'gateway.log');
      const st = fs.statSync(lf);
      const fd = fs.openSync(lf, 'r');
      const n = Math.min(st.size, 2 * 1024 * 1024);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, st.size - n);
      fs.closeSync(fd);
      files['gateway.log'] = buf;
    } catch {
      // (no log file: started by hand)
    }
    return files;
  };
  const peopleOf = () => [...new Set([...Object.keys(config.roles?.users ?? {}), ...(config.tokens ?? []).filter((t) => !t.view).map((t) => t.name)])].sort();
  const oeeConfig = () => {
    const s = oee.settings();
    return { type: 'oeeConfig', reasons: s.reasons, reasonAfterMin: s.reasonAfterMin, given: oee.recent().map((e) => `${e.plc}|${e.machine.toLowerCase()}|${e.from}`) };
  };
  const fleetState = (ids) => {
    const f = fleet.view().filter((p) => !ids?.length || ids.includes(p.id));
    const d = drives.view(ids);
    return { type: 'fleetState', at: Date.now(), risks: risksOf({ drives: d, daily: drives.daily(), fleet: f, alerts: alertLog.list(1000).filter((a) => !ids?.length || ids.includes(a.plc)), limits: config.fleet?.limits ?? {} }), inventory: inventoryOf(f), plcs: f.map((p) => ({ id: p.id, name: p.name, state: p.state, message: p.message })) };
  };
  const load = createLoad({ connections: () => [...connections.entries()], plcOf, plcList: () => [...plcs.values()], ads, log });
  // (From PLC: the copy kept here when it is in step with the PLC, else null: read from the PLC; logged once a minute)
  let keptSaid = 0;
  const keptSources = async (plc, client, key) => {
    if (!plc) return null;
    const r = await projectSync.storedSources(plc, client, key).catch(() => null);
    if (r && Date.now() - keptSaid > 60000) {
      keptSaid = Date.now();
      log(`projects: ${plc.id}: sources from the copy kept here (in step with the PLC)`);
    }
    return r;
  };
  const reports = createReports({ file: path.join(baseDir, 'reports.json'), getConfig: () => config, events: () => alertLog.all(), maintenanceOf: maintenanceOfAll, log, audit, notes: notesBetween, sendEmail: (x) => sendEmail(config.smtp, x), more: (from, to) => handover.summary(from, to, []), link: () => (config.publicUrl ? `${String(config.publicUrl).replace(/\/+$/, '')}/?board` : '') });
  // Run at startup (Windows): the gateway as a scheduled task
  const service = createService({ configPath, log, audit });
  // The gateway's certificate (certs.cjs): shown, renewed, a CSR, installed; taken at once
  let setCertContext = null;
  const certs = createCerts({ baseDir, getConfig: () => config, update: updateConfig, log, audit, notify: notifyAll, setContext: (o) => setCertContext?.(o) });
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
    checkPlc: (plc) => checkConnection({ netId: plc.netId, ip: isLocalPlc(plc) ? '127.0.0.1' : plc.ip, adsPort: plc.port || 851, localNetId: isLocalPlc(plc) ? '' : plc.localNetId || config.localNetId || '', discoveryPort: Number(process.env.KSS_DISCOVERY_PORT) || 48899 }),
    discover: discovery.discover,
    localNetworks: discovery.localNetworks,
    sha256,
    version: VERSION,
    log,
    recordings: { list: () => recorders.list(), check: checkRecording, checkSlowerNow: (id) => recorders.checkSlowerNow(id) },
    audit,
    reports: { checkShifts, report: (which) => reports.report(which), send: (which) => reports.send(which), emailNow: (which) => reports.emailNow(which) },
    projects: projectSync,
    driveCheck: (b) => drives.check(b),
    findMeters: (plcId) => drives.findMeters(plcId),
    certs,
    backup: createBackup({ baseDir, configPath, zipOf, unzip: require(`${sharedDir}/tcSources.cjs`).unzip, log, audit, getConfig: () => config, onEvent: (e) => alertLog.add(e) }),
    restart: async () => {
      // (its Windows task restarts it within a minute; else it is started again by hand)
      const st = await service.status().catch(() => ({ installed: false }));
      // (the task this gateway's own: it runs this config.json)
      if (!st.installed || !String(st.runs ?? '').toLowerCase().includes(String(configPath).toLowerCase())) throw new Error('This gateway does not run as its Windows task: start it again by hand');
      log('gateway: restarting (the setup page): its task starts it again within a minute');
      setTimeout(() => process.exit(0), 800).unref();
      return { ok: true };
    },
    sitesView: () => sites.view(),
    mqttReady: () => exportsApi?.mqtt.ready() ?? false,
    channels: { sendEmail: (smtp, x) => sendEmail(smtp, x), sendSms: (sms, x) => sendSms(sms, x) },
    eventLog: { import: (plc, csv, user) => eventLog.import(plc, csv, user), stats: () => eventLog.stats([...plcs.keys()]) },
    load: () => ({ ...load.snapshot(), drives: drives.stats(), axes: axes.stats(), faults: faults.stats(), fleet: fleet.stats(), projects: (config.projectSync?.enabled === false ? [] : config.projectSync?.plcs?.length ? config.projectSync.plcs : [...plcs.keys()]) }),
    roles: { check: checkRoles, filters: () => boardFilters.list().map((f) => ({ id: f.id, name: f.name, audience: f.audience })), labels: ROLE_LABELS, pages: BOARD_PAGES, pageLabels: PAGE_LABELS, pageDefaults: DEFAULT_PAGES, langDefaults: DEFAULT_LANGS },
    service: { status: () => service.status(), install: () => service.install('setup page'), remove: () => service.remove('setup page'), switchToTask: () => service.switchToTask('setup page', () => shutdown()) },
    alerts: { status: () => alerts.status(), checkRule, test: (webhook, format) => postWebhook(webhook, format, { event: 'test', text: `Kval MachineScope gateway on ${os.hostname()}: a test message from its setup page`, at: new Date().toISOString() }, log) },
  });
  const auth = createAuth({ getConfig: () => config, log, secure: !!(config.tls?.pfx || config.tls?.cert) });
  // (an https server takes a new certificate at once)
  setCertContext = (o) => {
    if (typeof server?.setSecureContext === 'function') server.setSecureContext(o);
    else log('certs: the gateway runs without TLS ("insecure"): its certificate is taken when it starts with one');
  };
  const handleRequest = async (req, res) => {
    if (await auth.handle(req, res)) return;
    // (a support bundle's link: /support/<id>.zip?key=…)
    if (support.serve(req, res)) return;
    // (the REST/JSON API: /api/v1/…, a token as its bearer)
    if (exportsApi?.handle(req, res)) return;
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
  // (1 MB: a photo of a work order, at most 512 KB, as base64)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
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
    const ssoGroups = auth.groupsOf?.(req) ?? [];
    // Operator board and alert history of this connection
    let boardStop = null;
    let alertsOff = null;
    // (its board's saved filters and rules followed; its I/O page)
    let filtersOff = null;
    let rulesOff = null;
    let ioWatch = null;
    const ioViewer = {};
    // (its board's Drives page; the faults kept, told as they come)
    let drivesOff = null;
    let axesOff = null;
    let faultsOff = null;
    let fleetTimer = null;
    let downtimeOff = null;
    let workOff = null;
    let handoverOff = null;
    let recoveryOff = null;
    let sparesOff = null;
    let pmOff = null;
    let changesOff = null;
    let shelvesOff = null;
    let sitesOff = null;
    const boardViewer = {};
    let user = null;
    // (a view-only token: a display, the operator board only)
    let viewOnly = false;
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
    // (what this user may do: roles.cjs; its groups: a company sign-in's)
    const groups = () => (user && user === ssoUser ? ssoGroups : []);
    const may = (cap) => roles.can(user, groups(), viewOnly).includes(cap);
    const roleInfo = () => {
      const role = viewOnly ? null : roles.roleOf(user, groups());
      return { role, roleLabel: role ? ROLE_LABELS[role] : null, can: roles.can(user, groups(), viewOnly), rolesOn: roles.enabled(), pages: roles.pagesOf(role), lang: roles.langOf(role) };
    };
    // (what this gateway offers its pages, by its settings and the user's role)
    const features = () => {
      const browse = config.allowBrowse !== false;
      return ['appInfo', ...(browse ? ['deviceInfo', 'instancesOffline', 'plcStatesRefresh'] : []), ...(browse && config.allowSources !== false ? ['sourcesOffline'] : []), ...(config.allowBuild === true && may('engineering') ? ['projectBuild'] : []), ...(config.allowWrite === true && may('plcWrite') ? ['plcStart', 'plcStartAt', 'plcStopAt', 'plcHistory'] : [])];
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
          return send({ type: 'welcome', user, plcs: [...plcs.values()].map((p) => ({ id: p.id, name: p.name })), features: features(), ...roleInfo(), sites: sites.count() });
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
        viewOnly = hit.view === true;
        clearTimeout(helloTimer);
        log(`auth: ${user} connected from ${ip}${viewOnly ? ' (view only)' : ''}`);
        audit.add(user, 'sign-in', { ip, how: viewOnly ? 'view-only token' : 'token' });
        return send({ type: 'welcome', user, plcs: [...plcs.values()].map((p) => ({ id: p.id, name: p.name })), features: viewOnly ? [] : features(), ...(viewOnly ? { viewOnly: true } : {}), ...roleInfo(), sites: sites.count() });
      }
      // A display (view-only token): the board, its saved boards and filters, the alerts, the I/O page and its signals,
      // nothing else (the filters and rules: refused by their own handlers, with their answers)
      if (viewOnly && !['boardWatch', 'boardList', 'alertsList', 'ioBoardWatch', 'ioBoardStop', 'ioSignals', 'deviceInfo', 'drivesWatch', 'drivesStop', 'driveHistory', 'fleetWatch', 'fleetStop', 'andonInfo', 'axesWatch', 'sitesWatch', 'changesWatch', 'alarmHealth', 'recoveryWatch', 'boardFilterSave', 'boardFilterDelete', 'boardRuleSave', 'boardRuleDelete'].includes(m.type)) {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const message = 'A view-only display token: the operator board only';
        if (m.type === 'liveStart') return send({ type: 'liveStatus', state: 'error', message });
        return send({ type: `${String(m.type).replace(/[^\w]/g, '').slice(0, 40)}Result`, requestId, ok: false, error: message });
      }

      // Roles: an action this user's role may not do, refused (answered as its handler would)
      {
        const NEEDS = { engTiming: 'engineering', engTransitions: 'engineering', engCompare: 'engineering', engVersions: 'engineering', engDiff: 'engineering', workCreate: 'workorder', workUpdate: 'workorder', handoverSave: 'note', recoverySave: 'boardEdit', recoveryDelete: 'boardEdit', recoveryStart: 'ack', recoveryStep: 'ack', recoveryEnd: 'ack', spareSave: 'assign', spareDelete: 'assign', spareMove: 'workorder', pmSave: 'assign', pmDelete: 'assign', pmNow: 'workorder', changeExplain: 'engineering', changeApprove: 'assign', callMaintenance: 'call', alarmShelve: 'ack', alarmUnshelve: 'ack', downtimeReason: 'downtime', oeeReport: 'reports', alertAck: 'ack', maintenanceSet: 'maintenance', report: 'reports', boardFilterSave: 'boardEdit', boardFilterDelete: 'boardEdit', boardRuleSave: 'boardEdit', boardRuleDelete: 'boardEdit', plcStart: 'plcWrite', plcStartAt: 'plcWrite', plcBuild: 'engineering', projectBuild: 'engineering', projectSync: 'engineering', projectPut: 'engineering' };
        let need = NEEDS[m.type];
        if ((m.type === 'plcBuild' || m.type === 'projectBuild') && m.write && may('engineering')) need = 'plcWrite';
        if (need && roles.enabled() && !viewOnly && !may(need)) {
          const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
          const role = roles.roleOf(user, groups());
          const error = `${user}'s role (${role ? ROLE_LABELS[role] : 'none'}) may not do this on this gateway`;
          audit.add(user, 'refused', { action: m.type, role });
          const reply = { engTiming: 'engTimingResult', engTransitions: 'engTransitionsResult', engCompare: 'engCompareResult', engVersions: 'engVersionsResult', engDiff: 'engDiffResult', workCreate: 'workResult', workUpdate: 'workResult', handoverSave: 'handoverResult', recoverySave: 'recoveryResult', recoveryDelete: 'recoveryResult', recoveryStart: 'recoveryResult', recoveryStep: 'recoveryResult', recoveryEnd: 'recoveryResult', spareSave: 'spareResult', spareDelete: 'spareResult', spareMove: 'spareResult', pmSave: 'pmResult', pmDelete: 'pmResult', pmNow: 'pmResult', changeExplain: 'changeResult', changeApprove: 'changeResult', callMaintenance: 'callMaintenanceResult', alarmShelve: 'shelfResult', alarmUnshelve: 'shelfResult', downtimeReason: 'downtimeReasonResult', oeeReport: 'oeeReportResult', alertAck: 'alertAckResult', maintenanceSet: 'maintenanceResult', report: 'reportResult', boardFilterSave: 'boardFilterResult', boardFilterDelete: 'boardFilterResult', boardRuleSave: 'boardRuleResult', boardRuleDelete: 'boardRuleResult', plcStart: 'plcStartResult', plcStartAt: 'plcStartAtResult', plcBuild: 'plcBuildResult', projectBuild: 'plcBuildResult', projectSync: 'projectSyncResult', projectPut: 'projectPutResult' }[m.type];
          return send({ type: reply, requestId, ok: false, error, message: error, fatal: error, items: [], state: null });
        }
      }

      // Before going live on one of its PLCs (over connections of their own, closed after): a POU type's instances
      // there, the one to follow chosen first; the PLCs' states (the Live tab, while not live); one started, stopped,
      // restarted or set to Run mode (a write: allowWrite, writeUsers, as Start PLC)
      const ownConnection = (plc) => sharedConnection(plc, plc.localNetId || config.localNetId, { localAdsPort: 32909 });
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
        const states = await Promise.all(list.map((p) => Promise.race([isLocalPlc(p) ? describePlc({ netId: p.netId, ip: '127.0.0.1' }, { plcPort: Number(p.port) || 851 }) : describePlc({ netId: p.netId, ip: p.ip || '' }, { plcPort: Number(p.port) || 851, localNetId: p.localNetId || config.localNetId, localAdsPort: 32909 }), timeout()])));
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
      // Saved boards (config.json "boards", the setup page edits them); then the saved filters and the recordings and
      // alarms (sent again when they change)
      if (m.type === 'boardList') {
        send({ type: 'boardList', boards: config.boards ?? [] });
        const sendFilters = () => send({ type: 'boardFilters', filters: boardFilters.list(), canEdit: canEditBoard(user, viewOnly) && may('boardEdit'), startFilter: roles.startPage(viewOnly ? null : roles.roleOf(user, groups())) });
        const sendRules = () => send({ type: 'boardRules', ...boardRules(), canEdit: canEditBoard(user, viewOnly) && may('boardEdit') });
        sendFilters();
        sendRules();
        faultsOff ??= faults.subscribe((fault, kind) => send({ type: 'faultEvent', fault: { ...fault, file: undefined }, kind }));
        // (the downtime reasons offered, and the stops given one: sent again when one is given)
        send(oeeConfig());
        if (!downtimeOff) {
          const again = () => send(oeeConfig());
          downtimeListeners.add(again);
          downtimeOff = () => downtimeListeners.delete(again);
        }
        filtersOff ??= boardFilters.subscribe(sendFilters);
        if (!rulesOff) {
          boardRuleListeners.add(sendRules);
          rulesOff = () => boardRuleListeners.delete(sendRules);
        }
        return;
      }
      // A saved filter saved (new, or changed: its id) or deleted
      if (m.type === 'boardFilterSave' || m.type === 'boardFilterDelete') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (!canEditBoard(user, viewOnly)) return send({ type: 'boardFilterResult', requestId, ok: false, error: viewOnly ? 'A display: nothing can be saved from it' : `${user} may not save the board's filters (boardEditors)` });
        try {
          if (m.type === 'boardFilterDelete') return send({ type: 'boardFilterResult', requestId, ok: boardFilters.remove(String(m.id ?? ''), user) });
          return send({ type: 'boardFilterResult', requestId, ok: true, filter: boardFilters.save(m.filter ?? {}, user, [...plcs.keys()]) });
        } catch (err) {
          return send({ type: 'boardFilterResult', requestId, ok: false, error: err.message });
        }
      }
      // A recording or an alarm for the machines (or signals) chosen on the board: config.json's recordings / alerts, as
      // the setup page saves them; changed (its id), or removed (only one made on the board)
      if (m.type === 'boardRuleSave' || m.type === 'boardRuleDelete') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const kind = m.kind === 'recording' ? 'recording' : 'alarm';
        const key = kind === 'recording' ? 'recordings' : 'alerts';
        if (!canEditBoard(user, viewOnly)) return send({ type: 'boardRuleResult', requestId, ok: false, error: viewOnly ? 'A display: nothing can be changed from it' : `${user} may not add recordings or alarms from the board (boardEditors)` });
        try {
          if (m.type === 'boardRuleDelete') {
            const old = (config[key] ?? []).find((r) => r.id === m.id);
            if (!old) throw new Error('No such one: it may have been removed already');
            if (!old.fromBoard) throw new Error(`"${old.name}" was made on the setup page: remove it there`);
            updateConfig((c) => {
              c[key] = (c[key] ?? []).filter((r) => r.id !== m.id);
            });
            log(`board: ${user} removed the ${kind} "${old.name}"`);
            audit.add(user, `board.${kind}.remove`, { id: old.id, name: old.name, plc: old.plc });
            return send({ type: 'boardRuleResult', requestId, ok: true });
          }
          const r = m.rule && typeof m.rule === 'object' ? m.rule : {};
          const old = typeof r.id === 'string' ? (config[key] ?? []).find((x) => x.id === r.id) : null;
          const id = old?.id ?? `board-${String(r.name ?? kind).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || kind}-${crypto.randomBytes(2).toString('hex')}`;
          const pick = (o, names) => Object.fromEntries(names.filter((n) => o[n] !== undefined).map((n) => [n, o[n]]));
          const fields = kind === 'recording' ? ['name', 'plc', 'root', 'stateVar', 'machines', 'vars', 'days', 'enabled'] : ['name', 'plc', 'root', 'stateVar', 'machines', 'stuckAfterMs', 'onError', 'notifyRecovery', 'onPlcStop', 'webhook', 'format', 'enabled'];
          const raw = { ...(old ?? { onPlcStop: false }), ...pick(r, fields), id, fromBoard: old?.fromBoard ?? { by: user, at: new Date().toISOString() } };
          const list = config[key] ?? [];
          const index = old ? list.indexOf(old) : list.length;
          const checked = kind === 'recording' ? checkRecording(raw, index, [...plcs.keys()]) : checkRule(raw, index, [...plcs.keys()]);
          updateConfig((c) => {
            const all = c[key] ?? [];
            const at = all.findIndex((x) => x.id === id);
            c[key] = at >= 0 ? all.map((x, i) => (i === at ? checked : x)) : [...all, checked];
          });
          const what = kind === 'recording' ? `${(checked.machines ?? []).length} machine(s), ${checked.vars.length} signal(s)` : `${(checked.machines ?? []).length} machine(s)`;
          log(`board: ${user} ${old ? 'changed' : 'added'} the ${kind} "${checked.name}" on ${checked.plc} (${what})`);
          audit.add(user, `board.${kind}.${old ? 'change' : 'add'}`, { id, name: checked.name, plc: checked.plc, machines: checked.machines ?? null, vars: checked.vars });
          return send({ type: 'boardRuleResult', requestId, ok: true, id });
        } catch (err) {
          return send({ type: 'boardRuleResult', requestId, ok: false, error: err.message });
        }
      }
      // The I/O page: these PLCs' I/O devices and box states (read-only); its signals, live
      if (m.type === 'ioBoardWatch') {
        ioWatch?.stop();
        ioWatch = null;
        if (config.allowBrowse === false || config.allowSources === false) return send({ type: 'ioBoardState', plcs: [], error: 'Reading the PLCs\' I/O is turned off on this gateway' });
        const ids = Array.isArray(m.plcs) && m.plcs.length ? m.plcs.filter((id) => plcs.has(id)).slice(0, 20) : [...plcs.keys()].slice(0, 20);
        ioWatch = ioBoards.watch(ids, ioViewer, send);
        log(`io board: ${user} watches ${ids.join(', ') || '(no PLCs)'}`);
        return;
      }
      // The Drives page: the drives of these PLCs (all when none), sent after each round of reads; a drive's history
      if (m.type === 'drivesWatch') {
        drivesOff?.();
        const ids = Array.isArray(m.plcs) ? m.plcs.filter((id) => plcs.has(id)) : [];
        const sendDrives = () => send({ type: 'drivesState', plcs: drives.view(ids), params: drives.params(), ...(config.drives?.enabled === false ? { error: 'The drives are not read on this gateway (drives.enabled is false in config.json)' } : {}) });
        sendDrives();
        drivesOff = drives.subscribe((plcId) => (!ids.length || ids.includes(plcId)) && sendDrives());
        log(`drives: ${user} watches the drives of ${ids.join(', ') || 'every PLC'}`);
        return;
      }
      // The fault records: their list (a PLC's, a machine's, since), one in full; the signals kept with a PLC's faults
      if (m.type === 'faultsList') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        return send({ type: 'faultsListResult', requestId, faults: faults.list({ plc: typeof m.plc === 'string' ? m.plc : undefined, machine: typeof m.machine === 'string' ? m.machine : undefined, since: Number(m.since) || undefined, limit: Math.min(500, Number(m.limit) || 200) }), signals: Object.fromEntries([...plcs.keys()].map((id) => [id, faults.signalsOf(id)])) });
      }
      // Last time this happened: a machine in a state, what is known of it (earlier alerts, work orders done and their
      // root causes, its recovery guide, earlier fault records)
      // Alarm shelving: those shelved now (and the latest ended), an alarm shelved, unshelved (those who acknowledge)
      if (m.type === 'shelvesWatch') {
        const sendShelves = () => send({ type: 'shelves', ...shelves.list() });
        sendShelves();
        shelvesOff ??= shelves.subscribe(sendShelves);
        return;
      }
      if (m.type === 'alarmShelve' || m.type === 'alarmUnshelve') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'shelfResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          const s = m.type === 'alarmShelve' ? shelves.shelve({ ...(m.shelf ?? {}), plcName: plcs.get(m.shelf?.plc)?.name }, user) : shelves.unshelve(String(m.id ?? ''), user);
          return send({ type: 'shelfResult', requestId, ok: true, shelf: s });
        } catch (err) {
          return send({ type: 'shelfResult', requestId, ok: false, error: err.message });
        }
      }
      if (m.type === 'lastTime') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'lastTimeResult', requestId, ok: false, error: 'A display: the board only' });
        const plc = typeof m.plc === 'string' ? m.plc : '';
        const machine = typeof m.machine === 'string' ? m.machine.slice(0, 300) : '';
        const state = typeof m.state === 'string' ? m.state.slice(0, 120) : '';
        if (!plcs.has(plc) || !machine) return send({ type: 'lastTimeResult', requestId, ok: false, error: 'A PLC of the gateway and a machine' });
        const fl = faults ? faults.list({ plc, machine, limit: 500 }) : [];
        const type = typeof m.machineType === 'string' ? m.machineType : fl[0]?.type ?? '';
        const at = Number.isFinite(Number(m.at)) && Number(m.at) > 0 ? Number(m.at) : Date.now();
        return send({ type: 'lastTimeResult', requestId, ok: true, ...lastTime({ alerts: alertLog.all(), orders: workOrders.list(), faults: fl, guide: state ? recovery.match({ plc, machine, type, state }) : null, plc, machine, state, at, excludeId: typeof m.alertId === 'string' ? m.alertId : null }) });
      }
      if (m.type === 'faultGet') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const fault = typeof m.id === 'string' ? faults.get(m.id) : null;
        if (fault) audit.add(user, 'fault.view', { id: fault.id, plc: fault.plc, machine: fault.machine });
        // (with the PLC's logged events of its window, and the work orders made of it)
        const withLinks = fault && { ...fault, events: eventLog.between(fault.plc, fault.from, fault.to), orders: workOrders.list().filter((o) => o.source?.kind === 'fault' && o.source.id === fault.id).map((o) => ({ id: o.id, number: o.number, title: o.title, status: o.status, assignee: o.assignee })) };
        return send({ type: 'faultGetResult', requestId, ...(fault ? { fault: withLinks } : { error: 'No such fault record (kept for config.faults.keepDays days)' }) });
      }
      if (m.type === 'faultSignalsSet') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (roles.enabled() ? !may('faults') : viewOnly) return send({ type: 'faultSignalsResult', requestId, ok: false, error: `${user} may not change what the fault records keep` });
        if (!plcs.has(m.plc) || !Array.isArray(m.signals) || m.signals.length > 20 || m.signals.some((p) => typeof p !== 'string' || !ads.isSymbolPath(p))) return send({ type: 'faultSignalsResult', requestId, ok: false, error: 'A PLC of the gateway and at most 20 symbol paths' });
        updateConfig((c) => {
          c.faults = { ...(c.faults ?? {}), signals: { ...(c.faults?.signals ?? {}), [m.plc]: [...new Set(m.signals)] } };
        });
        log(`faults: ${user} keeps ${m.signals.length} signal(s) with ${m.plc}'s faults`);
        audit.add(user, 'fault.signals', { plc: m.plc, signals: m.signals });
        return send({ type: 'faultSignalsResult', requestId, ok: true });
      }
      // The Risk page: the risk list and the inventory of these PLCs (all when none), every 30 s
      if (m.type === 'fleetWatch') {
        clearInterval(fleetTimer);
        const ids = Array.isArray(m.plcs) ? m.plcs.filter((id) => plcs.has(id)) : [];
        send(fleetState(ids));
        fleetTimer = setInterval(() => send(fleetState(ids)), 30000);
        return;
      }
      // OEE over a window (the OEE page), and a stop's reason (an operator's Why?)
      if (m.type === 'oeeReport') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const from = Number(m.from);
        const to = Number(m.to);
        if (!(from < to) || to - from > 62 * 86400000) return send({ type: 'oeeReportResult', requestId, error: 'A time window of at most 62 days' });
        try {
          const ids = Array.isArray(m.plcs) ? m.plcs.filter((id) => plcs.has(id)) : [];
          return send({ type: 'oeeReportResult', requestId, ...oee.report({ from, to, plcIds: ids, by: ['shift', 'day'].includes(m.by) ? m.by : 'total' }) });
        } catch (err) {
          return send({ type: 'oeeReportResult', requestId, error: err.message });
        }
      }
      if (m.type === 'downtimeReason') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (!plcs.has(m.plc) || typeof m.machine !== 'string' || !ads.isSymbolPath(m.machine) || !(Number(m.from) > 0)) return send({ type: 'downtimeReasonResult', requestId, ok: false, error: 'A PLC, a machine and when it stopped' });
        try {
          const e = oee.setReason({ plc: m.plc, machine: m.machine, from: Number(m.from), reason: String(m.reason ?? ''), note: m.note }, user);
          for (const fn of downtimeListeners) fn();
          return send({ type: 'downtimeReasonResult', requestId, ok: true, entry: e });
        } catch (err) {
          return send({ type: 'downtimeReasonResult', requestId, ok: false, error: err.message });
        }
      }
      // The andon: the states' descriptions and steps, the reasons to call for; a call for maintenance (an alert)
      if (m.type === 'andonInfo') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
        const steps = config.andon?.steps && typeof config.andon.steps === 'object' ? config.andon.steps : {};
        const reasons = Array.isArray(config.andon?.callReasons) && config.andon.callReasons.length ? config.andon.callReasons.map(String) : CALL_REASONS;
        if (!plc) return send({ type: 'andonInfoResult', requestId, docs: {}, steps, reasons });
        const types = Array.isArray(m.types) ? m.types.filter((t) => typeof t === 'string').slice(0, 200) : [];
        try {
          const files = await sourceFilesOf(plc);
          const { stateDocsFromSources } = require(`${sharedDir}/enumFromSources.cjs`);
          return send({ type: 'andonInfoResult', requestId, docs: Object.fromEntries(stateDocsFromSources(files, types)), steps, reasons });
        } catch (err) {
          return send({ type: 'andonInfoResult', requestId, docs: {}, steps, reasons, error: ads.adsErrorText(err) });
        }
      }
      if (m.type === 'callMaintenance') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
        const machine = typeof m.machine === 'string' && ads.isSymbolPath(m.machine) ? m.machine : null;
        const reason = String(m.reason ?? '').trim().slice(0, 60);
        if (!plc || !reason) return send({ type: 'callMaintenanceResult', requestId, ok: false, error: 'A PLC of the gateway and a reason' });
        const note = String(m.note ?? '').trim().slice(0, 200);
        const photos = attachments.metas(m.attachments);
        const e = alertLog.add({ event: 'call', ...(photos.length ? { attachments: photos } : {}), rule: 'Call maintenance', ruleId: 'call', plc: plc.id, plcName: plc.name, machine: machine ?? '(the line)', state: reason, by: user, note, text: `${plc.name}: 📣 ${user} calls maintenance${machine ? ` for ${machine}` : ''}: ${reason}${note ? ` · ${note}` : ''}`, at: new Date().toISOString() });
        audit.add(user, 'call', { plc: plc.id, machine, reason, note });
        // (a work order by itself: config.workorders.fromCalls, on unless false)
        if (config.workorders?.fromCalls !== false) workOrders.create({ title: `${reason}${machine ? ` at ${machine.split('.').slice(-1)[0]}` : ''}${note ? `: ${note}` : ''}`, plc: plc.id, plcName: plc.name, machine, priority: 'high', source: { kind: 'call', id: e.id, text: e.text }, attachments: photos }, user);
        log(`call: ${user} calls maintenance on ${plc.id}${machine ? ` (${machine})` : ''}: ${reason}`);
        return send({ type: 'callMaintenanceResult', requestId, ok: true, id: e.id });
      }
      // Work orders: followed (the Work page), created, changed (assigning another: those who assign); each machine's
      // reliability; the maintenance calendar
      // The Engineering page's answers
      if (m.type === 'engTiming' || m.type === 'engTransitions' || m.type === 'engCompare' || m.type === 'engVersions' || m.type === 'engDiff') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const reply = `${m.type}Result`;
        if (viewOnly) return send({ type: reply, requestId, error: 'A display: the board only' });
        const sym = (x) => typeof x === 'string' && ads.isSymbolPath(x);
        const win = (w) => w && typeof w.id === 'string' && sym(w.machine) && Number(w.from) < Number(w.to) && Number(w.to) - Number(w.from) <= 62 * 86400000 ? { id: w.id, machine: w.machine, from: Number(w.from), to: Number(w.to) } : null;
        try {
          if (m.type === 'engTiming') return send({ type: reply, requestId, ...(typeof m.id === 'string' && sym(m.machine) ? engineering.timing(m.id, m.machine) : { error: 'A recording and a machine' }) });
          if (m.type === 'engTransitions') return send({ type: reply, requestId, ...(typeof m.id === 'string' && sym(m.machine) ? engineering.transitions(m.id, m.machine, Math.max(1, Math.min(168, Number(m.hours) || 24))) : { error: 'A recording and a machine' }) });
          if (m.type === 'engCompare') {
            const a = win(m.a);
            const b = win(m.b);
            return send({ type: reply, requestId, ...(a && b ? engineering.compare(a, b) : { error: 'Two recordings, their machines and windows' }) });
          }
          if (!plcs.has(m.plc)) return send({ type: reply, requestId, error: 'A PLC of the gateway' });
          if (m.type === 'engVersions') return send({ type: reply, requestId, versions: engineering.versions(m.plc) });
          const ok = (v) => typeof v === 'string' && /^[\w.-]{1,60}$/.test(v);
          if (!ok(m.a) || !ok(m.b) || (m.path != null && (typeof m.path !== 'string' || m.path.length > 300 || m.path.includes('..')))) return send({ type: reply, requestId, error: 'Two versions (and a file)' });
          return send({ type: reply, requestId, ...engineering.diff(m.plc, m.a, m.b, m.path ?? undefined) });
        } catch (err) {
          return send({ type: reply, requestId, error: err.message });
        }
      }
      // A support bundle made (engineers, supervisors; roles off: anyone signed in), its link
      if (m.type === 'supportCreate') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly || (roles.enabled() && !may('engineering') && !may('assign'))) return send({ type: 'supportResult', requestId, ok: false, error: `${user} may not make support bundles (engineers and supervisors)` });
        const hours = [24, 72, 168].includes(Number(m.hours)) ? Number(m.hours) : 24;
        const days = [1, 3, 7].includes(Number(m.days)) ? Number(m.days) : 3;
        try {
          return send({ type: 'supportResult', requestId, ok: true, ...support.create(supportFiles(hours, m.faults !== false, user), { days, hours }, user) });
        } catch (err) {
          return send({ type: 'supportResult', requestId, ok: false, error: err.message });
        }
      }
      // Shift handover (handover.cjs): the latest ones (again when one is handed over or read), the shift so far,
      // handing over (who may write notes), reading one
      // Guided recovery (recovery.cjs): the guides (again when one changes); one written, removed; a run begun, its
      // steps, its end; the checks of a guide read from its PLC
      if (m.type === 'recoveryWatch') {
        const sendGuides = () => send({ type: 'recoveryGuides', guides: recovery.list() });
        sendGuides();
        recoveryOff ??= recovery.subscribe(sendGuides);
        return;
      }
      if (m.type === 'recoveryChecks') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (typeof m.plc !== 'string' || !plcs.has(m.plc)) return send({ type: 'recoveryChecksResult', requestId, checks: [], error: 'No such PLC' });
        try {
          return send({ type: 'recoveryChecksResult', requestId, checks: await recovery.checks(m.plc, m.checks) });
        } catch (err) {
          return send({ type: 'recoveryChecksResult', requestId, checks: [], error: err.message });
        }
      }
      if (['recoverySave', 'recoveryDelete', 'recoveryStart', 'recoveryStep', 'recoveryEnd'].includes(m.type)) {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'recoveryResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          if (m.type === 'recoverySave') return send({ type: 'recoveryResult', requestId, ok: true, guide: recovery.save(m.guide ?? {}, user) });
          if (m.type === 'recoveryDelete') {
            recovery.remove(String(m.id ?? ''), user);
            return send({ type: 'recoveryResult', requestId, ok: true });
          }
          if (m.type === 'recoveryStart') return send({ type: 'recoveryResult', requestId, ok: true, run: recovery.start({ guide: String(m.guide ?? ''), plc: m.plc, plcName: plcs.get(m.plc)?.name ?? m.plcName, machine: m.machine, state: m.state }, user) });
          if (m.type === 'recoveryStep') return send({ type: 'recoveryResult', requestId, ok: true, run: recovery.step(String(m.id ?? ''), m.step, { skipped: !!m.skipped, value: m.value }, user) });
          return send({ type: 'recoveryResult', requestId, ok: true, run: recovery.end(String(m.id ?? ''), m.outcome, m.note, user) });
        } catch (err) {
          return send({ type: 'recoveryResult', requestId, ok: false, error: err.message });
        }
      }
      if (m.type === 'handoverWatch') {
        const sendHandovers = () => send({ type: 'handoverState', list: handover.list(10) });
        sendHandovers();
        handoverOff ??= handover.subscribe(sendHandovers);
        return;
      }
      if (m.type === 'handoverDraft') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        return send({ type: 'handoverDraftResult', requestId, ...handover.draft(Array.isArray(m.plcs) ? m.plcs.map(String).slice(0, 100) : []) });
      }
      if (m.type === 'handoverSave' || m.type === 'handoverRead') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'handoverResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          const e = m.type === 'handoverSave' ? handover.handOver({ note: m.note, plcIds: Array.isArray(m.plcs) ? m.plcs : [], attachments: attachments.metas(m.attachments) }, user) : handover.read(String(m.id ?? ''), user);
          return send({ type: 'handoverResult', requestId, ok: true, id: e.id, attachments: e.attachments ?? [] });
        } catch (err) {
          return send({ type: 'handoverResult', requestId, ok: false, error: err.message });
        }
      }
      // Spare parts: followed (the Work page's Parts), written, removed, received or taken
      // Push notifications: this device's, turned on (its subscription, the events and PLCs it wants), off, tested
      if (m.type === 'pushInfo') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        return send({ type: 'pushInfoResult', requestId, enabled: push.enabled(), publicKey: push.publicKey(), sub: typeof m.endpoint === 'string' ? push.of(m.endpoint) : null });
      }
      if (m.type === 'pushSubscribe' || m.type === 'pushUnsubscribe' || m.type === 'pushTest') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'pushResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          if (m.type === 'pushSubscribe') return send({ type: 'pushResult', requestId, ok: true, ...push.subscribe(m.subscription, { user, plcs: m.plcs, events: m.events, label: m.label }) });
          if (m.type === 'pushUnsubscribe') {
            push.unsubscribe(String(m.endpoint ?? ''), user);
            return send({ type: 'pushResult', requestId, ok: true });
          }
          const status = await push.test(String(m.endpoint ?? ''), user);
          return send({ type: 'pushResult', requestId, ok: status < 400, ...(status >= 400 ? { error: `Its push service answered ${status}` } : {}) });
        } catch (err) {
          return send({ type: 'pushResult', requestId, ok: false, error: err.message });
        }
      }
      // Preventive maintenance: the plans (again when one or a work order changes); written, removed; a work order now
      // Alarm health (alarmHealth.cjs): the alert history as ISA-18.2 measures it, over 1, 7 or 30 days
      // Change control: the changes (again when one is added, explained, approved); explained; approved
      // The Sites page: the other gateways (again when one changes)
      if (m.type === 'sitesWatch') {
        const sendSites = () => send({ type: 'sitesState', sites: sites.view() });
        sendSites();
        sitesOff ??= sites.subscribe(sendSites);
        return;
      }
      if (m.type === 'changesWatch') {
        const sendChanges = () => send({ type: 'changes', changes: changes.list(200), open: changes.open() });
        sendChanges();
        changesOff ??= changes.subscribe(sendChanges);
        return;
      }
      if (m.type === 'changeExplain' || m.type === 'changeApprove') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'changeResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          const c = m.type === 'changeExplain' ? changes.explain(String(m.id ?? ''), { reason: m.reason, workOrder: m.workOrder }, user) : changes.approve(String(m.id ?? ''), user);
          return send({ type: 'changeResult', requestId, ok: true, change: c });
        } catch (err) {
          return send({ type: 'changeResult', requestId, ok: false, error: err.message });
        }
      }
      if (m.type === 'alarmHealth') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const days = [1, 7, 30].includes(Number(m.days)) ? Number(m.days) : 7;
        const to = Date.now();
        return send({ type: 'alarmHealthResult', requestId, ...alarmHealth({ events: alertLog.all(), from: to - days * 86400000, to, plcIds: Array.isArray(m.plcs) ? m.plcs.map(String) : [] }) });
      }
      if (m.type === 'pmWatch') {
        const sendPm = () => send({ type: 'pmPlans', plans: pm.list() });
        sendPm();
        if (!pmOff) {
          const a = pm.subscribe(sendPm);
          const b = workOrders.subscribe(sendPm);
          pmOff = () => {
            a();
            b();
          };
        }
        return;
      }
      if (m.type === 'pmSave' || m.type === 'pmDelete' || m.type === 'pmNow') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'pmResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          if (m.type === 'pmSave') return send({ type: 'pmResult', requestId, ok: true, plan: await pm.save(m.plan ?? {}, user) });
          if (m.type === 'pmDelete') {
            pm.remove(String(m.id ?? ''), user);
            return send({ type: 'pmResult', requestId, ok: true });
          }
          return send({ type: 'pmResult', requestId, ok: true, order: pm.now(String(m.id ?? ''), user) });
        } catch (err) {
          return send({ type: 'pmResult', requestId, ok: false, error: err.message });
        }
      }
      if (m.type === 'sparesWatch') {
        const sendSpares = () => send({ type: 'spares', ...spares.view() });
        sendSpares();
        sparesOff ??= spares.subscribe(sendSpares);
        return;
      }
      if (m.type === 'spareSave' || m.type === 'spareDelete' || m.type === 'spareMove') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'spareResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          if (m.type === 'spareSave') return send({ type: 'spareResult', requestId, ok: true, part: spares.save(m.part ?? {}, user) });
          if (m.type === 'spareDelete') {
            spares.remove(String(m.id ?? ''), user);
            return send({ type: 'spareResult', requestId, ok: true });
          }
          return send({ type: 'spareResult', requestId, ok: true, part: spares.adjust(String(m.id ?? ''), m.delta, m.why, user) });
        } catch (err) {
          return send({ type: 'spareResult', requestId, ok: false, error: err.message });
        }
      }
      // Attachments: a photo (or a PDF) kept, its meta back (then on a work order, a call, a handover); one read back
      if (m.type === 'attachmentAdd' || m.type === 'attachmentGet') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const reply = `${m.type}Result`;
        if (viewOnly) return send({ type: reply, requestId, ok: false, error: 'A display: the board only' });
        try {
          // (added by those who call maintenance, work on a work order or write a handover)
          if (m.type === 'attachmentAdd' && roles.enabled() && !may('call') && !may('workorder') && !may('note')) throw new Error(`${user}'s role may not add photos`);
          if (m.type === 'attachmentAdd') return send({ type: reply, requestId, ok: true, attachment: attachments.add(m.file ?? {}, user, 'the board') });
          const a = attachments.get(String(m.id ?? ''));
          return send({ type: reply, requestId, ...(a ? { ok: true, contentType: a.type, data: a.data } : { ok: false, error: 'No such attachment' }) });
        } catch (err) {
          return send({ type: reply, requestId, ok: false, error: err.message });
        }
      }
      if (m.type === 'workWatch') {
        const sendWork = () => send({ type: 'workOrders', orders: workOrders.list(), people: peopleOf(), checklists: workOrders.checklists(), signOff: config.workorders?.signOff === true });
        sendWork();
        workOff ??= workOrders.subscribe(sendWork);
        return;
      }
      if (m.type === 'workStop') {
        workOff?.();
        workOff = null;
        return;
      }
      if (m.type === 'workCreate' || m.type === 'workUpdate') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (viewOnly) return send({ type: 'workResult', requestId, ok: false, error: 'A display: nothing can be changed from it' });
        try {
          const o = m.type === 'workCreate'
            ? workOrders.create({ ...(m.order ?? {}), plcName: plcs.get(m.order?.plc)?.name ?? m.order?.plcName ?? null, attachments: attachments.metas(m.order?.attachments) }, user)
            : (() => {
                // (done with parts from stock: there, enough of each, checked first; taken once it is done)
                const ch = { ...(m.change ?? {}) };
                // (its photos: those kept, by their ids)
                if (ch.attach !== undefined) ch.attach = attachments.metas(ch.attach);
                const id = String(m.id ?? '');
                const used = ch.status === 'done' && workOrders.get(id)?.status !== 'done' ? spares.check(ch.partsUsed) : [];
                if (used.length) ch.parts = [String(ch.parts ?? '').trim(), used.map(({ p, qty }) => `${qty} × ${p.number} ${p.name}`).join('; ')].filter(Boolean).join('; ');
                const done = workOrders.update(id, ch, user, roles.enabled() ? may('assign') : true, roles.enabled());
                spares.take(used, user, done.number);
                // (a preventive maintenance's work order done: its plan done)
                if (done.source?.kind === 'pm' && done.status === 'done') pm.done(done.source.id);
                return done;
              })();
          return send({ type: 'workResult', requestId, ok: true, order: o });
        } catch (err) {
          return send({ type: 'workResult', requestId, ok: false, error: err.message });
        }
      }
      // The maintenance KPIs (the Work page's KPIs tab)
      if (m.type === 'maintenanceKpis') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const days = [7, 30, 90, 365].includes(Number(m.days)) ? Number(m.days) : 30;
        return send({ type: 'maintenanceKpisResult', requestId, ...maintenanceKpis({ orders: workOrders.list(), moves: spares.moves(), alerts: alertLog.all(), days, weeks: days >= 90 ? 13 : 8 }) });
      }
      if (m.type === 'reliability') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const days = [7, 30, 90, 365].includes(Number(m.days)) ? Number(m.days) : 30;
        return send({ type: 'reliabilityResult', requestId, rows: reliability({ alerts: alertLog.all(), orders: workOrders.list(), from: Date.now() - days * 86400000, to: Date.now() }) });
      }
      if (m.type === 'maintenanceCalendar') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const from = Number(m.from);
        const to = Number(m.to);
        if (!(from < to) || to - from > 100 * 86400000) return send({ type: 'maintenanceCalendarResult', requestId, windows: [] });
        return send({ type: 'maintenanceCalendarResult', requestId, windows: maintenance.calendar(from, to) });
      }
      if (m.type === 'fleetStop') {
        clearInterval(fleetTimer);
        return;
      }
      if (m.type === 'drivesStop') {
        drivesOff?.();
        drivesOff = null;
        axesOff?.();
        axesOff = null;
        return;
      }
      // The Drives page's servo axes: these PLCs' (all when none), after each round of reads
      if (m.type === 'axesWatch') {
        axesOff?.();
        const ids = Array.isArray(m.plcs) ? m.plcs.filter((id) => plcs.has(id)) : [];
        const sendAxes = () => send({ type: 'axesState', plcs: axes.view(ids) });
        sendAxes();
        axesOff = axes.subscribe((plcId) => (!ids.length || ids.includes(plcId)) && sendAxes());
        return;
      }
      if (m.type === 'driveHistory') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const from = Number(m.from);
        const to = Number(m.to);
        const keys = Array.isArray(m.keys) ? m.keys.filter((k) => typeof k === 'string' && /^\w{1,32}$/.test(k)).slice(0, 20) : [];
        if (typeof m.plc !== 'string' || typeof m.path !== 'string' || !keys.length || !(from < to) || to - from > 93 * 86400000) return send({ type: 'driveHistoryResult', requestId, error: 'A PLC, a drive, its values and a time window of at most 93 days' });
        return send({ type: 'driveHistoryResult', requestId, ...drives.history(m.plc, m.path, keys, from, to) });
      }
      if (m.type === 'ioBoardStop') {
        ioWatch?.stop();
        ioWatch = null;
        return;
      }
      if (m.type === 'ioSignals') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (!ioWatch) return send({ type: 'ioSignalsResult', requestId, error: 'The I/O page is not open' });
        return send({ type: 'ioSignalsResult', requestId, ...(await ioWatch.signals(String(m.plc ?? ''), Array.isArray(m.signals) ? m.signals : [])) });
      }
      // Recorded signals over a time window (the I/O page's trends, going back)
      if (m.type === 'recordingVars') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const from = Number(m.from);
        const to = Number(m.to);
        const vars = Array.isArray(m.vars) ? m.vars.filter((v) => typeof v === 'string' && ads.isSymbolPath(v)).slice(0, 20) : [];
        if (typeof m.id !== 'string' || !vars.length || !(from < to) || to - from > 31 * 86400000) return send({ type: 'recordingVarsResult', requestId, error: 'A recording, its signals and a time window of at most 31 days' });
        audit.add(user, 'replay', { recording: m.id, vars, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
        return send({ type: 'recordingVarsResult', requestId, ...recorders.queryVars(m.id, vars, from, to) });
      }
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
      // The Live tab's events, shared: what happened while a user was live on a PLC (alerts, writes, overruns, pauses,
      // the PLC set to a state…), kept in the audit log for everyone live on that PLC (liveEventsList: the last hours)
      if (m.type === 'liveEventsPut') {
        const plcId = session?.conn.plc?.id ?? null;
        if (!plcId || !Array.isArray(m.events)) return;
        for (const e of m.events.slice(0, 50)) {
          if (!e || typeof e.text !== 'string' || typeof e.kind !== 'string' || !/^[a-z]{1,20}$/.test(e.kind)) continue;
          audit.add(user, 'live.event', { plc: plcId, pou: String(m.pou ?? '').slice(0, 80), instance: String(m.instance ?? '').slice(0, 200), kind: e.kind, text: e.text.slice(0, 300), at: Number.isFinite(e.t) ? e.t : Date.now() });
          if (e.kind === 'note') notesCache = null;
        }
        return;
      }
      if (m.type === 'liveEventsList') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        const plcId = session?.conn.plc?.id ?? (typeof m.plc === 'string' ? m.plc : null);
        if (!plcId) return send({ type: 'liveEventsListResult', requestId, events: [], error: 'Not live on a PLC' });
        const hours = Math.max(1, Math.min(24 * 31, Number(m.hours) || 24));
        const events = audit
          .search({ from: Date.now() - hours * 3600_000, q: 'live.event', limit: 2000 })
          .filter((e) => e.action === 'live.event' && e.plc === plcId)
          .map((e) => ({ t: e.at ?? e.t, kind: e.kind, text: e.text, user: e.user, pou: e.pou }));
        return send({ type: 'liveEventsListResult', requestId, plc: plcId, events });
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
          const { readIoTree } = require(`${sharedDir}/tcIoTree.cjs`);
          const { readBootFile } = require(`${sharedDir}/tcSources.cjs`);
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
        return send({ type: 'deviceInfoResult', requestId, ...require(`${sharedDir}/tcDeviceInfo.cjs`).deviceInfo(req, null, folder) });
      }
      // The EtherCAT masters' slave states (read-only), with the browser's permission (the connected PLC's own devices)
      if (m.type === 'ecatStates') {
        const requestId = Number.isInteger(m.requestId) ? m.requestId : 0;
        if (config.allowBrowse === false) return send({ type: 'ecatStatesResult', requestId, error: 'Reading the PLC\'s I/O states is turned off on this gateway' });
        if (!session?.conn.client) return send({ type: 'ecatStatesResult', requestId, error: 'Not connected' });
        try {
          const { readMasters } = require(`${sharedDir}/tcEcat.cjs`);
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
          // their own (the boot folder's files from its system service, port 10000), then closed; its PLC need not
          // run. The gateway's copy when that is in step with the PLC: its _AppInfo read, not the archives)
          const plc = typeof m.plc === 'string' ? plcs.get(m.plc) : null;
          if (!plc) return send({ type: 'plcSourcesResult', requestId, error: 'Not connected' });
          const own = new Client({ ...adsTarget(plc, Number(plc.port) || 851, plc.localNetId || config.localNetId, 32907), rawClient: true, autoReconnect: false, timeoutDelay: 5000, hideConsoleWarnings: true });
          try {
            await own.connect();
            const key = typeof m.plcProject === 'string' ? m.plcProject.slice(0, 100) : '';
            send({ type: 'plcSourcesResult', requestId, ...((await keptSources(plc, own, key)) ?? (await readPlcSources(own, Number(plc.port) || 851, { plcProject: key }))) });
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
          if (!conn.sources.has(key)) conn.sources.set(key, keptSources(conn.plc, conn.client, key).then((kept) => kept ?? readPlcSources(conn.client, Number(conn.plc?.port) || 851, { plcProject: key })));
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
          session = { conn, entry: null, vars: conn.sharedVars()?.watcher(send) ?? new VarWatcher(conn.client, send) };
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
        session = { conn, entry, vars: conn.sharedVars()?.watcher(send) ?? new VarWatcher(conn.client, send) };
        if (desiredVars) session.vars.set(desiredVars);
        viewerCount++;
        flushTimer = setInterval(() => {
          if (queue.length) send({ type: 'liveValues', events: queue.splice(0) });
          const values = session?.vars.drain();
          if (values) send({ type: 'liveVars', values });
        }, 50);
        log(`live: ${user} follows ${symbol} on ${plc.id} (${entry.viewers.size} viewer(s))`);
        audit.add(user, 'live', { plc: plc.id, symbol });
        // (the instance's own type: the app says when it is not the loaded POU's)
        const instanceType = (await ads.probe(conn.client, chosen).catch(() => null))?.type ?? null;
        conn.symbolVersion ??= await ads.symbolVersion(conn.client);
        // (the state variable's enum as the PLC has it; the project the configuration was activated from; the PLC's
        // TwinCAT build: the server has no XAE of the viewer's)
        conn.dtCache ??= new Map();
        const stateNames = (await ads.dataTypeInfo(conn.client, info.type, conn.dtCache).catch(() => null))?.enumValues ?? null;
        const activeProject = await activeProjectOf(conn.client);
        // (the build the PLC runs: no project copy here to compare it with)
        const plcBuildId = await require(`${sharedDir}/tcCompileInfo.cjs`).plcCompileId(conn.client, plc.port ?? 851);
        const compileInfo = plcBuildId ? { plc: plcBuildId, newest: null, state: null, builtAt: null } : null;
        const twinCatBuild = await conn.client.readDeviceInfo({ adsPort: 10000 }).then((i) => (i && i.majorVersion === 3 && i.minorVersion === 1 && i.versionBuild > 4000 ? i.versionBuild : null)).catch(() => null);
        send({
          type: 'liveStatus', state: 'connected', message: `${symbol} on ${plc.name} (PLC ${conn.plcState})`,
          target: plc.name, plcState: conn.plcState, instance: chosen, instances: found, symbolType: info.type, instanceType, stateNames, activeProject, compileInfo, twinCatBuild,
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
      filtersOff?.();
      rulesOff?.();
      ioWatch?.stop();
      drivesOff?.();
      faultsOff?.();
      clearInterval(fleetTimer);
      downtimeOff?.();
      workOff?.();
      handoverOff?.();
      recoveryOff?.();
      sparesOff?.();
      pmOff?.();
      axesOff?.();
      changesOff?.();
      shelvesOff?.();
      sitesOff?.();
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
    ioBoards.stop();
    drives.stop();
    load.stop();
    faults.stop();
    fleet.stop();
    oee.stop();
    support.stop();
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
