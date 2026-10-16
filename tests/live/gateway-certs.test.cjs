// The gateway's certificate (gateway/certs.cjs; https): the one served shown (10 days left: told); a new self-signed
// one for given names, served at once (no restart); a request (CSR) signed by a CA of this test, its certificate
// installed (matched to the request's key), served at once; another key's certificate refused; the setup page's script.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
const vm = require('vm');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8528;
const forge = require(require.resolve('node-forge', { paths: [path.dirname(require.resolve('selfsigned', { paths: [path.join(h.REPO, 'gateway')] }))] }));
const selfsigned = require(require.resolve('selfsigned', { paths: [path.join(h.REPO, 'gateway')] }));

(async () => {
  const dir = h.out('gw-certs');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // (its certificate: 10 days left)
  const first = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 10, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }] });
  fs.writeFileSync(path.join(dir, 'cert.pem'), first.cert);
  fs.writeFileSync(path.join(dir, 'key.pem'), first.private);
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, tls: { cert: 'cert.pem', key: 'key.pem' }, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], plcs: [], tokens: [],
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-certs-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  const BASE = `https://localhost:${PORT}`;
  const api = (method, p, body) =>
    new Promise((resolve) => {
      const r = https.request({ host: '127.0.0.1', port: PORT, path: p, method, rejectUnauthorized: false, servername: 'localhost', headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
        let t = '';
        res.on('data', (d) => (t += d));
        res.on('end', () => resolve({ status: res.statusCode, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }));
      });
      r.on('error', (e) => resolve({ status: 0, error: e.message }));
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });
  // (the certificate a new connection is served)
  const served = () =>
    new Promise((resolve) => {
      const s = tls.connect({ host: '127.0.0.1', port: PORT, servername: 'localhost', rejectUnauthorized: false }, () => {
        const c = s.getPeerCertificate();
        s.end();
        resolve({ fingerprint: c.fingerprint256, issuer: c.issuer?.CN, alt: c.subjectaltname });
      });
      s.on('error', () => resolve(null));
    });
  // 1. Shown; 10 days left: told
  const shown = await api('GET', '/admin/api/cert');
  const told = await h.until(() => (/certificate expires in (9|10) day/.test(fs.readFileSync(logFile, 'utf8')) ? true : null), 30000);
  expect(shown.json?.info?.daysLeft >= 9 && shown.json.info.daysLeft <= 10 && shown.json.info.selfSigned && shown.json.info.names.includes('localhost') && shown.json.own.length >= 2 && told, `shown: ${shown.json?.info?.subject}, ${shown.json?.info?.daysLeft} days left (told: ${!!told})`);
  // 2. A new self-signed one, served at once
  const before = await served();
  const made = await api('POST', '/admin/api/cert/selfsigned', { names: 'gw-test, localhost, 10.1.2.3' });
  const after = await served();
  expect(made.json?.names?.includes('gw-test') && made.json.daysLeft > 800 && after?.fingerprint !== before?.fingerprint && /gw-test/.test(after?.alt ?? '') && fs.readdirSync(dir).some((n) => /^cert-\d{8}-\d{6}\.pem$/.test(n)), `self-signed: ${made.json?.names?.join(', ')}; served at once (${after?.alt}); the one before kept`);
  // 3. A request, signed by a CA, installed
  const csr = await api('POST', '/admin/api/cert/csr', { names: 'gw-test.acme.com, localhost', organization: 'Acme' });
  const req = forge.pki.certificationRequestFromPem(csr.json?.csr ?? '');
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const ca = forge.pki.createCertificate();
  ca.publicKey = caKeys.publicKey;
  ca.serialNumber = '01';
  ca.validity.notBefore = new Date(Date.now() - 60000);
  ca.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  ca.setSubject([{ name: 'commonName', value: 'Acme Test CA' }]);
  ca.setIssuer([{ name: 'commonName', value: 'Acme Test CA' }]);
  ca.setExtensions([{ name: 'basicConstraints', cA: true }]);
  ca.sign(caKeys.privateKey, forge.md.sha256.create());
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = req.publicKey;
  leaf.serialNumber = '02';
  leaf.validity.notBefore = new Date(Date.now() - 60000);
  leaf.validity.notAfter = new Date(Date.now() + 397 * 86400000);
  leaf.setSubject(req.subject.attributes);
  leaf.setIssuer(ca.subject.attributes);
  leaf.setExtensions(req.getAttribute({ name: 'extensionRequest' }).extensions);
  leaf.sign(caKeys.privateKey, forge.md.sha256.create());
  const chain = forge.pki.certificateToPem(leaf) + forge.pki.certificateToPem(ca);
  // (another key's certificate: refused)
  const other = selfsigned.generate([{ name: 'commonName', value: 'other' }], { keySize: 2048, days: 30 });
  const refused = await api('POST', '/admin/api/cert/install', { pem: other.cert });
  const installed = await api('POST', '/admin/api/cert/install', { pem: chain });
  const now = await served();
  expect(/BEGIN CERTIFICATE REQUEST/.test(csr.json?.csr ?? '') && csr.json.commonName === 'gw-test.acme.com' && refused.status >= 400 && /not this certificate/.test(refused.json?.error ?? '') && installed.json?.issuer?.includes('Acme Test CA') && now?.issuer === 'Acme Test CA' && !fs.existsSync(path.join(dir, 'pending-key.pem')), `a request for ${csr.json?.commonName}; another key's refused (${refused.json?.error}); the CA's installed, served at once (its issuer ${now?.issuer})`);
  const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(conf.tls.cert === 'cert.pem' && conf.tls.key === 'key.pem', 'config.json: its certificate files');
  // 4. The setup page's script
  const page = await api('GET', '/admin');
  const scripts = [...page.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const bad = scripts.map((s) => { try { new vm.Script(s); return null; } catch (e) { return e.message; } }).filter(Boolean);
  expect(scripts.length >= 1 && !bad.length && /admin-cert-csr/.test(page.text), `the setup page's script parses${bad.length ? `: ${bad.join('; ')}` : ''}`);
  gw.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
