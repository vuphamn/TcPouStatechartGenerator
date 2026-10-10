#!/usr/bin/env node
// Test runner (see tests/README.md).
//   node tests/run.cjs [suite ...] [--filter <text>] [--shard <i>/<n>]
//   --shard: only every n-th test of each suite, from the i-th (1-based; CI runs the web suite in parallel jobs)
//   --preview: the built app (dist/, npm run build first) served by vite preview, not the dev server: pages load at
//   once instead of compiling each module on first use (CI: a slow machine)
//   --jobs <n>: the web tests n at a time (each has its own ports and browser; the app server is shared). A full local
//   run: --jobs 2 about halves the web suite's time. A web test failed while others ran beside it is run once more
//   alone (a slow machine's timing, not the app): it passes then, but is listed as flaky in the summary
//   --retry: the failed web tests run once more without --jobs too (CI: its shards)
//   desktop on a locked Windows screen: skipped (Electron does not draw then: every test would time out);
//   KSS_DESKTOP_WHEN_LOCKED=1 runs it anyway
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
// (a PLC's project kept "in Documents" by the desktop app and Link: the tests' own folder, never the user's)
process.env.KSS_DOCUMENTS ||= path.join(OUT, 'documents');
if (process.env.KSS_DOCUMENTS === path.join(OUT, 'documents')) fs.rmSync(process.env.KSS_DOCUMENTS, { recursive: true, force: true });
const LOGS = path.join(OUT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
// The browsers' profiles a test left (crashed, killed, or its browser still holding them as it ended): removed when an
// hour old (not a run's still going), here and in the system's temp folder; each is tens of MB, they piled up to GBs
{
  const hourAgo = Date.now() - 3600000;
  const sweep = (dir, rx) => {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => rx.test(n));
    } catch {
      return;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        if (fs.statSync(p).mtimeMs < hourAgo) fs.rmSync(p, { recursive: true, force: true, maxRetries: 2 });
      } catch {
        // (in use: next time)
      }
    }
  };
  sweep(OUT, /^(electron-prof-|browser-)/);
  sweep(require('os').tmpdir(), /^kss-test-browser-/);
}
// A nearly full disk slows the browsers' big charts down enough for timing checks to fail (hovers, double-clicks,
// fixed waits): said before the run, with what tests/.output holds (KSS_MIN_FREE_GB: the limit, 20 GB by default)
try {
  const free = fs.statfsSync(OUT).bavail * fs.statfsSync(OUT).bsize;
  if (free < (Number(process.env.KSS_MIN_FREE_GB) || 20) * 1024 ** 3) {
    let held = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else held += fs.statSync(p, { throwIfNoEntry: false })?.size ?? 0;
      }
    };
    walk(OUT);
    console.log(`\x1b[33m! Only ${(free / 1024 ** 3).toFixed(1)} GB free on this disk: tests on big charts may fail on timing (tests/.output holds ${(held / 1024 ** 3).toFixed(1)} GB)\x1b[0m\n`);
  }
} catch {
  // (no statfs: Node 18.15+)
}

const argv = process.argv.slice(2);
let filter = null;
let shard = null;
let preview = false;
let jobs = 1;
let retry = false;
let suites = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--filter') filter = argv[++i];
  else if (argv[i] === '--preview') preview = true;
  else if (argv[i] === '--retry') retry = true;
  else if (argv[i] === '--jobs') jobs = Math.max(1, Math.min(6, parseInt(argv[++i], 10) || 1));
  else if (argv[i] === '--shard') {
    const [k, n] = String(argv[++i]).split('/').map(Number);
    if (!(n >= 1 && k >= 1 && k <= n)) throw new Error('--shard: expected <i>/<n>, e.g. 1/2');
    shard = { k, n };
  }
  else suites.push(argv[i]);
}
if (suites.length === 0) suites = ['unit', 'web', 'live'];
if (suites.includes('all')) suites = ['unit', 'web', 'live', 'desktop'];
const TIMEOUT = { unit: 120000, web: 300000, live: 180000, desktop: 600000, vscode: 300000 };
// A long test's own limit: '// runner-timeout: <seconds>' in its first lines (ms; 0: none)
const ownTimeout = (file) => {
  try {
    return Number(fs.readFileSync(file, 'utf8').slice(0, 2000).match(/runner-timeout:\s*(\d+)/)?.[1] ?? 0) * 1000;
  } catch {
    return 0;
  }
};

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
// (the app given from outside; warmUp sets TEST_APP_URL for the harness)
const GIVEN_URL = process.env.TEST_APP_URL;

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

