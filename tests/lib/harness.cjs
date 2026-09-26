// Shared helpers of the web, live and desktop tests (see tests/README.md).
//   APP_URL / APP_ORIGIN  the app under test (the runner starts a Vite dev server and sets TEST_APP_URL)
//   OUT                   tests/.output: browser profiles, logs, screenshots (not committed)
//   FAKES, FIXTURES       the simulated PLCs and the sample .TcPOU / .TcDUT files
//   launchBrowser()       headless Chrome / Edge (CHROME_PATH, else an installed Edge or Chrome)
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const TESTS = path.join(REPO, 'tests');
const OUT = path.join(TESTS, '.output');
const FAKES = path.join(TESTS, 'fakes');
const FIXTURES = path.join(TESTS, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const APP_URL = (process.env.TEST_APP_URL || 'http://localhost:3000/').replace(/\/?$/, '/');
const APP_ORIGIN = APP_URL.replace(/\/$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A browser the tests can drive: CHROME_PATH, else Edge or Chrome where they are usually installed */
function browserPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome or Edge found: set CHROME_PATH');
  return hit;
}

/**
 * Headless browser with its own profile. options: { defaultViewport, args } (defaultViewport null: the window's
 * size). Closing the browser removes nothing else.
 */
async function launchBrowser(options = {}) {
  // Started here and connected to over its debugging port: puppeteer.launch() cannot drive Edge on Windows (Edge
  // does not print its DevTools address, and quits with puppeteer's default switches)
  const puppeteer = require('puppeteer-core');
  const { spawn } = require('child_process');
  const port = await freePort();
  // Outside the repository: the dev server watches it (a browser's locked files would crash it)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-test-browser-'));
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...(options.args || []),
    'about:blank',
  ];
  const child = spawn(browserPath(), args, { stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 80 && !browser; i++) {
    await sleep(250);
    browser = await puppeteer
      .connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: options.defaultViewport === undefined ? { width: 1600, height: 1000 } : options.defaultViewport,
        protocolTimeout: 240000,
      })
      .catch(() => null);
  }
  if (!browser) {
    child.kill();
    throw new Error(`The browser did not start (${browserPath()})`);
  }
  // Closing the browser ends its process; so does the end of the test
  const removeProfile = () => {
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // still locked: the OS temp folder is cleaned eventually
    }
  };
  // The browser's whole process tree: on Windows, killing the main process leaves its renderers running
  // (Edge's launcher can hand over to another browser process and exit: its processes are found by their profile)
  let killed = false;
  const killTree = () => {
    if (killed) return;
    killed = true;
    if (process.platform === 'win32') {
      const name = path.basename(profile).replace(/'/g, '');
      require('child_process').spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='${path.basename(browserPath())}'" | Where-Object { $_.CommandLine -like '*${name}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore' });
    } else if (child.exitCode === null) child.kill('SIGKILL');
  };
  const close = browser.close.bind(browser);
  browser.close = async () => {
    // Windows: the tree is killed while its main process lives (once that exits, its renderers can no longer be
    // found through it); elsewhere a normal close
    if (process.platform === 'win32') {
      browser.disconnect().catch(() => {});
      killTree();
    } else {
      await close().catch(() => {});
      killTree();
    }
    await sleep(300);
    removeProfile();
  };
  // Also when a test fails or ends without closing it
  process.on('exit', () => {
    killTree();
    removeProfile();
  });
  return browser;
}

/** A TCP port nothing listens on now */
function freePort() {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** Waits for a line matching `rx` in a file a process writes (e.g. Link's pairing code); the match, or null */
async function waitForText(file, rx, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    try {
      const m = fs.readFileSync(file, 'utf8').match(rx);
      if (m) return m;
    } catch {
      // not written yet
    }
  }
  return null;
}

const out = (name) => path.join(OUT, name);
const fixture = (...parts) => path.join(FIXTURES, ...parts);

module.exports = { REPO, TESTS, OUT, FAKES, FIXTURES, APP_URL, APP_ORIGIN, sleep, browserPath, launchBrowser, freePort, waitForText, out, fixture };
