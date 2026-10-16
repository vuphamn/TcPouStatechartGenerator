// Email and SMS for the roles' alerts (roles.cjs), without other packages:
// - email: SMTP (config.json "smtp": { "host", "port": 587 (STARTTLS) or 465 (TLS) or 25, "secure": port 465,
//   "user", "pass", "from": "MachineScope <alerts@acme.com>", "rejectUnauthorized": true }), AUTH PLAIN or LOGIN;
// - SMS: Twilio ("sms": { "provider": "twilio", "accountSid", "authToken", "from": "+15550001111" }) or any provider's
//   HTTP API ("sms": { "provider": "http", "url": "https://…?to={to}&text={text}", "method": "GET" | "POST",
//   "headers": { … }, "body": "{\"to\":\"{to}\",\"text\":\"{text}\"}" }), {to} and {text} filled in (escaped for the URL
//   in its address, for JSON in a JSON body).
const net = require('net');
const tls = require('tls');
const os = require('os');

/** An SMTP conversation: its replies read line by line (a multi-line reply: its last line) */
function smtpSession(socket, timeoutMs) {
  let buf = '';
  let waiting = null;
  const lines = [];
  const take = () => {
    while (waiting) {
      const i = lines.findIndex((l) => /^\d{3} /.test(l));
      if (i < 0) return;
      const reply = lines.splice(0, i + 1);
      const w = waiting;
      waiting = null;
      clearTimeout(w.timer);
      w.resolve({ code: Number(reply.at(-1).slice(0, 3)), text: reply.map((l) => l.slice(4)).join(' ') });
    }
  };
  const onData = (d) => {
    buf += d.toString('utf8');
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    lines.push(...parts);
    take();
  };
  socket.on('data', onData);
  const reply = () =>
    new Promise((resolve, reject) => {
      waiting = { resolve, reject, timer: setTimeout(() => reject(new Error('The mail server did not answer in time')), timeoutMs) };
      take();
    });
  return { reply, off: () => socket.off('data', onData) };
}

/** An email sent: { to: [..], subject, text } with config.smtp */
async function sendEmail(smtp, { to, subject, text }) {
  if (!smtp?.host) throw new Error('No mail server: the setup page\'s Email and SMS');
  const port = Number(smtp.port) || 587;
  const secure = smtp.secure ?? port === 465;
  const tlsOpts = { servername: smtp.host, rejectUnauthorized: smtp.rejectUnauthorized !== false };
  let socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host: smtp.host, port, ...tlsOpts }) : net.connect({ host: smtp.host, port });
    s.once(secure ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20000, () => s.destroy(new Error('The mail server did not answer in time')));
  });
  let session = smtpSession(socket, 20000);
  const expect = async (want, what) => {
    const r = await session.reply();
    if (!want.includes(r.code)) throw new Error(`The mail server refused ${what}: ${r.code} ${r.text}`);
    return r;
  };
  const cmd = async (line, want, what) => {
    socket.write(`${line}\r\n`);
    return expect(want, what);
  };
  try {
    await expect([220], 'the connection');
    const me = os.hostname().replace(/[^\w.-]/g, '') || 'gateway';
    let ehlo = await cmd(`EHLO ${me}`, [250], 'EHLO');
    if (!secure && /STARTTLS/i.test(ehlo.text) && smtp.starttls !== false) {
      await cmd('STARTTLS', [220], 'STARTTLS');
      session.off();
      socket = await new Promise((resolve, reject) => {
        const s = tls.connect({ socket, ...tlsOpts }, () => resolve(s));
        s.once('error', reject);
      });
      session = smtpSession(socket, 20000);
      ehlo = await cmd(`EHLO ${me}`, [250], 'EHLO');
    }
    if (smtp.user) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) await cmd(`AUTH PLAIN ${Buffer.from(`\0${smtp.user}\0${smtp.pass ?? ''}`).toString('base64')}`, [235], 'its user and password');
      else {
        await cmd('AUTH LOGIN', [334], 'AUTH LOGIN');
        await cmd(Buffer.from(smtp.user).toString('base64'), [334], 'its user');
        await cmd(Buffer.from(smtp.pass ?? '').toString('base64'), [235], 'its user and password');
      }
    }
    const fromAddr = /<([^>]+)>/.exec(smtp.from ?? '')?.[1] ?? smtp.from ?? smtp.user;
    if (!fromAddr) throw new Error('No sender: the setup page\'s Email and SMS, From');
    await cmd(`MAIL FROM:<${fromAddr}>`, [250], 'the sender');
    for (const r of to) await cmd(`RCPT TO:<${r}>`, [250, 251], `the address ${r}`);
    await cmd('DATA', [354], 'DATA');
    // (not ASCII: RFC 2047 encoded words of at most 75 characters, folded)
    const enc = (s) => {
      if (/^[\x20-\x7e]*$/.test(s)) return s;
      const words = [];
      let cur = '';
      for (const ch of s) {
        if (Buffer.byteLength(cur + ch) > 45) {
          words.push(cur);
          cur = '';
        }
        cur += ch;
      }
      if (cur) words.push(cur);
      return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
    };
    const body = String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const msg = [
      `From: ${smtp.from ?? fromAddr}`, `To: ${to.join(', ')}`, `Subject: ${enc(subject)}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${me}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', body,
    ].join('\r\n');
    await cmd(`${msg}\r\n.`, [250], 'the message');
    socket.write('QUIT\r\n');
  } finally {
    setTimeout(() => socket.destroy(), 500).unref();
  }
}

/** An SMS sent to each number, with config.sms */
async function sendSms(sms, { to, text }) {
  if (!sms?.provider) throw new Error('No SMS provider: the setup page\'s Email and SMS');
  const body = String(text).slice(0, 600);
  for (const number of to) {
    let res;
    if (sms.provider === 'twilio') {
      const base = sms.apiBase || 'https://api.twilio.com';
      res = await fetch(`${base}/2010-04-01/Accounts/${encodeURIComponent(sms.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: number, From: sms.from ?? '', Body: body }).toString(),
        signal: AbortSignal.timeout(15000),
      });
    } else {
      const fill = (s, esc) => String(s ?? '').replace(/\{to\}/g, esc(number)).replace(/\{text\}/g, esc(body));
      const json = (s) => JSON.stringify(s).slice(1, -1);
      res = await fetch(fill(sms.url, encodeURIComponent), {
        method: sms.method === 'GET' ? 'GET' : 'POST',
        headers: sms.headers && typeof sms.headers === 'object' ? sms.headers : { 'Content-Type': 'application/json' },
        ...(sms.method === 'GET' ? {} : { body: fill(sms.body ?? '{"to":"{to}","text":"{text}"}', json) }),
        signal: AbortSignal.timeout(15000),
      });
    }
    if (!res.ok) throw new Error(`The SMS provider answered ${res.status} for ${number}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
}

/** Email addresses and phone numbers in a list ("a@b.com, +1 555 …"): checked */
const emailsOf = (s) => String(s ?? '').split(/[\s,;]+/).filter(Boolean).map((x) => {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)) throw new Error(`"${x}": an email address`);
  return x;
});
const phonesOf = (s) => String(s ?? '').split(/[,;]+/).map((x) => x.replace(/[\s()-]/g, '')).filter(Boolean).map((x) => {
  if (!/^\+?\d{6,15}$/.test(x)) throw new Error(`"${x}": a phone number (+15551234567)`);
  return x;
});

module.exports = { sendEmail, sendSms, emailsOf, phonesOf };
