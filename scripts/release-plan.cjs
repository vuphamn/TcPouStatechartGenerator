// Release plan (GitHub Actions, .github/workflows/release.yml): for each edition, whether its code changed since its
// last release (tag xae-v*, desktop-v*, web-v*) and the version it gets.
//   node scripts/release-plan.cjs [--force xae,desktop,web]   the plan (JSON; also written to $GITHUB_OUTPUT)
//   node scripts/release-plan.cjs --notes <edition>           the changes since its last release (Markdown)
//   node scripts/release-plan.cjs --stamp <edition> <version> writes the version into the edition's files (CI only)
//   node scripts/release-plan.cjs --history                   every edition's releases and their changes (JSON)
// Also required by vite.config.ts: the versions and the release notes the app shows (its status bar, Release notes).
// A changed edition's version: its last release with the patch number + 1, or the version in its files when that is
// higher (raise major / minor there by hand). An edition never released gets the version in its files.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

// The web app is inside every edition (the VSIX and the desktop app carry it; the gateway serves it)
const APP = ['src', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];
const MANIFEST = 'xae-extension/KvalStateScope.Xae/source.extension.vsixmanifest';
const ASSEMBLY = 'xae-extension/KvalStateScope.Xae/Properties/AssemblyInfo.cs';
// (its build for TwinCAT 4024's TcXaeShell / Visual Studio 2017: the same version)
const MANIFEST_2017 = 'xae-extension/KvalStateScope.Xae.Vs2017/source.extension.vsixmanifest';

const EDITIONS = {
  xae: {
    title: 'XAE edition',
    paths: [...APP, 'xae-extension'],
    version: () => read(MANIFEST).match(/<Identity\b[^>]*\bVersion="(\d+\.\d+\.\d+)"/)[1],
    stamp: (v) => {
      write(MANIFEST, read(MANIFEST).replace(/(<Identity\b[^>]*\bVersion=")\d+\.\d+\.\d+(")/, `$1${v}$2`));
      write(MANIFEST_2017, read(MANIFEST_2017).replace(/(<Identity\b[^>]*\bVersion=")\d+\.\d+\.\d+(")/, `$1${v}$2`));
      write(ASSEMBLY, read(ASSEMBLY).replace(/(Assembly(?:File)?Version\(")\d+\.\d+\.\d+\.\d+("\))/g, `$1${v}.0$2`));
    },
  },
  desktop: {
    title: 'Desktop edition',
    paths: [...APP, 'electron', 'shared', 'build', 'scripts/prepare-installer.cjs'],
    version: () => JSON.parse(read('package.json')).version,
    stamp: (v) => write('package.json', read('package.json').replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${v}$2`)),
  },
  web: {
    title: 'Web edition (web app, gateway, Link)',
    paths: [...APP, 'gateway', 'link', 'shared', 'scripts/build-gateway.cjs', 'scripts/build-link.cjs'],
    version: () => JSON.parse(read('gateway/package.json')).version,
    stamp: (v) => {
      write('gateway/package.json', read('gateway/package.json').replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${v}$2`));
      for (const f of ['gateway/gateway.cjs', 'link/link.cjs']) write(f, read(f).replace(/(const VERSION = ')\d+\.\d+\.\d+(';)/, `$1${v}$2`));
    },
  },
};
// Documentation does not make a new version
const pathspec = (e) => [...EDITIONS[e].paths, ':(exclude)**/*.md', ':(exclude)*.md'];

const parse = (v) => v.split('.').map(Number);
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

function lastRelease(e) {
  const tags = git('tag', '--list', `${e}-v*`, '--sort=-v:refname').split('\n').filter((t) => /^[a-z]+-v\d+\.\d+\.\d+$/.test(t));
  return tags[0] ? { tag: tags[0], version: tags[0].replace(/^[a-z]+-v/, '') } : null;
}

function plan(force) {
  const out = {};
  for (const e of Object.keys(EDITIONS)) {
    const last = lastRelease(e);
    const files = EDITIONS[e].version();
    let changed = true;
    let changes = [];
    if (last) {
      changes = git('diff', '--name-only', last.tag, 'HEAD', '--', ...pathspec(e)).split('\n').filter(Boolean);
      changed = changes.length > 0;
    }
    if (force.includes(e)) changed = true;
    const [a, b, c] = parse(last?.version ?? '0.0.0');
    const bumped = `${a}.${b}.${c + 1}`;
    const next = !last ? files : newer(files, bumped) ? files : bumped;
    out[e] = { changed, version: changed ? next : last?.version ?? files, last: last?.tag ?? null, files: changes.length };
  }
  return out;
}