// (dev: the dev server even with --preview, for the tests that import the app's modules from /src/)
async function startApp({ dev = false } = {}) {
  if (GIVEN_URL) return { url: GIVEN_URL, stop() {} };
  const built = preview && !dev;
  const port = built || !preview ? 5199 : 5198;
  const url = `http://localhost:${port}/`;
  const log = fs.openSync(path.join(LOGS, dev ? 'vite-dev.log' : 'vite.log'), 'w');
  if (built && !fs.existsSync(path.join(REPO, 'dist', 'index.html'))) throw new Error('--preview: dist/ is missing (npm run build first)');
  // (a cache of their own: the developer's dev server (npm run dev) keeps its pre-bundled dependencies)
  const vite = spawn(process.execPath, [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), ...(built ? ['preview'] : []), '--port', String(port), '--strictPort'], { cwd: REPO, stdio: ['ignore', log, log], env: { ...process.env, KSS_VITE_CACHE_DIR: path.join(REPO, 'node_modules', '.vite-tests') } });
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

/** Is the Windows screen locked (its lock screen running)? */
function screenLocked() {
  if (process.platform !== 'win32') return false;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '[bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)'], { encoding: 'utf8' });
  return /True/i.test(r.stdout || '');
}

function failuresOf(log) {
  const text = fs.readFileSync(log, 'utf8');
  const fails = text.split('\n').filter((l) => /^FAIL\b|Error|timed out/.test(l)).slice(0, 6);
  return fails.map((l) => `      ${l.slice(0, 200)}`).join('\n');
}

