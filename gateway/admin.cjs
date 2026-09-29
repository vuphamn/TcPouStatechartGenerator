// The gateway's setup page (/admin): find the PLCs on the network and put them in config.json, test a PLC's
// connection, create and revoke access tokens. Only from the gateway machine itself (or the addresses in
// config.admin.allowFrom); "admin": { "enabled": false } turns it off.
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const NETID = /^(\d{1,3}\.){5}\d{1,3}$/;
const HOST = /^([A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}(:\d{1,5})?$/;
const validNetId = (s) => typeof s === 'string' && NETID.test(s) && s.split('.').every((n) => Number(n) <= 255);

function localHostNames(config) {
  const names = new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase()]);
  for (const a of Object.values(os.networkInterfaces()).flat()) if (a) names.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
  for (const h of config.admin?.hosts ?? []) names.add(String(h).toLowerCase());
  return names;
}

/** The PLC list from the page, checked; throws with a message for the page */
function checkPlcs(list) {
  if (!Array.isArray(list) || list.length > 200) throw new Error('A list of PLCs is expected');
  const ids = new Set();
  return list.map((p, i) => {
    const row = `PLC ${i + 1}`;
    const id = String(p?.id ?? '').trim();
    const name = String(p?.name ?? '').trim().slice(0, 80) || id;
    const netId = String(p?.netId ?? '').trim();
    const ip = String(p?.ip ?? '').trim();
    const port = Number(p?.port ?? 851);
    if (!ID.test(id)) throw new Error(`${row}: the id is letters, digits, - or _ (it is in the web app's saved choice)`);
    if (ids.has(id.toLowerCase())) throw new Error(`${row}: the id "${id}" is used twice`);
    ids.add(id.toLowerCase());
    if (!validNetId(netId)) throw new Error(`${name}: the AMS NetId is six numbers such as 192.168.1.20.1.1`);
    if (ip && !HOST.test(ip)) throw new Error(`${name}: the address is an IP address or host name (host:port for a forwarded ADS port)`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name}: the ADS port is a number (851 for the first PLC)`);
    const out = { id, name, netId, ip: ip || netId.split('.').slice(0, 4).join('.'), port };
    if (p?.localNetId) {
      if (!validNetId(p.localNetId)) throw new Error(`${name}: the gateway's AMS NetId for it is six numbers`);
      out.localNetId = p.localNetId;
    }
    return out;
  });
}

/** A saved operator board, checked */
function checkBoard(b, i, plcIds) {
  const where = `Board ${i + 1}`;
  const id = String(b?.id ?? '').trim();
  if (!/^[\w-]{1,40}$/.test(id)) throw new Error(`${where}: the id (in the address, ?board=<id>) is letters, digits, - or _`);
  const plcs = Array.isArray(b?.plcs) ? b.plcs.filter((p) => plcIds.includes(p)) : [];
  const root = String(b?.root ?? 'MAIN.mainStateMachine').trim();
  if (!/^[A-Za-z_]\w*(\[-?\d+\])*(\.[A-Za-z_]\w*(\[-?\d+\])*)*$/.test(root)) throw new Error(`${where}: the root is a symbol path such as MAIN.mainStateMachine`);
  const stuck = b?.stuck == null || b.stuck === '' ? null : Number(b.stuck);
  if (stuck !== null && (!Number.isFinite(stuck) || stuck < 1)) throw new Error(`${where}: "stuck after" is at least 1 s`);
  return { id, title: String(b?.title ?? '').trim().slice(0, 80) || id, plcs, root, stuck };
}

