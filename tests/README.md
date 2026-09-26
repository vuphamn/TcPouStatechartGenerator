# Tests

```
npm test                 # unit + web + live (what CI runs)
npm run test:unit        # one suite: unit | web | live | desktop
npm run test:all         # all four
node tests/run.cjs web --filter pou     # only the tests whose file name contains "pou"
```

The runner prints one line per test and a summary. It exits with 1 when a test fails. Each test's output is in
`tests/.output/logs/<suite>-<name>.log`, and screenshots are in `tests/.output`. That folder is not committed.

## Suites

| Suite | What | Needs |
|---|---|---|
| `unit/*.test.ts` | Parsing, generation, lint, guards, chart diff, the POU editor's read/write. Plain TypeScript run on Node (bundled with esbuild). | Nothing |
| `web/*.test.cjs` | The app in a headless browser: diagram editing, editors (caret line, zoom, find, jumps), POU Editor, Problems, layout, samples, several tabs / instances, live view and Symbols through Link. | Chrome or Edge |
| `live/*.test.cjs` | The live view's protocol against a simulated PLC: instance discovery, guard variables, symbol browsing, through the gateway and Link. | Nothing |
| `desktop/*.test.cjs` | The Electron app: windows per POU / instance, Explorer's Open, live view straight to a PLC, Symbols with Watch. | Windows |

The **web** and **desktop** suites start a Vite dev server on port 5199 and load the app once before the first
test. To test a running server instead, set `TEST_APP_URL` (e.g. `http://localhost:3000/`).

The browser is `CHROME_PATH` when it is set. Otherwise it is Edge or Chrome where they are normally installed.

Tests that need a real TwinCAT project are skipped unless `KSS_PROJECT` names a PLC project folder. Use a copy of
the project, never a working one. Example: `unit/guards-project` checks that every transition of every state machine
in the project has its guard.

## The pieces

- `lib/harness.cjs`: paths (`REPO`, `OUT`, `FAKES`, `FIXTURES`), `APP_URL`, `launchBrowser()`, `freePort()`.
- `fakes/fake-ams2.cjs`: a simulated PLC that speaks AMS/TCP. It has typed symbols with scripted value changes,
  symbol upload (instance discovery) and data types (symbol browser). Config: `{ symbols, upload, types, script }`.
  `fakes/symbols-plc.cjs` is the config the Symbols tests share. `fakes/fake-ams.cjs` is the older single-variable
  PLC, driven by a value sequence (`fakes/seq.json`).
- `fixtures/`: `.TcPOU` / `.TcDUT` files (Table Manager, Door Dasher) for the tests that open files.

## Writing a test

A test is a Node script that prints `ok  <what>` / `FAIL <what>` lines and exits with a non-zero code on a failure.
The runner also counts any line that starts with `FAIL`.

```js
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
(async () => {
  const browser = await h.launchBrowser();
  const page = await browser.newPage();
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node');
  expect(/* ... */ true, 'what is checked');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
```

Tests start from a fresh browser profile, so localStorage is empty. Tests that need a fixed state set it
themselves, for example a saved dock layout. The processes a test starts (fake PLCs, Link, the gateway, Electron)
are stopped by the test itself.

## Not run by the runner

`xae/` has the TwinCAT XAE extension's tests. They drive Visual Studio's experimental instance on a copy of a
TwinCAT project, so they are run by hand. See `xae/README.md`.
