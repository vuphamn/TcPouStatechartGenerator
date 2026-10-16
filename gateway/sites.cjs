// Several gateways in one view: the other gateways of the plant (config.json "sites": [{ "id", "name", "url":
// "https://gw-line4:8443", "token": "<a view-only token of that gateway>", "root": "MAIN.mainStateMachine",
// "insecureTls": false }]), each followed as a display follows its board (its /live, its token: view only, nothing
// changed there): its PLCs, how many of its machines are in error or stuck, its open alerts, its state (connected or
// why not). The board's Sites page shows them, each with a link to that gateway's own board. Reconnected every 15 s
// while it is away.
const WebSocket = require('ws');

function createSites({ getConfig, log }) {
  const sites = new Map(); // id -> { conf, ws, state, message, plcs, alerts, at, timer }
  const listeners = new Set();
  const publish = () => {
    for (const fn of listeners) fn();
  };
  const confOf = () => (Array.isArray(getConfig().sites) ? getConfig().sites : []).filter((s) => s && s.id && /^https?:\/\//i.test(String(s.url ?? '')));

  function connect(s) {
    clearTimeout(s.timer);
    const u = new URL(String(s.conf.url));
    const wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/live`;
    let ws;
    try {
      ws = new WebSocket(wsUrl, { headers: { origin: u.origin }, rejectUnauthorized: !s.conf.insecureTls, handshakeTimeout: 10000 });
    } catch (err) {
      s.state = 'error';
      s.message = err.message;
      s.timer = setTimeout(() => connect(s), 15000);
      return;
    }
    s.ws = ws;
    s.state = 'connecting';
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: String(s.conf.token ?? '') })));
    ws.on('message', (d) => {
      let m;
      try {
        m = JSON.parse(d.toString());
      } catch {
        return;
      }
      if (m.type === 'welcome') {
        s.state = 'connected';
        s.message = '';
        s.names = Object.fromEntries((m.plcs ?? []).map((p) => [p.id, p.name]));
        ws.send(JSON.stringify({ type: 'boardWatch', plcs: [], root: s.conf.root || 'MAIN.mainStateMachine' }));
        ws.send(JSON.stringify({ type: 'alertsList' }));
        publish();
      } else if (m.type === 'boardState' && Array.isArray(m.plcs)) {
        s.plcs = m.plcs.map((p) => ({ id: p.id, name: p.name ?? s.names?.[p.id] ?? p.id, plcState: p.plcState ?? null, machines: (p.machines ?? []).length, error: (p.machines ?? []).filter((x) => x.error).length, stuck: (p.machines ?? []).filter((x) => x.stuck && !x.error).length, message: p.message ?? '' }));
        s.at = Date.now();
        publish();
      } else if (m.type === 'alertsList' && Array.isArray(m.events)) {
        s.events = new Map(m.events.map((e) => [e.id, e]));
        s.alerts = [...s.events.values()].filter((e) => !e.resolvedAt && !e.muted && e.event !== 'recovered').length;
        publish();
      } else if (m.type === 'alertEvent' && m.event) {
        (s.events ??= new Map()).set(m.event.id, m.event);
        s.alerts = [...s.events.values()].filter((e) => !e.resolvedAt && !e.muted && e.event !== 'recovered').length;
        publish();
      } else if (m.type === 'denied') {
        s.message = 'Its token was not accepted: a view-only token of that gateway (its setup page, Tokens)';
      } else if (m.type === 'error' || m.type === 'closed') {
        s.message = m.message ?? '';
      }
    });
    ws.on('close', (code, reason) => {
      if (s.stopped) return;
      s.state = 'error';
      s.message = s.message || (code === 4401 || code === 4403 ? 'Its token was not accepted (a view-only token of that gateway)' : `Not reached (${String(reason || code)})`);
      publish();
      s.timer = setTimeout(() => connect(s), 15000);
    });
    ws.on('error', (err) => {
      s.message = err.message;
    });
  }

  const apply = () => {
    const wanted = confOf();
    for (const [id, s] of sites) {
      const c = wanted.find((x) => x.id === id);
      if (c && JSON.stringify(c) === JSON.stringify(s.conf)) continue;
      s.stopped = true;
      clearTimeout(s.timer);
      s.ws?.terminate();
      sites.delete(id);
    }
    for (const c of wanted) {
      if (sites.has(c.id)) continue;
      const s = { conf: c, state: 'connecting', message: '', plcs: [], alerts: 0, at: null };
      sites.set(c.id, s);
      connect(s);
      log(`sites: following ${c.name || c.id} (${c.url})`);
    }
    publish();
  };

  return {
    apply,
    start: () => apply(),
    stop() {
      for (const s of sites.values()) {
        s.stopped = true;
        clearTimeout(s.timer);
        s.ws?.terminate();
      }
      sites.clear();
    },
    count: () => sites.size,
    view: () => [...sites.values()].map((s) => ({ id: s.conf.id, name: s.conf.name || s.conf.id, url: String(s.conf.url).replace(/\/+$/, ''), state: s.state, message: s.message, plcs: s.plcs, alerts: s.alerts ?? 0, at: s.at })),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createSites };
