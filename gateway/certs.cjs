// The gateway's certificate (the setup page's Certificate): the one it serves (its names, its issuer, until when, how
// many days left), told to the roles that want "cert" once a day from 30 days before it expires. A new one, taken at
// once (no restart): self-signed for this computer's names; or a request (CSR) for the company's CA, its key kept here
// until the certificate the CA issued is installed (its key checked against it); or a PFX. The certificate before kept
// (cert-<when>.pem). node-forge (selfsigned's) makes keys, certificates and requests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tlsMod = require('tls');

const forge = () => require(require.resolve('node-forge', { paths: [path.dirname(require.resolve('selfsigned'))] }));
const DAY = 86400000;

/** This computer's names and addresses (a certificate's) */
function ownNames() {
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  return [os.hostname().toLowerCase(), 'localhost', ...ips, '127.0.0.1'];
}
const namesOf = (text) => [...new Set(String(text ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
const isIp = (x) => /^\d{1,3}(\.\d{1,3}){3}$/.test(x);
const altNames = (names) => names.map((n) => (isIp(n) ? { type: 7, ip: n } : { type: 2, value: n }));

/** A certificate's facts (from its PEM or DER) */
function describe(cert) {
  const x = new crypto.X509Certificate(cert);
  const to = Date.parse(x.validTo);
  return {
    subject: x.subject.replace(/\n/g, ', '), issuer: x.issuer.replace(/\n/g, ', '), selfSigned: x.subject === x.issuer, validFrom: new Date(Date.parse(x.validFrom)).toISOString(), validTo: new Date(to).toISOString(),
    daysLeft: Math.floor((to - Date.now()) / DAY), names: (x.subjectAltName ?? '').split(/,\s*/).map((s) => s.replace(/^(DNS|IP Address):/, '')).filter(Boolean), fingerprint: x.fingerprint256,
  };
}

function createCerts({ baseDir, getConfig, update, log, audit, notify, setContext }) {
  const file = (n) => path.join(baseDir, n);
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  /** The certificate served now (its PEM or its PFX's) */
  function current() {
    const t = getConfig().tls;
    if (!t) return null;
    if (t.cert) return { pem: fs.readFileSync(path.resolve(baseDir, t.cert), 'utf8'), source: 'pem' };
    if (t.pfx) {
      const ctx = tlsMod.createSecureContext({ pfx: fs.readFileSync(path.resolve(baseDir, t.pfx)), passphrase: t.passphrase });
      const der = ctx.context.getCertificate?.();
      return der ? { pem: new crypto.X509Certificate(der).toString(), source: 'pfx' } : null;
    }
    return null;
  }
  /** Taken: its files, config.json's tls, the server's context (no restart) */
  function take({ certPem, keyPem, pfx, passphrase }, what, user) {
    const t = getConfig().tls;
    if (t?.cert && fs.existsSync(path.resolve(baseDir, t.cert))) fs.copyFileSync(path.resolve(baseDir, t.cert), file(`cert-${stamp()}.pem`));
    let tls;
    if (pfx) {
      fs.writeFileSync(file('gateway.pfx'), pfx, { mode: 0o600 });
      tls = { pfx: 'gateway.pfx', passphrase: passphrase ?? '' };
      setContext?.({ pfx, passphrase });
    } else {
      fs.writeFileSync(file('cert.pem'), certPem);
      fs.writeFileSync(file('key.pem'), keyPem, { mode: 0o600 });
      tls = { cert: 'cert.pem', key: 'key.pem' };
      setContext?.({ cert: certPem, key: keyPem });
    }
    update((c) => {
      c.tls = tls;
    });
    const info = this_info();
    log(`certs: ${what}: ${info?.subject} until ${info?.validTo?.slice(0, 10)} (${info?.names?.join(', ')})`);
    audit?.add(user, 'cert', { what, subject: info?.subject, validTo: info?.validTo });
    return info;
  }
  const this_info = () => {
    try {
      const c = current();
      return c ? { ...describe(c.pem), source: c.source } : null;
    } catch (err) {
      return { error: err.message };
    }
  };
  // (once a day: expiring within 30 days, told)
  let toldOn = '';
  const check = () => {
    const i = this_info();
    if (!i || i.error || i.daysLeft > 30) return;
    const today = new Date().toDateString();
    if (toldOn === today) return;
    toldOn = today;
    const text = i.daysLeft < 0 ? `🔒 The gateway's certificate expired on ${i.validTo.slice(0, 10)}: browsers refuse the board (the setup page, Certificate)` : `🔒 The gateway's certificate expires in ${i.daysLeft} day(s), on ${i.validTo.slice(0, 10)}: renew it (the setup page, Certificate)`;
    log(`certs: ${text}`);
    notify?.({ event: 'cert', plc: '', plcName: '', machine: '', state: 'expiring', at: new Date().toISOString(), text });
  };
  const timer = setInterval(check, 6 * 3600_000);
  timer.unref();
  setTimeout(check, 20000).unref();

  return {
    info: this_info,
    ownNames,
    check,
    /** A self-signed certificate for these names (none: this computer's) */
    selfSigned({ names, days = 825 } = {}, user = 'setup page') {
      const list = namesOf(names);
      const all = list.length ? list : ownNames();
      const pems = require('selfsigned').generate([{ name: 'commonName', value: all[0] }], { keySize: 2048, days: Math.max(1, Math.min(3650, Number(days) || 825)), algorithm: 'sha256', extensions: [{ name: 'basicConstraints', cA: false }, { name: 'subjectAltName', altNames: altNames(all) }] });
      return take({ certPem: pems.cert, keyPem: pems.private }, 'self-signed', user);
    },
    /** A request (CSR) for the company's CA; its key kept here (pending-key.pem) for the certificate it issues */
    csr({ commonName, names, organization } = {}, user = 'setup page') {
      const f = forge();
      const list = namesOf(names);
      const cn = String(commonName ?? '').trim() || list[0] || os.hostname().toLowerCase();
      const all = [...new Set([cn, ...(list.length ? list : ownNames())])];
      const keys = f.pki.rsa.generateKeyPair(2048);
      const csr = f.pki.createCertificationRequest();
      csr.publicKey = keys.publicKey;
      csr.setSubject([{ name: 'commonName', value: cn }, ...(organization ? [{ name: 'organizationName', value: String(organization).slice(0, 64) }] : [])]);
      csr.setAttributes([{ name: 'extensionRequest', extensions: [{ name: 'subjectAltName', altNames: altNames(all) }] }]);
      csr.sign(keys.privateKey, f.md.sha256.create());
      fs.writeFileSync(file('pending-key.pem'), f.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
      log(`certs: a request (CSR) for ${cn} (${all.join(', ')}); its key kept until its certificate is installed`);
      audit?.add(user, 'cert.csr', { commonName: cn, names: all });
      return { csr: f.pki.certificationRequestToPem(csr), commonName: cn, names: all };
    },
    /** The certificate the CA issued (PEM, its chain after it), with the request's key (or one given) */
    install({ pem, key } = {}, user = 'setup page') {
      const blocks = String(pem ?? '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      if (!blocks.length) throw new Error('A certificate (PEM: -----BEGIN CERTIFICATE-----), its chain after it');
      const keyPem = String(key ?? '').trim() || (fs.existsSync(file('pending-key.pem')) ? fs.readFileSync(file('pending-key.pem'), 'utf8') : '');
      if (!keyPem) throw new Error('Its key: make the request (CSR) here first, or give the key');
      const leaf = new crypto.X509Certificate(blocks[0]);
      if (!leaf.checkPrivateKey(crypto.createPrivateKey(keyPem))) throw new Error('Its key is not this certificate\'s: the certificate of the last request made here, or its own key');
      if (Date.parse(leaf.validTo) < Date.now()) throw new Error(`It expired on ${leaf.validTo}`);
      const info = take({ certPem: blocks.join('\n') + '\n', keyPem }, 'installed', user);
      fs.rmSync(file('pending-key.pem'), { force: true });
      return info;
    },
    /** A PFX (its passphrase) */
    installPfx({ pfx, passphrase } = {}, user = 'setup page') {
      const buf = Buffer.from(String(pfx ?? ''), 'base64');
      if (!buf.length) throw new Error('A PFX file');
      try {
        tlsMod.createSecureContext({ pfx: buf, passphrase: passphrase ?? '' });
      } catch (err) {
        throw new Error(`Not taken: ${/mac verify|password/i.test(err.message) ? 'its passphrase is not this one' : err.message}`);
      }
      return take({ pfx: buf, passphrase: passphrase ?? '' }, 'PFX installed', user);
    },
    pending: () => fs.existsSync(file('pending-key.pem')),
    stop: () => clearInterval(timer),
  };
}

module.exports = { createCerts, describe, ownNames };
