// A loaded file's git history (the desktop app and the VS Code extension; the XAE extension does the same in C#):
// gitLog(file) → { commits: [{ hash, date, author, subject, file }] } the commits that changed it, newest first (renames
// followed: `file` is its path then, from the repository's root); gitShowAt(file, hash, atPath) → { content } the file as
// it was in that commit. Errors as gitShow says them (no git, no repository, not committed).
const path = require('path');
const { execFile } = require('child_process');

const SEP = '\x1f';
const MAX_COMMITS = 40;

function gitError(err, stderr) {
  const text = String(stderr || err.message || err || '');
  return err && err.code === 'ENOENT'
    ? 'git is not installed (or not on the PATH)'
    : /not a git repository/i.test(text)
      ? 'The file is not in a git repository'
      : /exists on disk, but not in|does not exist in/i.test(text)
        ? 'The file is not committed yet'
        : text.trim().split(/\r?\n/)[0] || 'git did not answer';
}

function run(dir, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20000, windowsHide: true }, (err, stdout, stderr) =>
      resolve(err ? { error: gitError(err, stderr && stderr.toString('utf8')) } : { out: stdout.toString('utf8') }),
    );
  });
}

/** (one commit's lines: hash, date, author, subject; then a blank line and its path then) */
async function gitLog(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { error: 'Not a file of this computer' };
  const r = await run(path.dirname(filePath), ['log', '--follow', `-n${MAX_COMMITS}`, '--date=format:%Y-%m-%d %H:%M', `--format=@@${['%h', '%ad', '%an', '%s'].join(SEP)}`, '--name-only', '--', path.basename(filePath)]);
  if (r.error) return r;
  const commits = [];
  for (const chunk of r.out.split('@@').slice(1)) {
    const [head, ...rest] = chunk.split(/\r?\n/);
    const [hash, date, author, subject] = head.split(SEP);
    const file = rest.map((l) => l.trim()).find(Boolean);
    if (hash && file) commits.push({ hash, date, author, subject: subject ?? '', file });
  }
  return { commits };
}

async function gitShowAt(filePath, hash, atPath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { error: 'Not a file of this computer' };
  if (!/^[0-9a-f]{4,40}$/i.test(String(hash)) || typeof atPath !== 'string' || !atPath || /^[-/]|\.\.|["\0]/.test(atPath)) return { error: 'Not a commit of the file' };
  // (the path from the repository's root: run in the root)
  const top = await run(path.dirname(filePath), ['rev-parse', '--show-toplevel']);
  if (top.error) return top;
  const r = await run(top.out.trim(), ['show', `${hash}:${atPath}`]);
  return r.error ? r : { content: r.out.replace(/^﻿/, '') };
}

module.exports = { gitLog, gitShowAt };
