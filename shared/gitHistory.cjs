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

/**
 * Who last changed each line of a loaded file (git blame, as committed and as on disk): { lines: [{ hash, author,
 * date, summary, text }] } one per line of the file (hash 0000000: not committed yet)
 */
async function gitBlame(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { error: 'Not a file of this computer' };
  const r = await run(path.dirname(filePath), ['blame', '--line-porcelain', '--', path.basename(filePath)]);
  if (r.error) return r;
  return { lines: parseBlame(r.out) };
}

/** git blame --line-porcelain's output → a line each: { hash (7), author, date (YYYY-MM-DD), summary, text } */
function parseBlame(out) {
  const lines = [];
  let cur = null;
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) {
      if (cur) lines.push({ ...cur, text: l.slice(1).replace(/\r$/, '') });
      cur = null;
      continue;
    }
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
    if (head) {
      cur = { hash: head[1].slice(0, 7), author: '', date: '', summary: '' };
      continue;
    }
    if (!cur) continue;
    if (l.startsWith('author ')) cur.author = l.slice(7);
    else if (l.startsWith('author-time ')) cur.date = new Date(Number(l.slice(12)) * 1000).toISOString().slice(0, 10);
    else if (l.startsWith('summary ')) cur.summary = l.slice(8, 168);
  }
  return lines;
}

module.exports = { gitLog, gitShowAt, gitBlame, parseBlame };
