// Email and SMS for the roles' alerts (gateway/channels.cjs, roles.cjs; a mail server and Twilio of this computer;
// simulated PLC symbols-plc.cjs): a call for maintenance emailed to the supervisors (SMTP: its user and password, its
// sender, its recipients, its subject) and texted to the technician on call (Twilio: its account, its numbers); the
// setup page: the settings shown without their secrets, saved keeping them, a test email; the support bundle's config
// without the password, the token or the people's addresses.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { sanitized } = require(path.join(h.REPO, 'gateway', 'support.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8517;
const SMTP = 8518;
const TWILIO = 8519;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'channels-test-token';
const M = `${R}.aDoors[2]`;

(async () => {
  // The mail server: each mail's conversation and its message
  const mails = [];
  const smtp = net.createServer((s) => {
    const mail = { lines: [], data: '' };
    let inData = false;
    let buf = '';
    s.write('220 fake ESMTP\r\n');
    s.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            mails.push(mail);
            s.write('250 queued\r\n');
          } else mail.data += `${line}\n`;
          continue;
        }
        mail.lines.push(line);
        if (/^EHLO/i.test(line)) s.write('250-fake.example\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (/^AUTH PLAIN/i.test(line)) s.write('235 accepted\r\n');
        else if (/^(MAIL FROM|RCPT TO)/i.test(line)) s.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) {
          inData = true;
          s.write('354 go on\r\n');
        } else if (/^QUIT/i.test(line)) {
          s.write('221 bye\r\n');
          s.end();
        } else s.write('500 what\r\n');
      }
    });
    s.on('error', () => {});
  }).listen(SMTP);
  // Twilio: each message's account, numbers, text
  const texts = [];
  const twilio = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      texts.push({ path: req.url, auth: req.headers.authorization, form: Object.fromEntries(new URLSearchParams(b)) });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('{"sid":"SM1"}');
    });
  }).listen(TWILIO);
  const cfg = writeSymbolsPlc('fake-ams2-channels.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48967', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-channels');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 2', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48967', port: 851 }],
    tokens: [{ name: 'ann', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    smtp: { host: '127.0.0.1', port: SMTP, user: 'alerts@acme.com', pass: 's3cret', from: 'MachineScope <alerts@acme.com>' },
    sms: { provider: 'twilio', accountSid: 'AC123', authToken: 'tok456', from: '+15550001111', apiBase: `http://127.0.0.1:${TWILIO}` },
    roles: {
      users: { ann: 'operator' }, groups: {}, default: '', startPages: {},
      notify: [
        { role: 'supervisor', channel: 'email', to: 'sup@acme.com, boss@acme.com', events: ['call'], onCall: [] },
        { role: 'technician', channel: 'sms', to: '+15559990000', events: ['call'], onCall: [{ name: 'Bob', days: '', from: '00:00', to: '24:00', contact: '+15551234567' }] },
      ],
    },
    workorders: { fromCalls: false },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-channels-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  // 1. A call: emailed, texted
  ws.send(JSON.stringify({ type: 'callMaintenance', requestId: 1, plc: 'line', machine: M, reason: 'Electrical', note: 'S12 dark' }));
  const mail = await h.until(() => mails[0], 10000);
  // (its subject: RFC 2047 encoded words, folded, decoded here; each at most 75 characters)
  const subjectLines = /^Subject: .*(\n[ \t].*)*/m.exec(mail?.data ?? '')?.[0] ?? '';
  const words = subjectLines.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? [];
  const subject = words.length ? words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('') : subjectLines.replace(/^Subject: /, '');
  if (mail) mail.data = mail.data.replace(subjectLines, `Subject: ${subject}`);
  expect(words.every((w) => w.length <= 75), `its subject's encoded words: ${words.length}, at most ${Math.max(0, ...words.map((w) => w.length))} characters`);
  const auth = mail?.lines.find((l) => /^AUTH PLAIN/.test(l));
  const creds = auth ? Buffer.from(auth.split(' ')[2], 'base64').toString().split('\0') : [];
  expect(creds[1] === 'alerts@acme.com' && creds[2] === 's3cret' && mail.lines.includes('MAIL FROM:<alerts@acme.com>') && mail.lines.includes('RCPT TO:<sup@acme.com>') && mail.lines.includes('RCPT TO:<boss@acme.com>') && /^Subject: Line 2: .*calls maintenance/m.test(mail.data) && /S12 dark/.test(mail.data), `emailed: ${mail?.lines.filter((l) => /^(MAIL|RCPT)/.test(l)).join(' ')}; ${/^Subject: .*/m.exec(mail?.data ?? '')?.[0]}`);
  const sms = await h.until(() => texts[0], 10000);
  expect(sms?.path === '/2010-04-01/Accounts/AC123/Messages.json' && Buffer.from((sms.auth ?? '').split(' ')[1] ?? '', 'base64').toString() === 'AC123:tok456' && sms.form.To === '+15551234567' && sms.form.From === '+15550001111' && /calls maintenance/.test(sms.form.Body) && /on call.*Bob/.test(sms.form.Body) && texts.length === 1, `texted the one on call: ${sms?.form?.To} "${sms?.form?.Body?.slice(0, 60)}…"`);
  ws.close();
  // 2. The setup page: no secrets shown; saved keeping them; a test email
  const api = (method, p, body) =>
    new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: `/admin/api/${p}`, method, headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
        let t = '';
        res.on('data', (d) => (t += d));
        res.on('end', () => resolve((() => { try { return JSON.parse(t); } catch { return null; } })()));
      });
      r.on('error', () => resolve(null));
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const shown = await api('GET', 'channels');
  await api('POST', 'channels', { smtp: { ...shown.smtp, pass: '' }, sms: { ...shown.sms, authToken: '' } });
  const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const tested = await api('POST', 'channelsTest', { kind: 'email', to: 'me@acme.com' });
  await h.until(() => mails.find((m) => m.lines.includes('RCPT TO:<me@acme.com>')), 10000);
  expect(shown?.smtp?.pass === undefined && shown.smtp.hasPass === true && shown.sms.authToken === undefined && shown.sms.hasToken === true && after.smtp.pass === 's3cret' && after.sms.authToken === 'tok456' && tested?.ok, `the setup page: secrets not shown (${shown?.smtp?.hasPass}, ${shown?.sms?.hasToken}), kept when saved empty; a test email sent (${tested?.ok})`);
  const bad = await api('POST', 'channels', { smtp: {}, sms: { provider: 'http', url: 'nope' } });
  expect(/its URL/.test(bad?.error ?? ''), `a bad SMS provider refused: ${bad?.error}`);
  // 3. The support bundle's config: no secrets, no people's addresses
  const clean = JSON.stringify(sanitized(after));
  expect(!/s3cret|tok456|AC123|sup@acme|\+15551234567|\+15559990000/.test(clean) && /14:00|24:00/.test(clean), 'the support bundle: no password, token, account, addresses or numbers (the on-call hours kept)');
  gw.kill();
  plc.kill();
  smtp.close();
  twilio.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