(async () => {
  const results = [];
  let app = null;
  let devApp = null;
  try {
    for (const suite of suites) {
      if (suite === 'desktop' && process.platform !== 'win32') {
        console.log('desktop: skipped (Windows only)');
        continue;
      }
      // (a locked screen: Electron does not draw, each test would wait minutes and fail)
      if (suite === 'desktop' && process.env.KSS_DESKTOP_WHEN_LOCKED !== '1' && screenLocked()) {
        console.log('\ndesktop: skipped (the Windows screen is locked: Electron does not draw then; unlock it, or KSS_DESKTOP_WHEN_LOCKED=1)');
        continue;
      }
      let list = suite === 'unit' ? files('unit', '.test.ts') : files(suite, '.test.cjs');
      if (shard) list = list.filter((_, i) => i % shard.n === shard.k - 1);
      if (!list.length) continue;
      console.log(`\n${suite} (${list.length}${shard ? `, shard ${shard.k}/${shard.n}` : ''})`);
      // Everything but the logic and protocol tests runs against the app
      // (vscode: VS Code itself, with the extension: no app server)
      if (suite !== 'unit' && suite !== 'live' && suite !== 'vscode' && !app) app = await startApp();
      // (the dev server for the tests that import /src/, started once however many run at a time)
      let devStarting = null;
      const runOne = async (f, again = false) => {
        const name = f.replace(/\.test\.(ts|cjs)$/, '');
        // (the screen locked meanwhile: this desktop test and the ones after it skipped, not timed out)
        if (suite === 'desktop' && process.env.KSS_DESKTOP_WHEN_LOCKED !== '1' && screenLocked()) {
          console.log(`  - ${name} (skipped: the Windows screen is locked)`);
          return;
        }
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
            return;
          }
          r = await run(process.execPath, [bundle], { timeout: ownTimeout(path.join(__dirname, suite, f)) || TIMEOUT.unit, log });
        } else {
          // (the built app has no /src/: a test importing from it gets the dev server)
          const needsDev = preview && app && !GIVEN_URL && fs.readFileSync(path.join(__dirname, suite, f), 'utf8').includes("'/src/");
          if (needsDev && !devApp) devApp = await (devStarting ??= startApp({ dev: true }));
          r = await run(process.execPath, [path.join(__dirname, suite, f)], { env: { TEST_APP_URL: needsDev ? devApp.url : app ? app.url : '' }, timeout: ownTimeout(path.join(__dirname, suite, f)) || TIMEOUT[suite] || 300000, log });
        }
        const text = fs.readFileSync(log, 'utf8');
        // A test fails on a non-zero exit, and on any "FAIL" line (some tests only print them)
        const ok = r.code === 0 && !/^FAIL\b/m.test(text);
        const skipped = ok && /^skipped/m.test(text);
        results.push({ suite, name, file: f, ok, ms: r.ms, log, flaky: again && ok });
        console.log(`  ${ok ? (skipped ? '-' : '✓') : 'x'} ${name} ${skipped ? '(skipped)' : `(${(r.ms / 1000).toFixed(1)} s${again ? ', run again alone' : ''})`}`);
        if (!ok) console.log(failuresOf(log));
      };
      const n = suite === 'web' ? Math.min(jobs, list.length) : 1;
      if (n === 1) for (const f of list) await runOne(f);
      else {
        const queue = [...list];
        await Promise.all(Array.from({ length: n }, async () => {
          while (queue.length) await runOne(queue.shift());
        }));
      }
      // The web tests failed beside others (or with --retry): once more, alone; the first run's log kept (.first.log)
      if (suite === 'web' && (n > 1 || retry)) {
        const failedHere = results.filter((r) => r.suite === suite && !r.ok && r.file);
        if (failedHere.length) console.log(`  (${failedHere.length} failed: run again, one at a time)`);
        for (const r of failedHere) {
          fs.copyFileSync(r.log, r.log.replace(/\.log$/, '.first.log'));
          results.splice(results.indexOf(r), 1);
          await runOne(r.file, true);
        }
      }
    }
  } finally {
    app?.stop();
    devApp?.stop();
  }
  // Test browsers still running (a test that did not clean up): reported, then stopped
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', "$p = Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'kss-test-browser-' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; $p.Count"], { encoding: 'utf8' });
    const left = parseInt((ps.stdout || '').trim(), 10);
    if (left > 0) console.log(`\n(${left} test browser processes were still running: stopped)`);
  }
  const failed = results.filter((r) => !r.ok);
  // In GitHub Actions: an annotation per failed test (shown on the run's page, and readable without signing in)
  if (process.env.GITHUB_ACTIONS) {
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    for (const r of failed) {
      const text = fs.existsSync(r.log) ? fs.readFileSync(r.log, 'utf8') : '';
      const found = text.split(/\r?\n/).filter((l) => /^FAIL\b|Error|timed out/.test(l)).slice(0, 12).map((l) => l.slice(0, 300));
      const title = esc(`${r.suite}/${r.name}`).replace(/:/g, '%3A').replace(/,/g, '%2C');
      console.log(`::error title=${title}::${esc(found.join('\n') || 'failed (no FAIL line: see its log)')}`);
    }
  }
  const flaky = results.filter((r) => r.flaky);
  if (flaky.length) console.log(`\nflaky (failed beside other tests, passed alone; the first run: its .first.log): ${flaky.map((r) => `${r.suite}/${r.name}`).join(', ')}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((r) => `${r.suite}/${r.name}`).join(', ')} (logs in tests/.output/logs)` : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