function createAdmin({ configPath, getConfig, applyConfig, plcStatus, testPlc, checkPlc, discover, localNetworks, sha256, version, log, alerts, recordings, audit, reports, service }) {
  // config.json read fresh and written whole (a temporary file renamed over it): other settings are kept as they are
  const update = (change) => {
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    change(onDisk);
    const tmp = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(onDisk, null, 2) + '\n');
    fs.renameSync(tmp, configPath);
    applyConfig(onDisk);
    return onDisk;
  };

  const state = () => {
    const config = getConfig();
    return {
      version,
      configPath,
      host: os.hostname(),
      port: config.port ?? 8443,
      scheme: config.insecure && !config.tls ? 'http' : 'https',
      localNetId: config.localNetId ?? '',
      networks: localNetworks(),
      plcs: (config.plcs ?? []).map((p) => ({ ...p, status: plcStatus(p.id) })),
      tokens: (config.tokens ?? []).map((t) => ({ name: t.name, created: t.created ?? null })),
    };
  };

  const api = {
    'GET state': async () => state(),
    'POST scan': async (body) => {
      const addresses = (Array.isArray(body.addresses) ? body.addresses : []).map((a) => String(a).trim()).filter(Boolean);
      if (addresses.length > 64 || addresses.some((a) => !HOST.test(a) || a.includes(':'))) throw new Error('Addresses: IP addresses or host names, separated by commas');
      const result = await discover({ localNetId: getConfig().localNetId, addresses, broadcast: body.broadcast !== false && getConfig().discoveryBroadcast !== false, port: getConfig().discoveryPort ?? 48899 });
      log(`admin: network search, ${result.devices.length} TwinCAT device(s)`);
      return result;
    },
    // Check: why a PLC does not answer the gateway, step by step (read-only; the gateway's NetId)
    'POST check': async (body) => {
      const [plc] = checkPlcs([{ id: body.id || 'check', name: body.name || 'The PLC', netId: body.netId, ip: body.ip, port: body.port ?? 851, localNetId: body.localNetId || undefined }]);
      if (!checkPlc) throw new Error('Not available on this gateway');
      return checkPlc(plc);
    },
    'POST test': async (body) => {
      const [plc] = checkPlcs([{ id: body.id || 'test', name: body.name || 'The PLC', netId: body.netId, ip: body.ip, port: body.port ?? 851, localNetId: body.localNetId || undefined }]);
      return testPlc(plc, body.id);
    },
    'POST plcs': async (body) => {
      const plcs = checkPlcs(body.plcs);
      if (!validNetId(body.localNetId)) throw new Error('The gateway\'s AMS NetId is six numbers such as 192.168.1.5.1.1');
      update((c) => {
        c.localNetId = body.localNetId;
        c.plcs = plcs;
      });
      log(`admin: PLCs saved (${plcs.map((p) => p.id).join(', ') || 'none'}), gateway AMS NetId ${body.localNetId}`);
      return state();
    },
    'POST tokens': async (body) => {
      const name = String(body.name ?? '').trim();
      if (!/^[\w .@-]{1,60}$/.test(name)) throw new Error('A name for the token: letters, digits, space, . @ - or _');
      if ((getConfig().tokens ?? []).some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error(`A token named "${name}" exists: revoke it first`);
      const token = crypto.randomBytes(24).toString('base64url');
      update((c) => {
        c.tokens = [...(c.tokens ?? []), { name, sha256: sha256(token), created: new Date().toISOString() }];
      });
      log(`admin: token "${name}" created`);
      return { name, token, state: state() };
    },
    'GET alerts': async () => ({ rules: getConfig().alerts ?? [], status: alerts?.status() ?? [], plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) }),
    'POST alerts': async (body) => {
      if (!alerts) throw new Error('Alerts are not available');
      if (!Array.isArray(body.rules) || body.rules.length > 50) throw new Error('A list of alerts is expected');
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const rules = body.rules.map((r, i) => alerts.checkRule(r, i, ids));
      if (new Set(rules.map((r) => r.id)).size !== rules.length) throw new Error('Two alerts have the same id');
      update((c) => {
        c.alerts = rules;
      });
      log(`admin: alerts saved (${rules.length})`);
      return { rules, status: alerts.status(), plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) };
    },
    'GET boards': async () => ({ boards: getConfig().boards ?? [], plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) }),
    'POST boards': async (body) => {
      if (!Array.isArray(body.boards) || body.boards.length > 50) throw new Error('A list of boards is expected');
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const boards = body.boards.map((b, i) => checkBoard(b, i, ids));
      if (new Set(boards.map((b) => b.id.toLowerCase())).size !== boards.length) throw new Error('Two boards have the same id');
      update((c) => {
        c.boards = boards;
      });
      log(`admin: boards saved (${boards.map((b) => b.id).join(', ') || 'none'})`);
      return { boards, plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) };
    },
    'POST recordings/check': async (body) => {
      if (!recordings) throw new Error('Recordings are not available');
      return recordings.checkSlowerNow(String(body.id ?? ''));
    },
    // Audit log: search (text, time window), newest first
    'POST audit/search': async (body) => {
      const from = Number(body.from) || Date.now() - 7 * 86400000;
      const to = Number(body.to) || Date.now();
      return { events: audit ? audit.search({ from, to, q: String(body.q ?? '').slice(0, 200), limit: Math.min(5000, Number(body.limit) || 1000) }) : [] };
    },
    // Shift reports: the shifts, the webhook; a preview; sent now
    'GET reports': async () => ({ shifts: getConfig().shifts ?? [], reports: getConfig().reports ?? {} }),
    'POST reports': async (body) => {
      if (!reports) throw new Error('Reports are not available');
      const shifts = (Array.isArray(body.shifts) ? body.shifts : []).filter((x) => x && (x.name || x.from || x.to));
      reports.checkShifts(shifts);
      const webhook = String(body.reports?.webhook ?? '').trim() || null;
      if (webhook && !/^https?:\/\/\S+$/i.test(webhook)) throw new Error('The reports webhook is an http(s) URL (or empty)');
      const format = ['teams', 'slack', 'json'].includes(body.reports?.format) ? body.reports.format : 'teams';
      update((c) => {
        c.shifts = shifts.map((x) => ({ name: String(x.name ?? '').trim().slice(0, 30), from: String(x.from).trim(), to: String(x.to).trim() }));
        c.reports = { webhook, format };
      });
      log(`admin: shifts and reports saved (${shifts.length} shift(s)${webhook ? ', webhook' : ''})`);
      return { shifts: getConfig().shifts ?? [], reports: getConfig().reports ?? {} };
    },
    'POST reports/preview': async (body) => {
      if (!reports) throw new Error('Reports are not available');
      const r = reports.report(['last', 'today', 'yesterday'].includes(body.which) ? body.which : 'last');
      return { summary: r.summary, csv: r.csv };
    },
    'POST reports/send': async (body) => {
      if (!reports) throw new Error('Reports are not available');
      return reports.send(['last', 'today', 'yesterday'].includes(body.which) ? body.which : 'last');
    },
    // Run at startup (Windows): the startup task
    'GET service': async () => (service ? service.status() : { supported: false, message: 'Not available' }),
    'POST service/install': async () => service.install(),
    'POST service/remove': async () => service.remove(),
    'POST service/switch': async () => service.switchToTask(),
    'GET recordings': async () => ({ rules: getConfig().recordings ?? [], status: recordings?.list() ?? [], plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) }),
    'POST recordings': async (body) => {
      if (!recordings) throw new Error('Recordings are not available');
      if (!Array.isArray(body.rules) || body.rules.length > 20) throw new Error('A list of recordings is expected');
      const ids = (getConfig().plcs ?? []).map((p) => p.id);
      const rules = body.rules.map((r, i) => recordings.check(r, i, ids));
      if (new Set(rules.map((r) => r.id)).size !== rules.length) throw new Error('Two recordings have the same id');
      update((c) => {
        c.recordings = rules;
      });
      log(`admin: recordings saved (${rules.length})`);
      return { rules, status: recordings.list(), plcs: (getConfig().plcs ?? []).map((p) => ({ id: p.id, name: p.name })) };
    },
    'POST alerts/test': async (body) => {
      if (!alerts) throw new Error('Alerts are not available');
      const webhook = String(body.webhook ?? '').trim();
      if (!/^https?:\/\/\S+$/i.test(webhook)) throw new Error('The webhook is an http(s) URL');
      return alerts.test(webhook, ['teams', 'slack', 'json'].includes(body.format) ? body.format : 'json');
    },
    'POST tokens/revoke': async (body) => {
      const name = String(body.name ?? '');
      if (!(getConfig().tokens ?? []).some((t) => t.name === name)) throw new Error(`No token named "${name}"`);
      update((c) => {
        c.tokens = (c.tokens ?? []).filter((t) => t.name !== name);
      });
      log(`admin: token "${name}" revoked`);
      return state();
    },
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...headers });
    res.end(body);
  };
  const json = (res, status, value) => send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json' });

  /** Handles /admin and /admin/api/...; false for other paths */
  return function handle(req, res) {
    const url = new URL(req.url, 'https://gateway');
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return false;
    const config = getConfig();
    const remote = req.socket.remoteAddress ?? '';
    const allowed = LOOPBACK.has(remote) || (config.admin?.allowFrom ?? []).some((a) => a === remote || `::ffff:${a}` === remote);
    if (config.admin?.enabled === false || !allowed) {
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      if (config.admin?.enabled !== false) log(`admin: refused ${remote} (only this computer, or admin.allowFrom)`);
      return true;
    }
    // Another host name pointing here (DNS rebinding): refused
    const hostName = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!localHostNames(config).has(hostName)) {
      send(res, 421, 'Misdirected request', { 'Content-Type': 'text/plain' });
      return true;
    }
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      if (req.method !== 'GET') return send(res, 405, ''), true;
      const nonce = crypto.randomBytes(16).toString('base64');
      send(res, 200, adminPage(nonce), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      return true;
    }
    const route = api[`${req.method} ${url.pathname.slice('/admin/api/'.length)}`];
    if (!url.pathname.startsWith('/admin/api/') || !route) return json(res, 404, { error: 'Not found' }), true;
    // Changes only from the page itself (same origin, JSON): other sites cannot post here
    if (req.method !== 'GET') {
      let origin = '';
      try {
        origin = new URL(req.headers.origin ?? '').host;
      } catch {
        origin = '';
      }
      if (origin !== req.headers.host || !/^application\/json\b/.test(req.headers['content-type'] ?? '')) return json(res, 403, { error: 'Only from the gateway\'s setup page' }), true;
    }
    let raw = '';
    req.on('data', (d) => {
      raw += d;
      if (raw.length > 64 * 1024) req.destroy();
    });
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const result = await route(body && typeof body === 'object' ? body : {});
        if (req.method !== 'GET' && !/^(audit\/search|reports\/preview|test|scan)$/.test(url.pathname.slice('/admin/api/'.length))) {
          audit?.add('setup page', `setup.${url.pathname.slice('/admin/api/'.length)}`, { from: remote });
        }
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return true;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The page: built with DOM calls (text only): device names from the network never become markup

