// Release plan (GitHub Actions, .github/workflows/release.yml): for each edition, whether its code changed since its
// last release (tag xae-v*, desktop-v*, web-v*) and the version it gets.
//   node scripts/release-plan.cjs [--force xae,desktop,web]   the plan (JSON; also written to $GITHUB_OUTPUT)
//   node scripts/release-plan.cjs --notes <edition>           the changes since its last release (Markdown)
//   node scripts/release-plan.cjs --stamp <edition> <version> writes the version into the edition's files (CI only)
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

const EDITIONS = {
  xae: {
    title: 'XAE edition',
    paths: [...APP, 'xae-extension'],
    version: () => read(MANIFEST).match(/<Identity\b[^>]*\bVersion="(\d+\.\d+\.\d+)"/)[1],
    stamp: (v) => {
      write(MANIFEST, read(MANIFEST).replace(/(<Identity\b[^>]*\bVersion=")\d+\.\d+\.\d+(")/, `$1${v}$2`));
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

const args = process.argv.slice(2);
if (args[0] === '--notes') {
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
