// The gateway's backup and its restore (the setup page's Backup): everything beside config.json that is its own (its
// settings, tokens' hashes, users' roles, the alert history, work orders, spare parts, plans, guides, handovers, the
// changes, the saved filters and boards, the push keys and devices, its certificates; the drives', axes' and fleet's
// day statistics, the logged events) in one file, encrypted with a passphrase (AES-256-GCM, its key from the passphrase
// by scrypt): it holds passwords and tokens. The recordings and the fault records with it, when chosen. Kept in
// backups/ (the last 10). A restore: the file decrypted, checked (a config.json with its PLCs), the gateway's state as
// it was kept first (before-restore-<when>.kvalbk, the same passphrase), then its files written back; the gateway
// restarted takes it all (its Windows task restarts it by itself).
// Scheduled (config.backup.schedule: daily or weekly, at a time): made by itself with the passphrase set for it
// (kept in backup-schedule.secret beside config.json, never shown back, never in a backup), then copied to a folder
// or a network share (\\server\share\line202: the gateway's Windows account needs to write there), the newest
// `keep` (14) kept there; its last run kept (backup-status.json); a failure is an alert (event "backup").
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAGIC = Buffer.from('KVALBK1\0');
const KEEP = 10;
// (what is the gateway's own, beside config.json; never its backups, support bundles, the PLCs' project copies)
const TOP = /^[\w.-]+\.(json|jsonl|pfx|pem|crt|key)$/i;
const SUMMARIES = ['drives', 'axes', 'fleet'];
const FULL = ['eventlog', 'attachments'];
const OPTIONAL = { recordings: 'recordings', faults: 'faults' };

/** A file encrypted with a passphrase (scrypt, AES-256-GCM) */
function seal(data, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(String(passphrase), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
}
function open(file, passphrase) {
  if (file.length < 52 || !file.subarray(0, 8).equals(MAGIC)) throw new Error('Not a backup of a MachineScope gateway');
  const salt = file.subarray(8, 24);
  const iv = file.subarray(24, 36);
  const tag = file.subarray(36, 52);
  const key = crypto.scryptSync(String(passphrase), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(file.subarray(52)), d.final()]);
  } catch {
    throw new Error('Its passphrase is not this one (or the file is damaged)');
  }
}