function adminPage(nonce) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gateway Setup</title>
<style nonce="${nonce}">
:root { color-scheme: dark; --bg:#020617; --panel:#0f172a; --line:#1e293b; --text:#e2e8f0; --dim:#94a3b8; --accent:#38bdf8; --ok:#34d399; --bad:#f87171; --warn:#fbbf24; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin: 0 0 12px; font-weight: 600; }
.sub { color: var(--dim); margin: 0 0 20px; } .sub code { color: var(--text); }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
p.hint { color: var(--dim); margin: 8px 0 0; font-size: 13px; }
table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 6px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { color: var(--dim); font-weight: 600; font-size: 12px; } td.mono, .mono { font-family: Consolas, ui-monospace, monospace; font-size: 13px; }
input[type=text], input[type=number], select { background: #020617; color: var(--text); border: 1px solid #334155; border-radius: 6px; padding: 5px 8px; font: inherit; width: 100%; min-width: 0; }
input.mono { font-family: Consolas, ui-monospace, monospace; }
button { background: #1e293b; color: var(--text); border: 1px solid #334155; border-radius: 6px; padding: 6px 12px; font: inherit; cursor: pointer; white-space: nowrap; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .45; cursor: default; }
button.primary { background: #0369a1; border-color: #0284c7; } button.danger:hover:not(:disabled) { border-color: var(--bad); color: var(--bad); }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .row > input[type=text] { flex: 1 1 260px; width: auto; } .row > select { width: auto; max-width: 100%; }
.msg { margin-top: 10px; font-size: 13px; min-height: 1em; } .msg.ok { color: var(--ok); } .msg.bad { color: var(--bad); }
.status { font-size: 12px; } .status.ok { color: var(--ok); } .status.bad { color: var(--bad); } .status.busy { color: var(--warn); }
.admin-check-row td { padding: 4px 8px 10px; font-size: 12px; } .admin-check-step.ok { color: var(--ok); } .admin-check-step.bad { color: var(--bad); } .admin-check-step.warn { color: var(--warn); } .admin-check-verdict { margin-top: 4px; font-weight: 600; }
.tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 9px; background: #1e293b; color: var(--dim); }
.token { margin-top: 12px; padding: 12px; border: 1px solid #0284c7; border-radius: 8px; background: #082f49; }
.token .mono { font-size: 16px; word-break: break-all; color: var(--accent); }
.scroll { overflow-x: auto; } .mt { margin-top: 10px; } .mt6 { margin-top: 6px; } p.hint.flush { margin: 0 0 10px; } .grow { flex: 1; } .nowrap { flex-wrap: nowrap; } .right { text-align: right; } td.w-port { width: 80px; } td.w-status { min-width: 180px; max-width: 300px; } input[data-key=netId], input[data-key=ip] { min-width: 140px; } input[data-key=id], input[data-key=name] { min-width: 100px; } td.w-port { min-width: 70px; }
@media (max-width: 700px) { .hide-sm { display: none; } }
</style></head>
<body><main>
<h1>Kval StateScope gateway: setup</h1>
<p class="sub" id="admin-sub">Loading...</p>

<section>
  <h2>This gateway's AMS NetId</h2>
  <div class="row"><input type="text" class="mono" id="admin-local-netid" placeholder="192.168.1.5.1.1"><select id="admin-netid-suggest"><option value="">Suggested...</option></select></div>
  <p class="hint">Each PLC needs an ADS route to the gateway: this AMS NetId, and the gateway's IP address on the PLC's network. Add the route on the PLC (TwinCAT router: <i>Edit Routes</i>) or from an XAE connected to it.</p>
</section>

<section>
  <h2>Find PLCs on the network</h2>
  <div class="row"><button class="primary" id="admin-scan">Search the network</button><input type="text" id="admin-scan-addresses" placeholder="Also ask these addresses (comma-separated; for PLCs behind a router)"></div>
  <p class="hint">The TwinCAT search (UDP 48899), as the XAE's Add Route dialog does it. It changes nothing on the devices.</p>
  <div class="msg" id="admin-scan-msg"></div>
  <div class="scroll"><table id="admin-found-table" hidden><thead><tr><th></th><th>Name</th><th>AMS NetId</th><th>Address</th><th class="hide-sm">TwinCAT</th><th class="hide-sm">OS</th><th></th></tr></thead><tbody id="admin-found"></tbody></table></div>
  <div class="row mt"><button id="admin-add-found" disabled>Add the ticked ones to the PLCs</button></div>
</section>

<section>
  <h2>PLCs (config.json)</h2>
  <p class="hint flush">The PLCs the web app's Live tab offers. The id names the PLC in the web app (keep it once people use it); ADS port 851 is the first PLC runtime.</p>
  <div class="scroll"><table><thead><tr><th>Id</th><th>Name</th><th>AMS NetId</th><th>Address</th><th>Port</th><th>Status</th><th></th></tr></thead><tbody id="admin-plcs"></tbody></table></div>
  <div class="row mt"><button id="admin-add-plc">Add a PLC by hand</button><span class="grow"></span><button id="admin-revert" disabled>Discard changes</button><button class="primary" id="admin-save" disabled>Save to config.json</button></div>
  <div class="msg" id="admin-save-msg"></div>
</section>

<section>
  <h2>Access tokens</h2>
  <div class="scroll"><table><thead><tr><th>Name</th><th>Created</th><th></th></tr></thead><tbody id="admin-tokens"></tbody></table></div>
  <div class="row mt"><input type="text" id="admin-token-name" placeholder="Who is it for? (a person or team)" maxlength="60"><button class="primary" id="admin-token-create">Create token</button></div>
  <div id="admin-token-new"></div>
  <div class="msg" id="admin-token-msg"></div>
  <p class="hint">Only a token's hash is kept: a new token is shown once. People enter it in the web app's Live tab. A revoked token stops working at once.</p>
</section>
<section>
  <h2>Alerts</h2>
  <p class="hint flush">The gateway follows the state machines under a root by itself (no browser needed) and posts to a webhook when one is stuck (longer in a state than the limit) or goes into an error state, and when it recovers. Teams and Slack: an incoming webhook URL (Teams: a channel's Workflows "post to a channel when a webhook request is received", or an Incoming Webhook connector).</p>
  <div id="admin-alerts"></div>
  <div class="row mt"><button id="admin-alert-add">Add an alert</button><span class="grow"></span><button class="primary" id="admin-alerts-save">Save alerts</button></div>
  <div class="msg" id="admin-alerts-msg"></div>
</section>

<section>
  <h2>Operator boards</h2>
  <p class="hint flush">Saved boards: open one at /?board=&lt;id&gt; (for a screen by the line). Without PLCs ticked, a board shows all of them.</p>
  <div id="admin-boards"></div>
  <div class="row mt"><button id="admin-board-add">Add a board</button><span class="grow"></span><button class="primary" id="admin-boards-save">Save boards</button></div>
  <div class="msg" id="admin-boards-msg"></div>
</section>

<section>
  <h2>Recordings</h2>
  <p class="hint flush">The gateway records every state change of the machines under a root, all day, one file per day (recordings/ next to config.json), and keeps them for the days you choose. Engineers replay a machine's time window from the web app's Live tab (Gateway recordings...).</p>
  <div id="admin-recordings"></div>
  <div class="row mt"><button id="admin-recording-add">Add a recording</button><span class="grow"></span><button class="primary" id="admin-recordings-save">Save recordings</button></div>
  <div class="msg" id="admin-recordings-msg"></div>
</section>
<section>
  <h2>Shift reports</h2>
  <p class="hint flush">The shifts (empty: the whole day). At the end of each shift, its report (alerts, time to acknowledge and to resolve, the machines with the most, maintenance) goes to the webhook; the board downloads it too.</p>
  <div id="admin-shifts"></div>
  <div class="row mt"><button id="admin-shift-add">Add a shift</button></div>
  <table class="mt"><tbody>
    <tr><th>Reports webhook</th><td><input type="text" class="mono" id="admin-report-webhook" placeholder="https://... (empty: not posted)"></td><th>Format</th><td><select id="admin-report-format"><option value="teams">Teams</option><option value="slack">Slack</option><option value="json">JSON</option></select></td></tr>
  </tbody></table>
  <div class="row mt"><button id="admin-report-preview">Preview the last shift</button><button id="admin-report-send">Send it now</button><span class="grow"></span><button class="primary" id="admin-reports-save">Save shifts and reports</button></div>
  <div class="msg" id="admin-reports-msg"></div>
</section>

<section>
  <h2>Run at startup (Windows)</h2>
  <p class="hint flush">The gateway as a Windows scheduled task: it starts with the computer (as SYSTEM, before anyone signs in), is started again when it stops, and has no time limit. Installing needs this gateway to run as an administrator once.</p>
  <div class="row"><span class="status" id="admin-service-status">...</span><span class="grow"></span><button id="admin-service-install">Install</button><button id="admin-service-switch">Switch to the task now</button><button class="danger" id="admin-service-remove">Remove</button></div>
  <div class="msg" id="admin-service-msg"></div>
</section>

<section>
  <h2>Audit log</h2>
  <p class="hint flush">Who did what: sign-ins, going live, acknowledging, maintenance, replays, reports, and the changes on this page. Kept for 24 months (audit-YYYY-MM.jsonl next to config.json).</p>
  <div class="row"><input type="text" id="admin-audit-q" placeholder="Search (user, action, PLC, machine...)"><select id="admin-audit-range"><option value="1">last 24 h</option><option value="7" selected>last 7 days</option><option value="31">last 31 days</option><option value="366">last year</option></select><button id="admin-audit-search">Search</button><button id="admin-audit-csv">Export CSV</button></div>
  <div class="scroll mt"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody id="admin-audit"></tbody></table></div>
  <div class="msg" id="admin-audit-msg"></div>
</section>
<p class="hint" id="admin-foot"></p>
</main>
<script nonce="${nonce}">
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'class') e.className = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) e.append(kid instanceof Node ? kid : String(kid));
    return e;
  };
  const call = async (path, body) => {
    const r = await fetch('/admin/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({ error: 'No answer from the gateway' }));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  };
  const say = (id, text, ok) => { const m = $(id); m.textContent = text; m.className = 'msg ' + (ok === true ? 'ok' : ok === false ? 'bad' : ''); };

  let saved = null;   // the state as saved: PLCs and the gateway's NetId
  let plcs = [];      // the rows being edited
  let found = [];
  const tests = new Map(); // a PLC's settings -> { cls, text } (kept across Save)
  const testKey = (p) => [p.id, p.netId, p.ip, p.port].join('|');

  const dirty = () => JSON.stringify(plcs.map(({ status, ...p }) => p)) !== JSON.stringify(saved.plcs.map(({ status, ...p }) => p)) || $('admin-local-netid').value.trim() !== saved.localNetId;
  const refreshButtons = () => { const d = dirty(); $('admin-save').disabled = !d; $('admin-revert').disabled = !d; };
  const slug = (s) => (s || 'plc').toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plc';
  const uniqueId = (base) => { let id = slug(base), n = 2; while (plcs.some((p) => p.id.toLowerCase() === id)) id = slug(base).slice(0, 36) + '-' + n++; return id; };

  function renderPlcs() {
    const body = $('admin-plcs');
    body.replaceChildren();
    if (!plcs.length) body.append(el('tr', {}, el('td', { colSpan: 7, class: 'status' }, 'No PLCs yet: search the network, or add one by hand.')));
    plcs.forEach((p, i) => {
      const field = (key, cls, type = 'text') => el('input', { type, class: cls || '', value: p[key] ?? '', 'data-key': key, on: { input: (e) => { p[key] = type === 'number' ? Number(e.target.value) : e.target.value; refreshButtons(); } } });
      const t = tests.get(testKey(p)) || (p.status ? { cls: p.status.connected ? 'ok' : '', text: p.status.connected ? 'In use: ' + p.status.viewers + ' viewer(s), PLC ' + (p.status.plcState || '?') : '' } : { cls: '', text: '' });
      const status = el('span', { class: 'status ' + t.cls }, t.text);
      body.append(el('tr', { 'data-plc': p.id },
        el('td', {}, field('id', 'mono')),
        el('td', {}, field('name')),
        el('td', {}, field('netId', 'mono')),
        el('td', {}, field('ip', 'mono')),
        el('td', { class: 'w-port' }, field('port', 'mono', 'number')),
        el('td', { class: 'w-status' }, status),
        el('td', {}, el('div', { class: 'row nowrap' },
          el('button', { class: 'admin-test', on: { click: () => testRow(p, status) } }, 'Test'),
          el('button', { class: 'admin-check', title: 'Why does it not answer? Each step: the network, TwinCAT, its NetId, the route (nothing is changed)', on: { click: () => checkRow(p) } }, 'Check'),
          el('button', { class: 'danger', title: 'Remove from the list (Save to apply)', on: { click: () => { plcs.splice(i, 1); renderPlcs(); renderFound(); refreshButtons(); } } }, 'Remove'))),
      ));
    });
  }

  // Check: the steps in a row under the PLC's
  async function checkRow(p) {
    const tr = document.querySelector('tr[data-plc="' + CSS.escape(p.id) + '"]');
    if (!tr) return;
    let out = tr.nextElementSibling;
    if (!out || !out.classList.contains('admin-check-row')) {
      out = el('tr', { class: 'admin-check-row', 'data-check': p.id }, el('td', { colspan: '7' }));
      tr.after(out);
    }
    const cell = out.firstChild;
    cell.textContent = 'Checking...';
    try {
      const r = await call('check', { id: p.id, name: p.name, netId: String(p.netId).trim(), ip: String(p.ip).trim(), port: Number(p.port) || 851, localNetId: p.localNetId || $('admin-local-netid').value.trim() });
      cell.textContent = '';
      for (const s of r.steps) cell.append(el('div', { class: 'admin-check-step ' + (s.ok === true ? 'ok' : s.ok === false ? 'bad' : 'warn'), 'data-step': s.id, 'data-ok': String(s.ok) }, (s.ok === true ? '✓ ' : s.ok === false ? '✗ ' : '! ') + s.title + (s.detail && s.ok !== true ? ' — ' + s.detail : '')));
      cell.append(el('div', { class: 'admin-check-verdict' }, r.verdict));
    } catch (err) {
      cell.textContent = err.message;
    }
  }

  async function testRow(p, status) {
    status.className = 'status busy';
    status.textContent = 'Testing...';
    try {
      const r = await call('test', { id: p.id, name: p.name, netId: String(p.netId).trim(), ip: String(p.ip).trim(), port: Number(p.port) || 851, localNetId: p.localNetId || $('admin-local-netid').value.trim() });
      tests.set(testKey(p), { cls: r.ok ? 'ok' : 'bad', text: r.message });
    } catch (err) {
      tests.set(testKey(p), { cls: 'bad', text: err.message });
    }
    const t = tests.get(testKey(p));
    status.className = 'status ' + t.cls;
    status.textContent = t.text;
  }

  function renderFound() {
    const body = $('admin-found');
    body.replaceChildren();
    $('admin-found-table').hidden = !found.length;
    for (const d of found) {
      const have = plcs.some((p) => p.netId === d.netId);
      const box = el('input', { type: 'checkbox', checked: !have && d.pick !== false, disabled: have, on: { change: (e) => { d.pick = e.target.checked; updateAdd(); } } });
      d.box = box;
      body.append(el('tr', { 'data-netid': d.netId },
        el('td', {}, box), el('td', {}, d.name || '(no name)'), el('td', { class: 'mono' }, d.netId), el('td', { class: 'mono' }, d.ip),
        el('td', { class: 'hide-sm' }, d.twincat), el('td', { class: 'hide-sm' }, d.os), el('td', {}, have ? el('span', { class: 'tag' }, 'in the list') : '')));
    }
    updateAdd();
  }
  const updateAdd = () => { $('admin-add-found').disabled = !found.some((d) => d.box && d.box.checked && !d.box.disabled); };

  function render(state) {
    saved = { localNetId: state.localNetId, plcs: state.plcs.map((p) => ({ ...p })) };
    plcs = state.plcs.map((p) => ({ ...p }));
    $('admin-local-netid').value = state.localNetId;
    const sel = $('admin-netid-suggest');
    sel.replaceChildren(el('option', { value: '' }, 'Suggested...'), ...state.networks.map((n) => el('option', { value: n.netId }, n.netId + ' (' + n.iface + ', ' + n.address + ')')));
    $('admin-sub').replaceChildren('Version ' + state.version + ' on ' + state.host + ', port ' + state.port + '. Settings in ', el('code', {}, state.configPath), '.');
    $('admin-foot').textContent = 'People open the web app at ' + state.scheme + '://' + state.host + ':' + state.port + '/ . This page works only on the gateway computer.';
    renderPlcs();
    renderFound();
    renderTokens(state.tokens);
    refreshButtons();
  }

  function renderTokens(tokens) {
    const body = $('admin-tokens');
    body.replaceChildren();
    if (!tokens.length) body.append(el('tr', {}, el('td', { colSpan: 3, class: 'status' }, 'No tokens yet: nobody can go live through this gateway.')));
    for (const t of tokens) {
      body.append(el('tr', { 'data-token': t.name },
        el('td', {}, t.name), el('td', {}, t.created ? new Date(t.created).toLocaleString() : ''),
        el('td', { class: 'right' }, el('button', { class: 'danger admin-revoke', on: { click: () => revoke(t.name) } }, 'Revoke'))));
    }
  }

  async function revoke(name) {
    if (!confirm('Revoke the token "' + name + '"? Whoever uses it can no longer go live.')) return;
    try {
      renderTokens((await call('tokens/revoke', { name })).tokens);
      say('admin-token-msg', 'Revoked "' + name + '".', true);
    } catch (err) { say('admin-token-msg', err.message, false); }
  }

  $('admin-netid-suggest').addEventListener('change', (e) => { if (e.target.value) $('admin-local-netid').value = e.target.value; e.target.value = ''; refreshButtons(); });
  $('admin-local-netid').addEventListener('input', refreshButtons);

  $('admin-scan').addEventListener('click', async () => {
    const b = $('admin-scan');
    b.disabled = true;
    say('admin-scan-msg', 'Searching...');
    try {
      const addresses = $('admin-scan-addresses').value.split(/[\\s,;]+/).filter(Boolean);
      const r = await call('scan', { addresses });
      found = r.devices;
      renderFound();
      say('admin-scan-msg', found.length ? found.length + ' TwinCAT device(s) found.' + (r.errors.length ? ' (' + r.errors.join('; ') + ')' : '') : 'None found. A firewall may block UDP 48899, or the PLCs are behind a router: enter their addresses.' + (r.errors.length ? ' (' + r.errors.join('; ') + ')' : ''), found.length ? true : false);
    } catch (err) { say('admin-scan-msg', err.message, false); }
    b.disabled = false;
  });

  $('admin-add-found').addEventListener('click', () => {
    for (const d of found) {
      if (!d.box || !d.box.checked || d.box.disabled) continue;
      plcs.push({ id: uniqueId(d.name || d.ip), name: d.name || d.ip, netId: d.netId, ip: d.ip, port: 851 });
    }
    renderPlcs();
    renderFound();
    refreshButtons();
    say('admin-save-msg', 'Added: check the ids and names, Test, then Save.');
  });

  $('admin-add-plc').addEventListener('click', () => {
    plcs.push({ id: uniqueId('plc'), name: '', netId: '', ip: '', port: 851 });
    renderPlcs();
    refreshButtons();
    const inputs = $('admin-plcs').querySelectorAll('tr:last-child input');
    if (inputs[1]) inputs[1].focus();
  });

  $('admin-revert').addEventListener('click', async () => { render(await call('state')); say('admin-save-msg', ''); });

  $('admin-save').addEventListener('click', async () => {
    try {
      const body = { localNetId: $('admin-local-netid').value.trim(), plcs: plcs.map(({ status, ...p }) => ({ ...p, netId: String(p.netId).trim(), ip: String(p.ip).trim(), port: Number(p.port) || 851 })) };
      render(await call('plcs', body));
      say('admin-save-msg', 'Saved. Viewers of a changed PLC go live again; new ones see the list at once.', true);
    } catch (err) { say('admin-save-msg', err.message, false); }
  });

  $('admin-token-create').addEventListener('click', async () => {
    const name = $('admin-token-name').value.trim();
    if (!name) return say('admin-token-msg', 'Enter who the token is for.', false);
    try {
      const r = await call('tokens', { name });
      $('admin-token-name').value = '';
      renderTokens(r.state.tokens);
      const copy = el('button', { id: 'admin-token-copy', on: { click: async () => { try { await navigator.clipboard.writeText(r.token); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy it'; } } } }, 'Copy');
      $('admin-token-new').replaceChildren(el('div', { class: 'token' },
        el('div', { class: 'status' }, 'Token for "' + r.name + '": shown only now. Give it to that person.'),
        el('div', { class: 'row mt6' }, el('span', { class: 'mono', id: 'admin-token-value' }, r.token), copy)));
      say('admin-token-msg', '');
    } catch (err) { say('admin-token-msg', err.message, false); }
  });
  $('admin-token-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('admin-token-create').click(); });

  window.addEventListener('beforeunload', (e) => { if (saved && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  // ---- Alerts ----
  let alertRules = [];
  let alertPlcs = [];
  let alertStatus = [];
  const seconds = (ms) => (ms ? String(ms / 1000) : '');
  function renderAlerts() {
    const box = $('admin-alerts');
    box.replaceChildren();
    if (!alertRules.length) box.append(el('p', { class: 'hint' }, 'No alerts yet.'));
    alertRules.forEach((r, i) => {
      const st = alertStatus.find((s) => s.id === r.id);
      const input = (key, props = {}) => el('input', { type: 'text', value: r[key] == null ? '' : String(r[key]), 'data-key': key, ...props, on: { input: (e) => { r[key] = e.target.value; } } });
      const check = (key, label) => el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: r[key] !== false, 'data-key': key, on: { change: (e) => { r[key] = e.target.checked; } } }), label);
      const plc = el('select', { 'data-key': 'plc', on: { change: (e) => { r.plc = e.target.value; } } }, ...alertPlcs.map((p) => el('option', { value: p.id, selected: p.id === r.plc }, p.name + ' (' + p.id + ')')));
      const format = el('select', { 'data-key': 'format', on: { change: (e) => { r.format = e.target.value; } } }, ...[['teams', 'Teams'], ['slack', 'Slack'], ['json', 'JSON (any endpoint)']].map(([v, t]) => el('option', { value: v, selected: v === (r.format || 'json') }, t)));
      const stuck = el('input', { type: 'number', min: '1', step: 'any', value: seconds(r.stuckAfterMs), 'data-key': 'stuckAfterMs', on: { input: (e) => { r.stuckAfterMs = e.target.value ? Number(e.target.value) * 1000 : null; } } });
      const limits = el('input', { type: 'text', class: 'mono', 'data-key': 'stateLimits', placeholder: 'TABLEMANAGER_HOMMING=30, ...', value: Object.entries(r.stateLimits || {}).map(([k, v]) => k + '=' + v / 1000).join(', '), on: { input: (e) => {
        const out = {};
        for (const part of e.target.value.split(',')) { const [k, v] = part.split('='); if (k && k.trim() && Number(v) > 0) out[k.trim()] = Number(v) * 1000; }
        r.stateLimits = out;
      } } });
      const result = el('span', { class: 'status' }, st ? st.state + ': ' + st.message + (st.lastAlert ? ' (last: ' + st.lastAlert.kind + ' ' + st.lastAlert.machine + ' ' + new Date(st.lastAlert.at).toLocaleString() + ')' : '') : 'not saved yet');
      if (st) result.className = 'status ' + (st.state === 'watching' ? 'ok' : st.state === 'error' ? 'bad' : 'busy');
      const grid = el('table', {}, el('tbody', {},
        el('tr', {}, el('th', {}, 'Name'), el('td', {}, input('name')), el('th', {}, 'PLC'), el('td', {}, plc)),
        el('tr', {}, el('th', {}, 'Root'), el('td', {}, input('root', { class: 'mono', placeholder: 'MAIN.mainStateMachine' })), el('th', {}, 'State variable'), el('td', {}, input('stateVar', { class: 'mono', placeholder: 'machineState' }))),
        el('tr', {}, el('th', {}, 'Stuck after (s)'), el('td', {}, stuck), el('th', {}, 'Per state (s)'), el('td', {}, limits)),
        el('tr', {}, el('th', {}, 'Error states'), el('td', {}, el('div', { class: 'row nowrap' }, check('onError', 'alert'), input('errorPattern', { class: 'mono', placeholder: 'ERROR|FAULT|ALARM|E_?STOP|ABORT' }))), el('th', {}, 'Recovery'), el('td', {}, check('notifyRecovery', 'also when it recovers'))),
        el('tr', {}, el('th', {}, 'Webhook'), el('td', {}, input('webhook', { class: 'mono', placeholder: 'https://... (empty: the operator board and the history only)' })), el('th', {}, 'Format'), el('td', {}, format)),
        el('tr', {}, el('th', {}, 'Escalate after (min)'), el('td', {}, el('input', { type: 'number', min: '1', value: r.escalateAfterMin == null ? '' : String(r.escalateAfterMin), 'data-key': 'escalateAfterMin', placeholder: 'not acknowledged: post again', on: { input: (e) => { r.escalateAfterMin = e.target.value ? Number(e.target.value) : null; } } })), el('th', {}, 'Escalation webhook'), el('td', {}, input('escalateWebhook', { class: 'mono', placeholder: 'https://... (empty: the webhook above)' }))),
        el('tr', {}, el('th', {}, 'Quiet hours'), el('td', { colSpan: 3 }, input('quietHours', { class: 'mono', placeholder: 'no alerts then, e.g. Mon-Fri 22:00-06:00; Sat,Sun' }))),
      ));
      const test = el('button', { class: 'admin-alert-test', on: { click: async () => {
        test.disabled = true;
        try { const res = await call('alerts/test', { webhook: r.webhook, format: r.format }); say('admin-alerts-msg', res.message, res.ok); }
        catch (err) { say('admin-alerts-msg', err.message, false); }
        test.disabled = false;
      } } }, 'Send a test message');
      box.append(el('div', { class: 'token admin-alert', 'data-alert': r.id || String(i) },
        el('div', { class: 'row' }, check('enabled', 'On'), el('span', { class: 'grow' }), result, test, el('button', { class: 'danger', on: { click: () => { alertRules.splice(i, 1); renderAlerts(); } } }, 'Remove')),
        grid));
    });
  }
  const loadAlerts = async () => {
    const a = await call('alerts');
    alertRules = a.rules.map((r) => ({ ...r }));
    alertPlcs = a.plcs;
    alertStatus = a.status;
    renderAlerts();
  };
  $('admin-alert-add').addEventListener('click', () => {
    if (!alertPlcs.length) return say('admin-alerts-msg', 'Add and save a PLC first.', false);
    alertRules.push({ id: 'alert' + (Date.now() % 100000), name: 'Stuck or in error', enabled: true, plc: alertPlcs[0].id, root: 'MAIN.mainStateMachine', stateVar: 'machineState', stuckAfterMs: 300000, stateLimits: {}, onError: true, errorPattern: 'ERROR|FAULT|ALARM|E_?STOP|ABORT', notifyRecovery: true, webhook: '', format: 'teams' });
    renderAlerts();
  });
  $('admin-alerts-save').addEventListener('click', async () => {
    try {
      const a = await call('alerts', { rules: alertRules });
      alertRules = a.rules.map((r) => ({ ...r }));
      alertStatus = a.status;
      renderAlerts();
      say('admin-alerts-msg', 'Saved: the gateway follows them now.', true);
      window.setTimeout(() => loadAlerts().catch(() => {}), 2500);
    } catch (err) { say('admin-alerts-msg', err.message, false); }
  });
  loadAlerts().catch(() => {});
  window.setInterval(() => { if (!document.activeElement || !$('admin-alerts').contains(document.activeElement)) call('alerts').then((a) => { alertStatus = a.status; alertPlcs = a.plcs; for (const s of a.status) { const card = document.querySelector('.admin-alert[data-alert="' + s.id + '"] .status'); if (card) { card.textContent = s.state + ': ' + s.message + (s.lastAlert ? ' (last: ' + s.lastAlert.kind + ' ' + s.lastAlert.machine + ' ' + new Date(s.lastAlert.at).toLocaleString() + ')' : ''); card.className = 'status ' + (s.state === 'watching' ? 'ok' : s.state === 'error' ? 'bad' : 'busy'); } } }).catch(() => {}); }, 5000);

  // ---- Saved boards ----
  let boardList = [];
  let boardPlcs = [];
  function renderBoards() {
    const box = $('admin-boards');
    box.replaceChildren();
    if (!boardList.length) box.append(el('p', { class: 'hint' }, 'No saved boards: /?board shows all PLCs.'));
    boardList.forEach((b, i) => {
      const input = (key, props = {}) => el('input', { type: 'text', value: b[key] == null ? '' : String(b[key]), 'data-key': key, ...props, on: { input: (e) => { b[key] = e.target.value; } } });
      const ticks = el('div', { class: 'row' }, ...boardPlcs.map((p) => el('label', { class: 'row nowrap' }, el('input', { type: 'checkbox', checked: (b.plcs || []).includes(p.id), 'data-plc': p.id, on: { change: (e) => { b.plcs = e.target.checked ? [...(b.plcs || []), p.id] : (b.plcs || []).filter((x) => x !== p.id); } } }), p.name)));
      const link = el('a', { href: '/?board=' + encodeURIComponent(b.id || ''), target: '_blank', class: 'mono' }, '/?board=' + (b.id || ''));
      box.append(el('div', { class: 'token admin-board', 'data-board': b.id || String(i) },
        el('div', { class: 'row' }, el('span', {}, 'Open: '), link, el('span', { class: 'grow' }), el('button', { class: 'danger', on: { click: () => { boardList.splice(i, 1); renderBoards(); } } }, 'Remove')),
        el('table', {}, el('tbody', {},
          el('tr', {}, el('th', {}, 'Id'), el('td', {}, input('id', { class: 'mono', placeholder: 'line202' })), el('th', {}, 'Title'), el('td', {}, input('title', { placeholder: 'Line 202' }))),
          el('tr', {}, el('th', {}, 'PLCs'), el('td', { colSpan: 3 }, ticks)),
          el('tr', {}, el('th', {}, 'Root'), el('td', {}, input('root', { class: 'mono', placeholder: 'MAIN.mainStateMachine' })), el('th', {}, 'Stuck after (s)'), el('td', {}, el('input', { type: 'number', min: '1', value: b.stuck == null ? '' : String(b.stuck), 'data-key': 'stuck', placeholder: 'for PLCs without an alert rule', on: { input: (e) => { b.stuck = e.target.value ? Number(e.target.value) : null; } } }))),
        ))));
    });
  }
  const loadBoards = async () => {
    const a = await call('boards');
    boardList = a.boards.map((b) => ({ ...b, plcs: [...(b.plcs || [])] }));
    boardPlcs = a.plcs;
    renderBoards();
  };
  $('admin-board-add').addEventListener('click', () => {
    boardList.push({ id: 'board' + (boardList.length + 1), title: '', plcs: [], root: 'MAIN.mainStateMachine', stuck: null });
    renderBoards();
  });
  $('admin-boards-save').addEventListener('click', async () => {
    try {
      const a = await call('boards', { boards: boardList });
      boardList = a.boards.map((b) => ({ ...b, plcs: [...(b.plcs || [])] }));
      renderBoards();
      say('admin-boards-msg', 'Saved: open boards pick it up when they load again.', true);
    } catch (err) { say('admin-boards-msg', err.message, false); }
  });
  loadBoards().catch(() => {});

  // ---- Recordings ----
  let recRules = [];
  let recPlcs = [];
  let recStatus = [];
  function renderRecordings() {
    const box = $('admin-recordings');
    box.replaceChildren();
    if (!recRules.length) box.append(el('p', { class: 'hint' }, 'No recordings yet.'));
    recRules.forEach((r, i) => {
      const st = recStatus.find((s) => s.id === r.id);
      const input = (key, props = {}) => el('input', { type: 'text', value: r[key] == null ? '' : String(r[key]), 'data-key': key, ...props, on: { input: (e) => { r[key] = e.target.value; } } });
      const plc = el('select', { 'data-key': 'plc', on: { change: (e) => { r.plc = e.target.value; } } }, ...recPlcs.map((p) => el('option', { value: p.id, selected: p.id === r.plc }, p.name + ' (' + p.id + ')')));
      const status = el('span', { class: 'status ' + (st ? (st.state === 'watching' ? 'ok' : st.state === 'error' ? 'bad' : 'busy') : '') }, st ? st.state + ': ' + st.message + (st.days.length ? ' · ' + st.days.length + ' day(s) kept, from ' + st.days[0] : '') : 'not saved yet');
      box.append(el('div', { class: 'token admin-recording', 'data-recording': r.id || String(i) },
        el('div', { class: 'row' }, el('label', { class: 'row nowrap' }, el('input', { type: 'checkbox', checked: r.enabled !== false, on: { change: (e) => { r.enabled = e.target.checked; } } }), 'On'), el('span', { class: 'grow' }), status, el('button', { class: 'danger', on: { click: () => { recRules.splice(i, 1); renderRecordings(); } } }, 'Remove')),
        el('table', {}, el('tbody', {},
          el('tr', {}, el('th', {}, 'Id'), el('td', {}, input('id', { class: 'mono' })), el('th', {}, 'Name'), el('td', {}, input('name'))),
          el('tr', {}, el('th', {}, 'PLC'), el('td', {}, plc), el('th', {}, 'Keep (days)'), el('td', {}, el('input', { type: 'number', min: '1', max: '366', value: String(r.days ?? 7), 'data-key': 'days', on: { input: (e) => { r.days = Number(e.target.value); } } }))),
          el('tr', {}, el('th', {}, 'Root'), el('td', {}, input('root', { class: 'mono', placeholder: 'MAIN.mainStateMachine' })), el('th', {}, 'State variable'), el('td', {}, input('stateVar', { class: 'mono', placeholder: 'machineState' }))),
          el('tr', {}, el('th', {}, 'Variables too'), el('td', { colSpan: 3 }, el('input', { type: 'text', class: 'mono', 'data-key': 'vars', value: (r.vars || []).join(', '), placeholder: 'guard values to record, e.g. MAIN.mainStateMachine.smTable1.cmd_bHome', on: { input: (e) => { r.vars = e.target.value.split(/[\\s,;]+/).filter(Boolean); } } }))),
          el('tr', {}, el('th', {}, 'Size limit (MB)'), el('td', {}, el('input', { type: 'number', min: '1', 'data-key': 'maxMB', value: r.maxMB == null ? '' : String(r.maxMB), placeholder: 'none', on: { input: (e) => { r.maxMB = e.target.value ? Number(e.target.value) : null; } } })), el('th', {}, 'Compress past days'), el('td', {}, el('label', { class: 'row nowrap' }, el('input', { type: 'checkbox', checked: r.compress !== false, on: { change: (e) => { r.compress = e.target.checked; } } }), 'gzip'))),
          el('tr', {}, el('th', {}, 'Getting slower (%)'), el('td', {}, el('input', { type: 'number', min: '5', 'data-key': 'slowerPct', value: r.slowerPct == null ? '' : String(r.slowerPct), placeholder: 'off, e.g. 30', on: { input: (e) => { r.slowerPct = e.target.value ? Number(e.target.value) : null; } } })), el('th', {}, 'Its webhook'), el('td', {}, input('slowerWebhook', { class: 'mono', placeholder: 'https://... (empty: the board only)' }))),
        )),
        el('div', { class: 'row mt' }, el('span', { class: 'status' }, st ? 'Disk: ' + (st.bytes / 1048576).toFixed(1) + ' MB, ' + st.days.length + ' day(s) (' + st.compressedDays + ' compressed)' : ''), el('span', { class: 'grow' }), el('button', { class: 'admin-recording-check', on: { click: async () => {
          try { const c = await call('recordings/check', { id: r.id }); say('admin-recordings-msg', c.error || (c.found.length ? c.found.map((x) => x.text).join(' / ') : 'Nothing getting slower'), !c.error); }
          catch (err) { say('admin-recordings-msg', err.message, false); }
        } } }, 'Check for slowdowns now'))));
    });
  }
  const loadRecordings = async () => {
    const a = await call('recordings');
    recRules = a.rules.map((r) => ({ ...r }));
    recPlcs = a.plcs;
    recStatus = a.status;
    renderRecordings();
  };
  $('admin-recording-add').addEventListener('click', () => {
    if (!recPlcs.length) return say('admin-recordings-msg', 'Add and save a PLC first.', false);
    recRules.push({ id: 'rec' + (recRules.length + 1), name: '', enabled: true, plc: recPlcs[0].id, root: 'MAIN.mainStateMachine', stateVar: 'machineState', days: 7 });
    renderRecordings();
  });
  $('admin-recordings-save').addEventListener('click', async () => {
    try {
      const a = await call('recordings', { rules: recRules });
      recRules = a.rules.map((r) => ({ ...r }));
      recStatus = a.status;
      renderRecordings();
      say('admin-recordings-msg', 'Saved: the gateway records them now.', true);
      window.setTimeout(() => loadRecordings().catch(() => {}), 2500);
    } catch (err) { say('admin-recordings-msg', err.message, false); }
  });
  loadRecordings().catch(() => {});

  // ---- Shift reports ----
  let shiftList = [];
  function renderShifts() {
    const box = $('admin-shifts');
    box.replaceChildren();
    if (!shiftList.length) box.append(el('p', { class: 'hint' }, 'No shifts: one report per day.'));
    shiftList.forEach((x, i) => {
      const input = (key, props = {}) => el('input', { type: 'text', value: x[key] ?? '', 'data-key': key, ...props, on: { input: (e) => { x[key] = e.target.value; } } });
      box.append(el('div', { class: 'row admin-shift' }, input('name', { placeholder: 'Early' }), input('from', { class: 'mono', placeholder: '06:00' }), input('to', { class: 'mono', placeholder: '14:00' }), el('button', { class: 'danger', on: { click: () => { shiftList.splice(i, 1); renderShifts(); } } }, 'Remove')));
    });
  }
  const loadReports = async () => {
    const r = await call('reports');
    shiftList = (r.shifts || []).map((x) => ({ ...x }));
    $('admin-report-webhook').value = (r.reports && r.reports.webhook) || '';
    $('admin-report-format').value = (r.reports && r.reports.format) || 'teams';
    renderShifts();
  };
  $('admin-shift-add').addEventListener('click', () => { shiftList.push({ name: '', from: '', to: '' }); renderShifts(); });
  $('admin-reports-save').addEventListener('click', async () => {
    try {
      await call('reports', { shifts: shiftList, reports: { webhook: $('admin-report-webhook').value.trim(), format: $('admin-report-format').value } });
      await loadReports();
      say('admin-reports-msg', 'Saved.', true);
    } catch (err) { say('admin-reports-msg', err.message, false); }
  });
  $('admin-report-preview').addEventListener('click', async () => {
    try { const r = await call('reports/preview', { which: 'last' }); say('admin-reports-msg', r.summary.text, true); }
    catch (err) { say('admin-reports-msg', err.message, false); }
  });
  $('admin-report-send').addEventListener('click', async () => {
    try { const r = await call('reports/send', { which: 'last' }); say('admin-reports-msg', r.message, r.ok); }
    catch (err) { say('admin-reports-msg', err.message, false); }
  });
  loadReports().catch(() => {});

  // ---- Run at startup ----
  const loadService = async () => {
    const st = await call('service');
    const box = $('admin-service-status');
    if (!st.supported) { box.textContent = st.message; box.className = 'status'; ['admin-service-install', 'admin-service-switch', 'admin-service-remove'].forEach((id) => { $(id).disabled = true; }); return; }
    box.textContent = st.installed ? 'Installed (' + (st.status || '?') + ')' : 'Not installed' + (st.elevated ? '' : ' (this gateway does not run as an administrator: it cannot install it)');
    box.className = 'status ' + (st.installed ? 'ok' : '');
    $('admin-service-install').disabled = !st.elevated;
    $('admin-service-remove').disabled = !st.installed || !st.elevated;
    $('admin-service-switch').disabled = !st.installed;
  };
  const serviceAction = (path, question) => async () => {
    if (question && !confirm(question)) return;
    try { const r = await call(path, {}); say('admin-service-msg', r.message + (r.dry ? ' [' + r.dry + ']' : ''), true); await loadService(); }
    catch (err) { say('admin-service-msg', err.message, false); }
  };
  $('admin-service-install').addEventListener('click', serviceAction('service/install'));
  $('admin-service-remove').addEventListener('click', serviceAction('service/remove', 'Remove the startup task? The gateway then only runs while started by hand.'));
  $('admin-service-switch').addEventListener('click', serviceAction('service/switch', 'Stop this gateway and start the task? The page reconnects when it is back (a few seconds).'));
  loadService().catch(() => {});

  // ---- Audit log ----
  let auditRows = [];
  const detailsOf = (e) => Object.entries(e).filter(([k]) => !['t', 'user', 'action'].includes(k)).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
  const searchAudit = async () => {
    try {
      const days = Number($('admin-audit-range').value);
      const r = await call('audit/search', { q: $('admin-audit-q').value, from: Date.now() - days * 86400000, to: Date.now() });
      auditRows = r.events;
      const body = $('admin-audit');
      body.replaceChildren(...auditRows.slice(0, 500).map((e) => el('tr', { class: 'admin-audit-row' }, el('td', { class: 'mono' }, new Date(e.t).toLocaleString()), el('td', {}, e.user), el('td', { class: 'mono' }, e.action), el('td', { class: 'mono' }, detailsOf(e)))));
      say('admin-audit-msg', auditRows.length + ' event(s)' + (auditRows.length > 500 ? ' (the first 500 shown; Export CSV has them all)' : ''), true);
    } catch (err) { say('admin-audit-msg', err.message, false); }
  };
  $('admin-audit-search').addEventListener('click', searchAudit);
  $('admin-audit-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchAudit(); });
  $('admin-audit-csv').addEventListener('click', () => {
    const q = (v) => { const t = v == null ? '' : String(v); return /[",;\\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const lines = ['time,user,action,details', ...auditRows.map((e) => [new Date(e.t).toISOString(), e.user, e.action, detailsOf(e)].map(q).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv' }));
    a.download = 'audit-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  });
  searchAudit();

  call('state').then(render, (err) => { $('admin-sub').textContent = err.message; });
})();
</script>
</body></html>`;
}

module.exports = { createAdmin, checkPlcs };
