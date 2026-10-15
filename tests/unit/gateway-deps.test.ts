// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The gateway's package.json names every package its code needs: gateway/*.cjs and the shared/ modules it ships with
// (scripts/build-gateway.cjs copies shared/). Installed on its own computer (npm install --omit=dev), a package missing
// there is not found (the repo's node_modules hid @xmldom/xmldom: init failed on 2026-10-14)
import * as fs from 'fs';
import * as path from 'path';
import { builtinModules } from 'module';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

let repo = __dirname;
while (!fs.existsSync(path.join(repo, 'gateway', 'package.json')) && path.dirname(repo) !== repo) repo = path.dirname(repo);
const deps = Object.keys(JSON.parse(fs.readFileSync(path.join(repo, 'gateway', 'package.json'), 'utf8')).dependencies ?? {});
const needed = new Map<string, string[]>();
for (const dir of ['gateway', 'shared']) {
  for (const f of fs.readdirSync(path.join(repo, dir)).filter((x) => /\.(c|m)?js$/.test(x))) {
    // (comments and strings that only look like a require: the code's require() / import of a package name)
    const text = fs.readFileSync(path.join(repo, dir, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    for (const m of text.matchAll(/\brequire\(\s*['"]([@\w][^'"]*)['"]\s*\)|^\s*import\b[^'"\n]*\bfrom\s+['"]([@\w][^'"]*)['"]|\bimport\(\s*['"]([@\w][^'"]*)['"]\s*\)/gm)) {
      const name = m[1] || m[2] || m[3];
      const pkg = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (builtinModules.includes(pkg) || pkg === 'electron' || pkg === 'vscode') continue;
      needed.set(pkg, [...(needed.get(pkg) ?? []), `${dir}/${f}`]);
    }
  }
}
const missing = [...needed].filter(([p]) => !deps.includes(p));
expect(needed.has('ads-client') && needed.has('ws'), `the code's packages found: ${[...needed.keys()].join(', ')}`);
expect(!missing.length, missing.length ? `missing from gateway/package.json: ${missing.map(([p, f]) => `${p} (${[...new Set(f)].slice(0, 3).join(', ')})`).join('; ')}` : 'gateway/package.json names them all');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);