function notes(e) {
  const last = lastRelease(e);
  const range = last ? [`${last.tag}..HEAD`] : ['-n', '30', 'HEAD'];
  const log = git('log', '--no-merges', '--format=- %s (%h)', ...range, '--', ...pathspec(e));
  return `${last ? `Changes since ${last.tag}:` : 'First release. Recent changes:'}\n\n${log || '- (no commits touching this edition)'}\n`;
}

// ---- The release notes in the app: each edition's releases (its tags), newest first, with their changes ----

/** A commit subject's changes: "feat: a, b (c, d); fix: e" → [{ kind: 'feat', text: 'a' }, ...] */
function changesOf(subject) {
  const parts = subject.split(/;\s+(?=(?:feat|fix|ci|docs|perf|refactor|test|tests|chore|build)\b[^:]{0,20}:)/i);
  const out = [];
  for (const part of parts) {
    const m = /^(feat|fix|ci|docs|perf|refactor|test|tests|chore|build)\b[^:]{0,20}:\s*/i.exec(part);
    const kind = m ? m[1].toLowerCase().replace(/^tests$/, 'test') : 'change';
    const body = m ? part.slice(m[0].length) : part;
    // (items apart at the commas outside brackets)
    let depth = 0;
    let cur = '';
    for (const ch of body) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        if (cur.trim()) out.push({ kind, text: cur.trim().replace(/^and\s+/, '') });
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push({ kind, text: cur.trim().replace(/^and\s+/, '') });
  }
  return out;
}

function commitsOf(range, e) {
  const log = git('log', '--no-merges', '--date=short', '--format=%h%x1f%ad%x1f%s', ...range, '--', ...pathspec(e));
  return log ? log.split('\n').map((l) => { const [hash, date, subject] = l.split('\x1f'); return { hash, date, changes: changesOf(subject ?? '') }; }) : [];
}

/** Every edition: its version (in its files), its releases (newest first) and what came after the last one */
function history() {
  const out = {};
  for (const e of Object.keys(EDITIONS)) {
    const tags = git('for-each-ref', `refs/tags/${e}-v*`, '--format=%(refname:short)%09%(creatordate:short)')
      .split('\n').filter(Boolean).map((l) => { const [tag, date] = l.split('\t'); return { tag, date, version: tag.replace(/^[a-z]+-v/, '') }; })
      .filter((t) => /^\d+\.\d+\.\d+$/.test(t.version))
      .sort((a, b) => (newer(a.version, b.version) ? 1 : newer(b.version, a.version) ? -1 : 0));
    const releases = tags.map((t, i) => ({ ...t, commits: commitsOf(i ? [`${tags[i - 1].tag}..${t.tag}`] : ['-n', '40', t.tag], e) })).reverse();
    const last = tags[tags.length - 1];
    out[e] = { title: EDITIONS[e].title, version: EDITIONS[e].version(), releases, unreleased: commitsOf(last ? [`${last.tag}..HEAD`] : ['-n', '40', 'HEAD'], e) };
  }
  return out;
}

/** The version in each edition's files (stamped by CI before a release build) */
const versions = () => Object.fromEntries(Object.keys(EDITIONS).map((e) => [e, EDITIONS[e].version()]));

module.exports = { history, versions, changesOf };

const args = require.main === module ? process.argv.slice(2) : null;
if (!args) {
  // (required: nothing to run)
} else if (args[0] === '--history') {
  console.log(JSON.stringify(history(), null, 2));
} else if (args[0] === '--notes') {
  process.stdout.write(notes(args[1]));
} else if (args[0] === '--stamp') {
  const [e, v] = [args[1], args[2]];
  if (!EDITIONS[e] || !/^\d+\.\d+\.\d+$/.test(v ?? '')) throw new Error('Usage: --stamp <xae|desktop|web> <x.y.z>');
  EDITIONS[e].stamp(v);
  console.log(`${e}: ${v} written into its files`);
} else {
  const i = args.indexOf('--force');
  const force = i >= 0 ? String(args[i + 1] ?? '').split(/[\s,]+/).filter(Boolean) : [];
  // "[skip release]" in the commit message: tests only
  const skip = /\[skip release\]/i.test(git('log', '-1', '--format=%B'));
  const p = plan(force);
  if (skip && !force.length) for (const e of Object.keys(p)) p[e].changed = false;
  console.log(JSON.stringify(p, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(p).flatMap(([e, x]) => [`${e}_changed=${x.changed}`, `${e}_version=${x.version}`]);
    lines.push(`any=${Object.values(p).some((x) => x.changed)}`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  }
}
