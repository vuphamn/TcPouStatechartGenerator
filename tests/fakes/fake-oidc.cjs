// Fake OpenID Connect provider (as Microsoft Entra ID does it): discovery, authorize (signs in the "next user" at
// once and redirects back with a code), token (checks the PKCE verifier; an RS256 ID token with the nonce), keys.
// POST /next-user { user, groups } sets who signs in next. Usage: node fake-oidc.cjs <port>
const http = require('http');
const crypto = require('crypto');
const port = Number(process.argv[2]);
const issuer = `http://127.0.0.1:${port}`;
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const codes = new Map();
let next = { user: 'alice@kval.test', name: 'Alice Tester', groups: ['g-operators'] };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function idToken(claims) {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64(claims);
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, issuer);
    const send = (status, value, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(typeof value === 'string' ? value : JSON.stringify(value));
    };
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (url.pathname === '/.well-known/openid-configuration') {
        return send(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys` });
      }
      if (url.pathname === '/keys') return send(200, { keys: [jwk] });
      if (url.pathname === '/next-user' && req.method === 'POST') {
        next = { ...next, ...JSON.parse(body || '{}') };
        return send(200, { ok: true });
      }
      if (url.pathname === '/authorize') {
        const q = url.searchParams;
        if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256') return send(400, { error: 'bad request' });
        const code = crypto.randomBytes(16).toString('hex');
        codes.set(code, { clientId: q.get('client_id'), redirectUri: q.get('redirect_uri'), nonce: q.get('nonce'), challenge: q.get('code_challenge'), who: next });
        const back = new URL(q.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('state', q.get('state'));
        console.log(`authorize: ${next.user} -> ${back.origin}${back.pathname}`);
        res.writeHead(302, { Location: back.toString() });
        return res.end();
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const f = new URLSearchParams(body);
        const c = codes.get(f.get('code'));
        codes.delete(f.get('code'));
        const verifierOk = c && crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url') === c.challenge;
        if (!c || c.clientId !== f.get('client_id') || c.redirectUri !== f.get('redirect_uri') || !verifierOk) {
          console.log('token: refused');
          return send(400, { error: 'invalid_grant', error_description: 'code, client, redirect or verifier do not match' });
        }
        const now = Math.floor(Date.now() / 1000);
        const token = idToken({ iss: issuer, aud: c.clientId, sub: c.who.user, preferred_username: c.who.user, name: c.who.name, groups: c.who.groups, nonce: c.nonce, iat: now, exp: now + 3600 });
        console.log(`token: ${c.who.user}`);
        return send(200, { id_token: token, access_token: 'x', token_type: 'Bearer' });
      }
      send(404, { error: 'not found' });
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`fake oidc on ${port}`));
