// Sign-in with the company's accounts (OpenID Connect: Microsoft Entra ID / Microsoft 365, ADFS, Okta, Google, ...):
// the web app's "Sign in" goes to the identity provider and back; the gateway checks the ID token (signature from
// the provider's keys, issuer, audience, expiry, nonce) and who may use it (users, e-mail domains, groups), then
// keeps a session (an HttpOnly cookie). The live connection of a signed-in page needs no token; tokens keep working
// unless "tokens": false. config.json "oidc": { issuer, clientId, clientSecret?, ... } (see gateway/README.md).
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const COOKIE = 'kss_session';
const PENDING_MS = 10 * 60 * 1000;

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** A JWT's parts, or null */
function decodeJwt(jwt) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) return null;
  try {
    return { header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()), payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()), signed: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], 'base64url') };
  } catch {
    return null;
  }
}

function createAuth({ getConfig, log, secure }) {
  const sessions = new Map(); // id -> { user, name, expires }
  const pending = new Map(); // state -> { verifier, nonce, returnTo, at }
  let discovery = null; // { issuer, doc, at }
  let jwks = null; // { uri, keys, at }

  const oidc = () => {
    const o = getConfig().oidc;
    return o && o.issuer && o.clientId ? o : null;
  };

  async function metadata(o) {
    if (discovery && discovery.issuer === o.issuer && Date.now() - discovery.at < 3600000) return discovery.doc;
    const res = await fetch(`${o.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`The identity provider's configuration: ${res.status}`);
    const doc = await res.json();
    discovery = { issuer: o.issuer, doc, at: Date.now() };
    return doc;
  }

  async function keyFor(doc, kid, retry = true) {
    if (!jwks || jwks.uri !== doc.jwks_uri || Date.now() - jwks.at > 3600000) {
      const res = await fetch(doc.jwks_uri, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`The identity provider's keys: ${res.status}`);
      jwks = { uri: doc.jwks_uri, keys: (await res.json()).keys ?? [], at: Date.now() };
    }
    const jwk = jwks.keys.find((k) => k.kid === kid && (k.kty === 'RSA' || k.kty === 'EC'));
    if (!jwk && retry) {
      // (keys rotate: fetch them again once)
      jwks = null;
      return keyFor(doc, kid, false);
    }
    return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null;
  }

  /** The ID token checked: its claims, or throws why not */
  async function verifyIdToken(o, doc, idToken, nonce) {
    const jwt = decodeJwt(idToken);
    if (!jwt) throw new Error('Not an ID token');
    const alg = jwt.header.alg;
    const hash = { RS256: 'sha256', RS384: 'sha384', RS512: 'sha512', ES256: 'sha256', ES384: 'sha384' }[alg];
    if (!hash) throw new Error(`Unsupported signature (${alg})`);
    const key = await keyFor(doc, jwt.header.kid);
    if (!key) throw new Error('The ID token was signed with an unknown key');
    const ok = alg.startsWith('ES')
      ? crypto.verify(hash, Buffer.from(jwt.signed), { key, dsaEncoding: 'ieee-p1363' }, jwt.signature)
      : crypto.verify(hash, Buffer.from(jwt.signed), key, jwt.signature);
    if (!ok) throw new Error('The ID token\'s signature is not valid');
    const c = jwt.payload;
    const now = Date.now() / 1000;
    if (c.iss !== doc.issuer) throw new Error('The ID token is from another issuer');
    if (!(Array.isArray(c.aud) ? c.aud.includes(o.clientId) : c.aud === o.clientId)) throw new Error('The ID token is for another application');
    if (!(c.exp > now - 60)) throw new Error('The ID token has expired');
    if (c.nbf && c.nbf > now + 60) throw new Error('The ID token is not valid yet');
    if (c.nonce !== nonce) throw new Error('The sign-in does not match (nonce)');
    return c;
  }

  /** Who the claims are, and whether they may use the gateway */
  function userOf(o, c) {
    const user = String(c.preferred_username || c.email || c.upn || c.unique_name || c.sub || '').toLowerCase();
    const name = String(c.name || user);
    const users = (o.allowedUsers ?? []).map((u) => String(u).toLowerCase());
    const domains = (o.allowedDomains ?? []).map((d) => String(d).toLowerCase().replace(/^@/, ''));
    const groups = (o.allowedGroups ?? []).map(String);
    const anyRule = users.length || domains.length || groups.length;
    const allowed = !anyRule
      || users.includes(user)
      || domains.some((d) => user.endsWith(`@${d}`))
      || (Array.isArray(c.groups) && c.groups.some((g) => groups.includes(String(g))))
      || (Array.isArray(c.roles) && c.roles.some((g) => groups.includes(String(g))));
    return { user, name, allowed };
  }

  const redirectUri = (o, req) => o.redirectUri || `${secure ? 'https' : 'http'}://${req.headers.host}/auth/callback`;
  const sessionOf = (req) => {
    const id = parseCookies(req.headers.cookie)[COOKIE];
    const s = id ? sessions.get(id) : null;
    if (s && s.expires < Date.now()) {
      sessions.delete(id);
      return null;
    }
    return s ? { id, ...s } : null;
  };
  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${maxAge}`;
  const page = (res, status, title, text) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Frame-Options': 'DENY' });
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:14px system-ui;background:#020617;color:#e2e8f0;padding:32px"><h1 style="font-size:18px">${esc(title)}</h1><p>${esc(text)}</p><p><a style="color:#38bdf8" href="/">Back to Kval StateScope</a></p>`);
  };
  const json = (res, status, value, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(value));
  };
  const safeReturn = (r) => (typeof r === 'string' && /^\/(?!\/)[\w\-./?=&%#]*$/.test(r) ? r : '/');

  /** Handles /auth/...; false for other paths */
  async function handle(req, res) {
    const url = new URL(req.url, 'https://gateway');
    if (!url.pathname.startsWith('/auth/')) return false;
    const o = oidc();
    try {
      if (url.pathname === '/auth/me') {
        const s = sessionOf(req);
        json(res, 200, { sso: !!o, provider: o?.name || 'your company account', user: s?.user ?? null, name: s?.name ?? null, tokens: o ? o.tokens !== false : true });
        return true;
      }
      if (!o) {
        page(res, 404, 'Not available', 'Sign-in with company accounts is not set up on this gateway.');
        return true;
      }
      if (url.pathname === '/auth/login' && req.method === 'GET') {
        const doc = await metadata(o);
        const state = b64url(crypto.randomBytes(24));
        const nonce = b64url(crypto.randomBytes(24));
        const verifier = b64url(crypto.randomBytes(32));
        const now = Date.now();
        for (const [k, p] of pending) if (now - p.at > PENDING_MS) pending.delete(k);
        pending.set(state, { verifier, nonce, returnTo: safeReturn(url.searchParams.get('return')), at: now });
        const auth = new URL(doc.authorization_endpoint);
        auth.searchParams.set('client_id', o.clientId);
        auth.searchParams.set('response_type', 'code');
        auth.searchParams.set('redirect_uri', redirectUri(o, req));
        auth.searchParams.set('scope', o.scope || 'openid profile email');
        auth.searchParams.set('state', state);
        auth.searchParams.set('nonce', nonce);
        auth.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
        auth.searchParams.set('code_challenge_method', 'S256');
        res.writeHead(302, { Location: auth.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      if (url.pathname === '/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state') ?? '';
        const p = pending.get(state);
        pending.delete(state);
        if (url.searchParams.get('error')) {
          page(res, 401, 'Not signed in', `The identity provider said: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
          return true;
        }
        if (!p || Date.now() - p.at > PENDING_MS) {
          page(res, 400, 'Not signed in', 'The sign-in took too long or was started elsewhere: try again.');
          return true;
        }
        const doc = await metadata(o);
        const form = new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '', redirect_uri: redirectUri(o, req), client_id: o.clientId, code_verifier: p.verifier });
        if (o.clientSecret) form.set('client_secret', o.clientSecret);
        const tr = await fetch(doc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(10000) });
        const tokens = await tr.json().catch(() => ({}));
        if (!tr.ok || !tokens.id_token) throw new Error(`The identity provider did not give an ID token (${tokens.error_description || tokens.error || tr.status})`);
        const claims = await verifyIdToken(o, doc, tokens.id_token, p.nonce);
        const who = userOf(o, claims);
        if (!who.user || !who.allowed) {
          log(`auth: ${who.user || '(unknown)'} signed in but may not use this gateway`);
          page(res, 403, 'No access', `${who.user || 'This account'} may not use this gateway. Ask its administrator to add you.`);
          return true;
        }
        const id = b64url(crypto.randomBytes(32));
        const hours = Number(o.sessionHours) > 0 ? Number(o.sessionHours) : 12;
        sessions.set(id, { user: who.user, name: who.name, expires: Date.now() + hours * 3600000 });
        log(`auth: ${who.user} signed in (${o.name || 'OpenID Connect'})`);
        res.writeHead(302, { Location: p.returnTo, 'Set-Cookie': cookie(id, Math.round(hours * 3600)), 'Cache-Control': 'no-store' });
        res.end();
        return true;
      }
      if (url.pathname === '/auth/logout' && req.method === 'POST') {
        // (only from the gateway's own pages)
        let origin = '';
        try {
          origin = new URL(req.headers.origin ?? '').host;
        } catch {
          origin = '';
        }
        if (origin !== req.headers.host) {
          json(res, 403, { error: 'Only from this gateway\'s pages' });
          return true;
        }
        const s = sessionOf(req);
        if (s) {
          sessions.delete(s.id);
          log(`auth: ${s.user} signed out`);
        }
        json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
        return true;
      }
      page(res, 404, 'Not found', '');
      return true;
    } catch (err) {
      log(`auth: sign-in failed: ${err?.message ?? err}`);
      page(res, 502, 'Not signed in', `The sign-in did not work: ${err?.message ?? err}`);
      return true;
    }
  }

  return {
    handle,
    /** The signed-in user of a request (the live WebSocket), or null */
    userOf: (req) => sessionOf(req)?.user ?? null,
    tokensAllowed: () => oidc()?.tokens !== false,
  };
}

module.exports = { createAuth, decodeJwt, parseCookies };
