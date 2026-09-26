#!/usr/bin/env node
// Test runner (see tests/README.md).
//   node tests/run.cjs [suite ...] [--filter <text>]
//   suites: unit (logic, no browser), web (the app in a headless browser), live (gateway / Link / ADS against a
//   simulated PLC), desktop (the Electron app, Windows only), all (= unit web live desktop). Default: unit web live.
// web and desktop use TEST_APP_URL when set, else a Vite dev server started here. Logs: tests/.output/logs.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

/** A process and everything it started (a test's browser, fake PLC, Link, ...): on Windows kill() leaves its children */
function killTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.output');
const LOGS = path.join(OUT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });

const argv = process.argv.slice(2);
let filter = null;
let suites = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--filter') filter = argv[++i];
  else suites.push(argv[i]);
}
if (suites.length === 0) suites = ['unit', 'web', 'live'];
if (suites.includes('all')) suites = ['unit', 'web', 'live', 'desktop'];
const TIMEOUT = { unit: 120000, web: 300000, live: 180000, desktop: 300000 };

const files = (suite, ext) =>
  fs.existsSync(path.join(__dirname, suite))
    ? fs.readdirSync(path.join(__dirname, suite)).filter((f) => f.endsWith(ext) && (!filter || f.includes(filter))).sort()
    : [];

function run(cmd, args, { env, timeout, log }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const fd = fs.openSync(log, 'w');
    const child = spawn(cmd, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd] });
    const timer = setTimeout(() => {
      fs.writeSync(fd, `\n[runner] timed out after ${timeout / 1000} s\n`);
      killTree(child);
    }, timeout);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(fd);
      resolve({ code: code ?? (signal ? 1 : 0), ms: Date.now() - started });
    });
  });
}

const get = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.setTimeout(3000, () => req.destroy());
  });

/**
 * The first page load makes Vite compile the app and optimize its dependencies (which can reload the page): done
 * once in a browser here, so the tests start from a warm server
 */
async function warmUp(url) {
  process.env.TEST_APP_URL = url;
  const h = require('./lib/harness.cjs');
  const started = Date.now();
  let browser = null;
  try {
    browser = await h.launchBrowser();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.waitForSelector('#mermaid-canvas-area g.node', { timeout: 120000 });
    console.log(`(app ready: ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.log(`(warm-up: ${e.message.split('\n')[0]})`);
  } finally {
    await browser?.close();
  }
}

async function startApp() {
  if (process.env.TEST_APP_URL) return { url: process.env.TEST_APP_URL, stop() {} };
  const port = 5199;
  const url = `http://localhost:${port}/`;
  const log = fs.openSync(path.join(LOGS, 'vite.log'), 'w');
  const vite = spawn(process.execPath, [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort'], { cwd: REPO, stdio: ['ignore', log, log] });
  for (let i = 0; i < 120; i++) {
    if ((await get(url)) === 200) {
      await warmUp(url);
      return { url, stop: () => killTree(vite) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  vite.kill();
  throw new Error(`The dev server did not start (see ${path.join(LOGS, 'vite.log')})`);
}

function failuresOf(log) {
  const text = fs.readFileSync(log, 'utf8');
  const fails = text.split('\n').filter((l) => /^FAIL\b|Error|timed out/.test(l)).slice(0, 6);
  return fails.map((l) => `      ${l.slice(0, 200)}`).join('\n');
}

(async () => {
  const results = [];
  let app = null;
  try {
    for (const suite of suites) {
      if (suite === 'desktop' && process.platform !== 'win32') {
        console.log('desktop: skipped (Windows only)');
        continue;
      }
      const list = suite === 'unit' ? files('unit', '.test.ts') : files(suite, '.test.cjs');
      if (!list.length) continue;
      console.log(`\n${suite} (${list.length})`);
      // Everything but the logic and protocol tests runs against the app
      if (suite !== 'unit' && suite !== 'live' && !app) app = await startApp();
      for (const f of list) {
        const name = f.replace(/\.test\.(ts|cjs)$/, '');
        const log = path.join(LOGS, `${suite}-${name}.log`);
        let r;
        if (suite === 'unit') {
          // Bundled like the app (TypeScript, imports from src/)
          const bundle = path.join(OUT, 'unit', `${name}.cjs`);
          try {
            require('esbuild').buildSync({ entryPoints: [path.join(__dirname, 'unit', f)], bundle: true, platform: 'node', outfile: bundle, logLevel: 'silent' });
          } catch (e) {
            fs.writeFileSync(log, String(e.message || e));
            results.push({ suite, name, ok: false, ms: 0, log });
            console.log(`  x ${name} (does not build)`);
            continue;
          }
          r = await run(process.execPath, [bundle], { timeout: TIMEOUT.unit, log });
        } else {
          r = await run(process.execPath, [path.join(__dirname, suite, f)], { env: { TEST_APP_URL: app ? app.url : '' }, timeout: TIMEOUT[suite] ?? 300000, log });
        }
        const text = fs.readFileSync(log, 'utf8');
        // A test fails on a non-zero exit, and on any "FAIL" line (some tests only print them)
        const ok = r.code === 0 && !/^FAIL\b/m.test(text);
        const skipped = ok && /^skipped/m.test(text);
        results.push({ suite, name, ok, ms: r.ms, log });
        console.log(`  ${ok ? (skipped ? '-' : '✓') : 'x'} ${name} ${skipped ? '(skipped)' : `(${(r.ms / 1000).toFixed(1)} s)`}`);
        if (!ok) console.log(failuresOf(log));
      }
    }
  } finally {
    app?.stop();
  }
  // Test browsers still running (a test that did not clean up): reported, then stopped
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', "$p = Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'kss-test-browser-' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count"], { encoding: 'utf8' });
    const left = parseInt((ps.stdout || '').trim(), 10);
    if (left > 0) console.log(`\n(${left} test browser processes were still running: stopped)`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((r) => `${r.suite}/${r.name}`).join(', ')} (logs in tests/.output/logs)` : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
