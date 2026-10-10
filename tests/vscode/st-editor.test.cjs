// The VS Code extension in VS Code itself (this computer's, with a profile of its own in tests/.output: the user's
// settings and extensions untouched; its window shows for a moment): a .TcPOU opened as Structured Text, its
// declaration and implementation, edited and saved back into the file; a member; a .TcDUT; the TwinCAT commands.
// The checks run inside VS Code (st-editor.inside.cjs); its results come back as a file. Not in the default suites:
//   node tests/run.cjs vscode
// Skipped without VS Code. KSS_VSCODE: another Code.exe.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.join(REPO, 'tests', '.output', 'vscode-st-editor');
const codeExe = process.env.KSS_VSCODE || [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe')].find((f) => fs.existsSync(f));
if (!codeExe) {
  console.log('skipped (VS Code is not installed here)');
  process.exit(0);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// The extension as packed: its code bundled (extension.js with ../shared), its manifest, grammar and icon
const ext = path.join(OUT, 'ext');
fs.mkdirSync(ext);
require('esbuild').buildSync({ entryPoints: [path.join(REPO, 'vscode-extension', 'extension.js')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], outfile: path.join(ext, 'extension.js'), logLevel: 'warning' });
fs.copyFileSync(path.join(REPO, 'vscode-extension', 'package.json'), path.join(ext, 'package.json'));
for (const dir of ['syntaxes', 'media']) fs.cpSync(path.join(REPO, 'vscode-extension', dir), path.join(ext, dir), { recursive: true });

// A TwinCAT project: its .tsproj, a PLC project, a POU (CRLF, a BOM) and its enum
const { pou, dut } = require(path.join(REPO, 'tests', 'fixtures', 'third-party-pou.cjs'));
const proj = path.join(OUT, 'Cell');
fs.mkdirSync(path.join(proj, 'Robot', 'POUs'), { recursive: true });
fs.mkdirSync(path.join(proj, 'Robot', 'DUTs'), { recursive: true });
fs.writeFileSync(path.join(proj, 'Cell.tsproj'), '<?xml version="1.0"?>\r\n<TcSmProject TcSmVersion="1.0" TcVersion="3.1.4026.27">\r\n\t<Project ProjectGUID="{00000000-0000-0000-0000-000000000001}" Target64Bit="true"/>\r\n</TcSmProject>\r\n');
fs.writeFileSync(path.join(proj, 'Robot', 'Robot.plcproj'), '<?xml version="1.0" encoding="utf-8"?>\r\n<Project/>\r\n');
fs.writeFileSync(path.join(proj, 'Robot', 'POUs', 'FB_ScanSequencer.TcPOU'), '﻿' + pou.replace(/\r?\n/g, '\r\n'));
fs.writeFileSync(path.join(proj, 'Robot', 'DUTs', 'E_ScanState.TcDUT'), '﻿' + dut.replace(/\r?\n/g, '\r\n'));

const result = path.join(OUT, 'result.json');
// (Build: the stand-in for XAE, KSS_BUILD_DRYRUN: no XAE started)
// (Live values: a stand-in PLC: FB_ScanSequencer's instance and its values)
const standIn = path.join(OUT, 'live.json');
const names = ['InitializeScan', 'MoveToStart', 'ResetData', 'FastScan', 'ProcessFastScan', 'ComputeResult'];
fs.writeFileSync(standIn, JSON.stringify({
  instances: { FB_ScanSequencer: ['MAIN.fbScan'] },
  symbols: {
    'MAIN.fbScan.State': { type: 'E_ScanState', value: 3, enum: Object.fromEntries(names.map((n, i) => [i, n])) },
    'MAIN.fbScan.Busy': { type: 'BOOL', value: true },
    'MAIN.fbScan._Count': { type: 'INT', value: 7 },
  },
}));
const env = { ...process.env, KSS_TEST_PROJECT: proj, KSS_TEST_RESULT: result, KSS_BUILD_DRYRUN: "1", KSS_LIVE_STANDIN: standIn, KSS_LIVE_POLL_MS: "200" };
// (a VS Code terminal sets this: Code.exe would run as plain Node)
delete env.ELECTRON_RUN_AS_NODE;
const args = [
  proj,
  `--extensionDevelopmentPath=${ext}`,
  `--extensionTestsPath=${path.join(__dirname, 'st-editor.inside.cjs')}`,
  `--user-data-dir=${path.join(OUT, 'user-data')}`,
  `--extensions-dir=${path.join(OUT, 'extensions')}`,
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-telemetry',
  '--disable-gpu',
  '--new-window',
];
const started = Date.now();
const child = spawn(codeExe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));
const timer = setTimeout(() => child.kill(), 240000);
child.on('exit', (code) => {
  clearTimeout(timer);
  fs.writeFileSync(path.join(OUT, 'vscode.log'), log);
  let results = null;
  try {
    results = JSON.parse(fs.readFileSync(result, 'utf8'));
  } catch {
    results = null;
  }
  if (!results) {
    console.log(`FAIL VS Code ran no checks (exit ${code}, ${((Date.now() - started) / 1000).toFixed(0)} s); its output: ${log.slice(-1500)}`);
    process.exit(1);
  }
  let fails = 0;
  for (const [ok, what] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails++;
  }
  console.log(`${fails} failures (VS Code ${((Date.now() - started) / 1000).toFixed(0)} s)`);
  process.exit(fails ? 1 : 0);
});
void os;