function createBackup({ baseDir, configPath, zipOf, unzip, log, audit, getConfig, onEvent }) {
  const dir = path.join(baseDir, 'backups');
  const walk = (rel, out, all) => {
    const abs = path.join(baseDir, rel);
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r, out, all);
      else if (all || e.name === 'summary.json') out[r] = fs.readFileSync(path.join(baseDir, r));
    }
  };
  /** What a backup holds: { relative path: its bytes } */
  const filesOf = ({ recordings = false, faults = false } = {}) => {
    const out = {};
    for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) if (e.isFile() && TOP.test(e.name) && !/\.tmp$/.test(e.name)) out[e.name] = fs.readFileSync(path.join(baseDir, e.name));
    out['config.json'] = fs.readFileSync(configPath);
    for (const d of SUMMARIES) walk(d, out, false);
    for (const d of FULL) walk(d, out, true);
    if (recordings) walk(OPTIONAL.recordings, out, true);
    if (faults) walk(OPTIONAL.faults, out, true);
    return out;
  };
  const prune = () => {
    const all = list().filter((b) => b.name.startsWith('backup-'));
    for (const old of all.slice(KEEP)) fs.rmSync(path.join(dir, old.name), { force: true });
  };
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  function list() {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => /\.kvalbk$/.test(n));
    } catch {
      names = [];
    }
    return names.map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size, at: fs.statSync(path.join(dir, name)).mtimeMs })).sort((a, b) => b.at - a.at);
  }
  const passOk = (p) => {
    if (String(p ?? '').length < 8) throw new Error('A passphrase of 8 characters at least: the backup holds passwords and tokens');
  };
  // The schedule
  const secretFile = path.join(baseDir, 'backup-schedule.secret');
  const statusFile = path.join(baseDir, 'backup-status.json');
  const secret = () => {
    try {
      return fs.readFileSync(secretFile, 'utf8');
    } catch {
      return '';
    }
  };
  const status = () => {
    try {
      return JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    } catch {
      return null;
    }
  };
  const scheduleOf = () => {
    const c = getConfig?.()?.backup?.schedule ?? {};
    return {
      enabled: c.enabled === true,
      every: c.every === 'weekly' ? 'weekly' : 'daily',
      day: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(String(c.day).toLowerCase()) ? String(c.day).toLowerCase() : 'sun',
      at: /^[0-2][0-9]:[0-5][0-9]$/.test(String(c.at)) ? c.at : '02:00',
      share: typeof c.share === 'string' ? c.share.trim() : '',
      keep: Math.max(1, Math.min(365, Number(c.keep) || 14)),
      recordings: c.recordings === true,
      faults: c.faults === true,
    };
  };
  let running = false;
  async function runScheduled(user) {
    if (running) throw new Error('A backup is being made');
    running = true;
    const sc = scheduleOf();
    const st = { at: Date.now(), ok: false, name: null, share: sc.share || null, copied: false, error: null };
    try {
      const p = secret();
      if (!p) throw new Error('No passphrase set for the scheduled backups (the setup page: Backup, Scheduled)');
      const made = create({ passphrase: p, recordings: sc.recordings, faults: sc.faults }, user);
      st.name = made.name;
      st.size = made.size;
      if (sc.share) {
        fs.mkdirSync(sc.share, { recursive: true });
        await fs.promises.copyFile(path.join(dir, made.name), path.join(sc.share, made.name));
        st.copied = true;
        // (the share: its newest kept)
        const there = fs.readdirSync(sc.share).filter((n) => /^backup-.*[.]kvalbk$/.test(n)).sort().reverse();
        for (const old of there.slice(sc.keep)) fs.rmSync(path.join(sc.share, old), { force: true });
      }
      st.ok = true;
      log(`backup: scheduled ${made.name}${sc.share ? `, copied to ${sc.share}` : ''}`);
    } catch (err) {
      st.error = err.message;
      log(`backup: the scheduled backup failed: ${err.message}`);
      onEvent?.({ event: 'backup', level: 'warn', rule: 'Backups', ruleId: 'backup', plc: '', plcName: '', machine: 'the gateway', state: 'failed', text: `💾 The scheduled backup failed${st.name ? ` (made ${st.name}, not copied)` : ''}: ${err.message}`, at: new Date().toISOString() });
    } finally {
      running = false;
      try {
        fs.writeFileSync(statusFile, JSON.stringify(st));
      } catch {
        // (its status: next time)
      }
    }
    return st;
  }
  // (due: its day (weekly) and time, once a day)
  let lastKey = '';
  const timer = setInterval(() => {
    const sc = scheduleOf();
    if (!sc.enabled) return;
    const now = new Date();
    const [hh, mm] = sc.at.split(':').map(Number);
    const key = now.toDateString();
    if (lastKey === key || now.getHours() !== hh || now.getMinutes() !== mm) return;
    if (sc.every === 'weekly' && ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()] !== sc.day) return;
    lastKey = key;
    void runScheduled('schedule').catch(() => {});
  }, 20000);
  timer.unref?.();
  const create = (o, user) => api.create(o, user);
  const api = {
    list,
    /** A backup made: its file in backups/ */
    create({ passphrase, recordings = false, faults = false }, user = 'setup page') {
      passOk(passphrase);
      const files = filesOf({ recordings, faults });
      const name = `backup-${stamp()}.kvalbk`;
      fs.mkdirSync(dir, { recursive: true });
      const sealed = seal(zipOf(files), passphrase);
      fs.writeFileSync(path.join(dir, name), sealed);
      prune();
      log(`backup: ${name} (${Object.keys(files).length} files, ${Math.round(sealed.length / 1024)} kB)`);
      audit?.add(user, 'backup', { name, files: Object.keys(files).length, recordings: !!recordings, faults: !!faults });
      return { name, size: sealed.length, files: Object.keys(files).length };
    },
    /** A backup's file (its download) */
    read(name) {
      if (!/^[\w.-]+\.kvalbk$/.test(String(name))) throw new Error('No such backup');
      return fs.readFileSync(path.join(dir, name));
    },
    /** What a backup holds, without restoring it: its files, its PLCs */
    inspect(file, passphrase) {
      const entries = unzip(open(file, passphrase));
      const conf = entries.find((e) => e.path === 'config.json');
      let config = null;
      try {
        config = JSON.parse(conf?.data.toString('utf8').replace(/^\uFEFF/, '') ?? '');
      } catch {
        config = null;
      }
      if (!config || !Array.isArray(config.plcs)) throw new Error('Not a gateway backup: its config.json is missing or not one');
      return { entries, config };
    },
    /** A restore: checked, the state now kept first, its files written back */
    restore(file, passphrase, user = 'setup page') {
      passOk(passphrase);
      const { entries, config } = this.inspect(file, passphrase);
      const before = `before-restore-${stamp()}.kvalbk`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, before), seal(zipOf(filesOf({ recordings: false, faults: false })), passphrase));
      let written = 0;
      for (const e of entries) {
        if (e.path.endsWith('/')) continue;
        const rel = e.path.replace(/\\/g, '/');
        const top = rel.split('/')[0];
        const ok = (!rel.includes('/') && (TOP.test(rel) || rel === 'config.json')) || [...SUMMARIES, ...FULL, ...Object.values(OPTIONAL)].includes(top);
        if (!ok || rel.split('/').some((p) => p === '..' || p === '')) continue;
        const target = rel === 'config.json' ? configPath : path.join(baseDir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, e.data);
        written++;
      }
      log(`backup: restored ${written} files (${config.plcs.length} PLC(s)); the state before kept as ${before}`);
      audit?.add(user, 'restore', { files: written, plcs: config.plcs.length, before });
      return { files: written, plcs: config.plcs.map((p) => p.name || p.id), before, config };
    },
    /** The schedule: its settings, whether its passphrase is set, its last run */
    schedule: () => ({ schedule: scheduleOf(), passphraseSet: !!secret(), status: status() }),
    /** Its passphrase set (8 characters at least), kept beside config.json, never shown back */
    setPassphrase(p, user = 'setup page') {
      passOk(p);
      fs.writeFileSync(secretFile, String(p), { mode: 0o600 });
      audit?.add(user, 'backup.schedule.passphrase', {});
    },
    /** One made now as the schedule makes it (made, copied to its share, the share pruned) */
    runScheduled: (user = 'schedule') => runScheduled(user),
    stop: () => clearInterval(timer),
  };
  return api;
}

module.exports = { createBackup, seal, open };
