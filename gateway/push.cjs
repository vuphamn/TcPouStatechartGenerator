// Web Push: the board's alerts on a phone or a PC with the browser closed (the board installed as an app, its
// notifications allowed). Standard Web Push, without other packages: the gateway's VAPID key pair (made once, kept in
// push.json beside config.json), each device's subscription (its push service's address and keys, the user, the PLCs
// and the kinds of events it wants), each message encrypted for that device (RFC 8291, aes128gcm) and signed (VAPID,
// RFC 8292: ES256). The browser's push service (Google's, Mozilla's, Apple's, Microsoft's) carries it: the gateway
// needs to reach the internet for this. A device gone (its service answers 404 or 410): its subscription dropped.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EVENTS = ['error', 'stuck', 'plcStopped', 'drive', 'slower', 'call', 'workorder', 'handover', 'parts', 'change', 'escalated', 'recovered'];
const DEFAULT_EVENTS = ['error', 'stuck', 'plcStopped', 'drive', 'call', 'escalated'];

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** A message encrypted for one subscription (RFC 8291): the body of the push request */
function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh);
  const secret = unb64u(auth);
  if (uaPublic.length !== 65 || secret.length !== 16) throw new Error('Not a push subscription: its keys');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** The VAPID header of a request to that push service (RFC 8292) */
function vapidAuth(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: keys.d, x: keys.x, y: keys.y }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

function createPush({ baseDir, getConfig, log, audit }) {
  const file = path.join(baseDir, 'push.json');
  let state = { keys: null, subs: [] };
  try {
    state = { keys: null, subs: [], ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // none yet
  }
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`push: ${err.message}`);
    }
  };
  if (!state.keys) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65);
    state.keys = { d: jwk.d, x: jwk.x, y: jwk.y, publicKey: b64u(raw) };
    save();
  }
  const subject = () => getConfig().push?.subject || 'mailto:support@kvalinc.com';
  const enabled = () => getConfig().push?.enabled !== false;

  async function sendTo(sub, payload) {
    const body = encrypt(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(sub.endpoint, state.keys, subject()) },
      body,
      signal: AbortSignal.timeout(15000),
    });
    return res.status;
  }

  return {
    enabled,
    publicKey: () => state.keys.publicKey,
    /** A device's subscription (one per its address), for a user: the PLCs (none: all) and the events it wants */
    subscribe(sub, { user, plcs, events, label }) {
      if (!enabled()) throw new Error('Push notifications are off on this gateway (config.json "push": { "enabled": false })');
      const endpoint = String(sub?.endpoint ?? '');
      if (!/^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\S*)$/.test(endpoint) || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Not a push subscription');
      encrypt('x', sub.keys.p256dh, sub.keys.auth);
      const s = {
        endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, user, label: String(label ?? '').slice(0, 80),
        plcs: (Array.isArray(plcs) ? plcs : []).map(String).slice(0, 100),
        events: (Array.isArray(events) && events.length ? events : DEFAULT_EVENTS).filter((e) => EVENTS.includes(e)),
        at: Date.now(),
      };
      state.subs = [...state.subs.filter((x) => x.endpoint !== endpoint), s];
      save();
      audit?.add(user, 'push.subscribe', { label: s.label, events: s.events, plcs: s.plcs });
      log(`push: ${user} subscribed a device${s.label ? ` (${s.label})` : ''}: ${s.events.join(', ')}`);
      return { events: s.events, plcs: s.plcs };
    },
    unsubscribe(endpoint, user) {
      const before = state.subs.length;
      state.subs = state.subs.filter((x) => x.endpoint !== endpoint);
      if (state.subs.length !== before) {
        save();
        audit?.add(user, 'push.unsubscribe', {});
      }
    },
    /** This device's subscription as kept (the board shows it) */
    of: (endpoint) => {
      const s = state.subs.find((x) => x.endpoint === endpoint);
      return s ? { events: s.events, plcs: s.plcs } : null;
    },
    /** An alert (or a call, a work order, a handover, a part low) to the devices that want it */
    async notify(e) {
      if (!enabled() || !state.subs.length || e.muted) return;
      const kind = e.escalatedAt && !e.ack ? 'escalated' : e.event;
      const wanted = state.subs.filter((s) => s.events.includes(kind) && (!s.plcs.length || !e.plc || s.plcs.includes(e.plc)));
      if (!wanted.length) return;
      const machine = e.machine && e.machine !== '(the line)' && /^[\w.[\]]+$/.test(e.machine) && e.plc ? `&focus=${encodeURIComponent(`m:${e.plc}|${e.machine}`)}` : '';
      const payload = { title: e.plcName || 'Kval MachineScope', body: String(e.text ?? '').replace(/^[^:]*:\s*/, '').slice(0, 300), url: `/?board${machine}`, tag: e.id || `${kind}-${Date.now()}`, kind };
      let gone = 0;
      await Promise.all(
        wanted.map(async (s) => {
          try {
            const status = await sendTo(s, payload);
            if (status === 404 || status === 410) {
              state.subs = state.subs.filter((x) => x.endpoint !== s.endpoint);
              gone++;
            } else if (status >= 400) log(`push: ${s.user}'s device: its push service answered ${status}`);
          } catch (err) {
            log(`push: ${s.user}'s device: ${err.message}`);
          }
        })
      );
      if (gone) {
        save();
        log(`push: ${gone} device(s) gone, dropped`);
      }
    },
    /** A test to this device */
    test: (endpoint, user) => {
      const s = state.subs.find((x) => x.endpoint === endpoint);
      if (!s) throw new Error('This device is not subscribed');
      return sendTo(s, { title: 'Kval MachineScope', body: `A test for ${user}: alerts will come like this`, url: '/?board', tag: 'test', kind: 'test' });
    },
    count: () => state.subs.length,
  };
}

module.exports = { createPush, encrypt, vapidAuth, EVENTS: EVENTS, DEFAULT_EVENTS, b64u, unb64u };
