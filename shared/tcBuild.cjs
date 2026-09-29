// Rebuild the PLC's project, and write it back (Windows, TwinCAT XAE on this computer): the project as the PLC keeps
// it (its boot folder: CurrentConfig.tszip, the TwinCAT project; CurrentConfig/<name>.tpzip / .tfzip, its PLC and
// safety projects, downloaded with their sources) unpacked into a work folder, the POUs edited here put in, then
// built by TwinCAT XAE through its Automation Interface (an invisible TcXaeShell of its own: the user's XAE windows
// are not touched). The build's errors and warnings come back with the POU and line. Writing back: PLC login with
// online change (the PLC keeps running), or, after its own confirmation, a download (the PLC stops and starts
// again); the sources downloaded with it, so the PLC's archive matches the running code.
// Used by the desktop app and Link (shared/liveSession.cjs) and the gateway.
// KSS_BUILD_DRYRUN=1: XAE is not started; the work folder is made and the script returned (the tests).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { readBootFile, unzip, readPlcSources } = require('./tcSources.cjs');

const dry = () => process.env.KSS_BUILD_DRYRUN === '1';
const text = (b) => b.toString('utf8').replace(/^﻿/, '');
// (a PowerShell string: single quotes doubled)
const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;
const SAFE_NAME = /^[\w .()-]+$/;

/** A zip entry's path kept inside the folder it is unpacked to (no absolute paths, no ..) */
function inside(root, rel) {
  const p = path.resolve(root, rel.replace(/\\/g, '/'));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error(`An archive entry outside its folder: ${rel}`);
  return p;
}
function unpack(buf, root) {
  for (const f of unzip(buf)) {
    const p = inside(root, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
}

/**
 * The project's archives from the PLC's boot folder (read: relPath → Buffer): the TwinCAT project and each nested
 * project it names (PLC: .tpzip, safety: .tfzip). { info, system, nested: [{ name, kind, xti, prjPath, data }] }
 */
async function fetchProjectArchives(read) {
  let info;
  try {
    info = JSON.parse(text(await read('CurrentProjectInfo.json')));
  } catch (err) {
    throw new Error(`The PLC has no project information in its boot folder (${err?.adsError?.errorStr ?? err?.message ?? err})`);
  }
  let system;
  try {
    system = await read('CurrentConfig.tszip');
  } catch (err) {
    throw new Error(`The PLC keeps no copy of its TwinCAT project (CurrentConfig.tszip: ${err?.adsError?.errorStr ?? err?.message ?? err}). Activate the project from XAE once with its sources.`);
  }
  const nested = [];
  for (const f of unzip(system, (p) => /^_Config\/[^/]+\/[^/]+\.xti$/i.test(p))) {
    const xml = text(f.data);
    const tag = /<Project\b[^>]*>/.exec(xml)?.[0] ?? '';
    const name = /\bName="([^"]+)"/.exec(tag)?.[1] ?? '';
    const prjPath = /\bPrjFilePath="([^"]+)"/.exec(tag)?.[1] ?? '';
    if (!prjPath || !SAFE_NAME.test(name)) continue;
    const kind = /\.plcproj$/i.test(prjPath) ? 'plc' : /\.splcproj$/i.test(prjPath) ? 'safety' : null;
    if (!kind) continue;
    let data = null;
    try {
      data = await read(`CurrentConfig/${name}.${kind === 'plc' ? 'tpzip' : 'tfzip'}`);
    } catch {
      // (not downloaded with its sources: the build says so)
    }
    nested.push({ name, kind, xti: f.path, prjPath: prjPath.replace(/\\/g, '/'), data });
  }
  return { info, system, nested };
}

/**
 * The work folder: the TwinCAT project, each nested project where its .xti expects it, and the POUs edited here
 * (edits: [{ plcProject, path: its path in that PLC project, content }]). Returns { dir, tsproj, plcProjects }
 */
function writeWorkspace(archives, edits = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-build-'))) {
  const root = path.resolve(dir);
  unpack(archives.system, root);
  const tsproj = fs.readdirSync(root).find((f) => /\.tsproj$/i.test(f));
  if (!tsproj) throw new Error('The PLC\'s TwinCAT project has no .tsproj');
  const plcProjects = [];
  const missing = [];
  for (const n of archives.nested) {
    // (PrjFilePath: relative to the .xti)
    const prj = inside(root, path.posix.join(path.posix.dirname(n.xti), n.prjPath));
    if (!n.data) {
      missing.push(`${n.name} (${n.kind === 'plc' ? 'PLC' : 'safety'} project)`);
      continue;
    }
    unpack(n.data, path.dirname(prj));
    if (n.kind === 'plc') plcProjects.push({ name: n.name, dir: path.dirname(prj), plcproj: prj });
  }
  if (missing.length) throw new Error(`The PLC keeps no sources of ${missing.join(', ')}: download the project with its sources (PLC project > Settings > Source download) to rebuild it`);
  const applied = [];
  for (const e of edits) {
    const plc = plcProjects.find((p) => p.name.toLowerCase() === String(e.plcProject ?? '').toLowerCase()) ?? (plcProjects.length === 1 ? plcProjects[0] : null);
    if (!plc) throw new Error(`No PLC project ${e.plcProject} in the PLC's TwinCAT project`);
    if (!/\.(TcPOU|TcDUT|TcGVL|TcIO)$/i.test(e.path)) throw new Error(`Not a PLC source: ${e.path}`);
    const p = inside(plc.dir, e.path);
    if (!fs.existsSync(p)) throw new Error(`${e.path} is not in ${plc.name}`);
    // (as XAE writes them: CRLF)
    fs.writeFileSync(p, String(e.content).replace(/\r?\n/g, '\r\n'));
    applied.push(`${plc.name}/${e.path}`);
  }
  return { dir: root, tsproj: path.join(root, tsproj), plcProjects, applied };
}

// The Automation Interface's calls are refused while XAE is busy (RPC_E_CALL_REJECTED): a message filter retries
// them, as in Beckhoff's samples
const MESSAGE_FILTER = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("00000016-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IOleMessageFilter {
  [PreserveSig] int HandleInComingCall(int dwCallType, IntPtr hTaskCaller, int dwTickCount, IntPtr lpInterfaceInfo);
  [PreserveSig] int RetryRejectedCall(IntPtr hTaskCallee, int dwTickCount, int dwRejectType);
  [PreserveSig] int MessagePending(IntPtr hTaskCallee, int dwTickCount, int dwPendingType);
}
public class KssMessageFilter : IOleMessageFilter {
  public static void Register() { IOleMessageFilter old; CoRegisterMessageFilter(new KssMessageFilter(), out old); }
  public static void Revoke() { IOleMessageFilter old; CoRegisterMessageFilter(null, out old); }
  int IOleMessageFilter.HandleInComingCall(int a, IntPtr b, int c, IntPtr d) { return 0; }
  int IOleMessageFilter.RetryRejectedCall(IntPtr a, int tick, int type) { return (type == 2 && tick < 120000) ? 150 : -1; }
  int IOleMessageFilter.MessagePending(IntPtr a, int b, int c) { return 2; }
  [DllImport("Ole32.dll")] private static extern int CoRegisterMessageFilter(IOleMessageFilter n, out IOleMessageFilter o);
}
"@
[KssMessageFilter]::Register()
`;

// The Error List through the typed interface (DTE2: not reachable from PowerShell's late binding), from XAE's own
// interop assembly. Its items fill in after the build returns and are refilled for a while: read until they settle.
// Errors and warnings apart: the list's own filters (every item reports the same level)
const ERROR_LIST = `
[void][Reflection.Assembly]::LoadFrom($interop)
Add-Type -ReferencedAssemblies $interop -TypeDefinition @"
using System.Collections.Generic;
public static class KssErrorList {
  public static EnvDTE80.ErrorList List(object dte) { return ((EnvDTE80.DTE2)dte).ToolWindows.ErrorList; }
  static List<string[]> Snapshot(object dte, out int count) {
    var items = List(dte).ErrorItems;
    count = items.Count;
    var o = new List<string[]>();
    for (int i = 1; i <= count; i++) {
      try {
        var e = items.Item(i);
        var d = e.Description;
        if (!string.IsNullOrEmpty(d)) o.Add(new string[] { e.FileName ?? "", e.Line.ToString(), e.Column.ToString(), e.Project ?? "", d });
      } catch { }
    }
    return o;
  }
  // Until every item has its text and the count holds for a second (at most seconds)
  public static List<string[]> Settled(object dte, int seconds) {
    List<string[]> best = new List<string[]>();
    int last = -1, steady = 0;
    for (int k = 0; k < seconds * 4; k++) {
      int count;
      var s = Snapshot(dte, out count);
      if (s.Count > best.Count || (s.Count == count && s.Count >= best.Count)) best = s;
      steady = (count == last && s.Count == count) ? steady + 1 : 0;
      last = count;
      if (steady >= 4) break;
      System.Threading.Thread.Sleep(250);
    }
    return best;
  }
}
"@
`;

const MODES = {
  // Login: the PLC takes the new code as an online change (it keeps running); XAE's own answers (SuppressUI)
  online: 'Online change',
  // The whole configuration: TwinCAT restarts (the PLC stops, then starts again); its sources stored with it
  activate: 'Activate configuration',
};

/**
 * The PowerShell script for XAE: open the work folder's project in a new solution, build it, report the Error List
 * (JSON lines on stdout: {"kind":"item",...}, then {"kind":"done",...}). write: 'online' (PLC login: online change)
 * or 'activate' (activate the configuration: TwinCAT restarts); only when the build has no errors
 */
function buildScript({ dir, tsproj, plcProject, write = null, netId = '', progId = 'TcXaeShell.DTE.17.0' }) {
  if (write && !MODES[write]) throw new Error(`Unknown write: ${write}`);
  const plcItem = `TIPC^${plcProject}^${plcProject} Project`;
  const writeStep = write === 'online'
    ? `  $plc = $sm.LookupTreeItem(${ps(plcItem)})
  $plc.ConsumeXml('<TreeItem><IECProjectDef><OnlineSettings><Commands><LoginCmd>true</LoginCmd><StartCmd>true</StartCmd></Commands></OnlineSettings></IECProjectDef></TreeItem>')
  # (logged in a moment later: waited for)
  for ($w = 0; $w -lt 60; $w++) {
    $online = ([xml]$plc.ProduceXml($false)).TreeItem.IECProjectDef.OnlineSettings
    if ($online.LoggedIn -eq 'true') { break }
    Start-Sleep -Milliseconds 500
  }
  Say @{ kind = 'online'; loggedIn = [string]$online.LoggedIn; app = [string]$online.PlcAppState; op = [string]$online.PlcOpState; info = [string]$online.OnlineAppInfo.InnerXml }
  if ($online.LoggedIn -ne 'true') { Say @{ kind = 'done'; ok = $false; errors = 0; fatal = 'XAE did not log in to the PLC (the online change was not made): nothing was written' }; exit 0 }
  # The boot project too (as XAE's Activate Boot Project): a restart keeps the new code, and the PLC's archive gets
  # its sources
  $boot = ''
  try { Say @{ kind = 'step'; text = 'Updating the boot project' }; $sm.LookupTreeItem(${ps(`TIPC^${plcProject}`)}).GenerateBootProject($true) } catch { $boot = $_.Exception.Message }
  try { $plc.ConsumeXml('<TreeItem><IECProjectDef><OnlineSettings><Commands><LogoutCmd>true</LogoutCmd></Commands></OnlineSettings></IECProjectDef></TreeItem>') } catch { }
  if ($boot) { Say @{ kind = 'item'; level = 'warning'; text = ('The boot project was not updated (a restart brings the old code back): ' + $boot); file = ''; line = 0; column = 0; project = '' } }
  Say @{ kind = 'done'; ok = ($online.LoggedIn -eq 'true' -or $online.PlcAppState -eq 'Run'); errors = 0; written = 'online'; plcState = [string]$online.PlcAppState; loggedIn = [string]$online.LoggedIn; bootProject = ($boot -eq '') }`
    : write === 'activate'
      ? `  $sm.ActivateConfiguration()
  $sm.StartRestartTwinCAT()
  Say @{ kind = 'done'; ok = $true; errors = 0; written = 'activate' }`
      : '';
  return `$ErrorActionPreference = 'Stop'
${MESSAGE_FILTER}
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)) }
$dte = $null
# (the TcXaeShell this script starts: the ones already running, the user's, are left alone)
$before = @(Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
# XAE's user settings: this instance saves them when it quits (window layout, options). Kept as they are: copied
# now, put back after (the ones it changed; the ones it made removed). Not the private registry hive (open in the
# user's own XAE)
$kssSettings = @(
  (Join-Path $env:LOCALAPPDATA 'Beckhoff\\TcXaeShell'),
  (Join-Path $env:APPDATA 'Beckhoff\\TcXaeShell'),
  (Join-Path $env:LOCALAPPDATA 'Beckhoff\\TwinCAT\\PlcEngineering\\Options')
) | Where-Object { Test-Path $_ }
$kssKeep = Join-Path ${ps(dir)} 'xae-settings'
$kssFiles = @{}
foreach ($root in $kssSettings) {
  foreach ($f in Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\\.(vssettings|opt|prf|dat|winprf|xml|json|txt)$' -and $_.Length -lt 5MB }) {
    $copy = Join-Path $kssKeep ([guid]::NewGuid().ToString('N'))
    try { New-Item -ItemType Directory -Force -Path $kssKeep | Out-Null; Copy-Item -LiteralPath $f.FullName -Destination $copy -ErrorAction Stop; $kssFiles[$f.FullName] = @{ copy = $copy; time = $f.LastWriteTimeUtc } } catch { }
  }
}
function Restore-KssSettings {
  foreach ($root in $kssSettings) {
    foreach ($f in Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match '^\\.(vssettings|opt|prf|dat|winprf|xml|json|txt)$' }) {
      $was = $kssFiles[$f.FullName]
      try {
        if (-not $was) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop }
        elseif ($f.LastWriteTimeUtc -ne $was.time) { Copy-Item -LiteralPath $was.copy -Destination $f.FullName -Force -ErrorAction Stop; (Get-Item -LiteralPath $f.FullName).LastWriteTimeUtc = $was.time }
      } catch { }
    }
  }
}
$mine = @()
try {
  # XAE's folder (its interop assembly): from its registered automation server
  $clsid = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\' + ${ps(progId)} + '\\CLSID')).'(default)'
  $server = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\CLSID\\' + $clsid + '\\LocalServer32')).'(default)'
  $exe = if ($server.StartsWith('"')) { $server.Substring(1, $server.IndexOf('"', 1) - 1) } else { $server.Substring(0, $server.ToLower().IndexOf('.exe') + 4) }
  $interop = Join-Path (Split-Path $exe) 'PublicAssemblies\\Microsoft.VisualStudio.Interop.dll'
${ERROR_LIST}
  Say @{ kind = 'step'; text = 'Starting TwinCAT XAE (in the background)' }
  $dte = New-Object -ComObject ${ps(progId)}
  $mine = @(Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
  # (the Error List fills only with the UI on; the window stays hidden)
  $dte.SuppressUI = $false
  $dte.MainWindow.Visible = $false
  $dte.UserControl = $false
  $sln = $dte.Solution
  $sln.Create(${ps(dir)}, 'StateScopeBuild')
  $proj = $sln.AddFromFile(${ps(tsproj)})
  $sm = $proj.Object
  ${netId ? `$sm.SetTargetNetId(${ps(netId)})` : ''}
  try { $dte.ExecuteCommand('View.ErrorList') } catch { }
  Say @{ kind = 'step'; text = 'Building' }
  $sln.SolutionBuild.Build($true)
  $failed = $sln.SolutionBuild.LastBuildInfo
  $list = [KssErrorList]::List($dte)
  $counts = @{}
  foreach ($level in 'error', 'warning') {
    $list.ShowErrors = ($level -eq 'error'); $list.ShowWarnings = ($level -eq 'warning'); $list.ShowMessages = $false
    $found = [KssErrorList]::Settled($dte, $(if ($level -eq 'error' -and $failed -gt 0) { 30 } else { 8 }))
    $counts[$level] = $found.Count
    $n = 0
    foreach ($e in $found) {
      if ($n++ -ge 500) { break }
      Say @{ kind = 'item'; level = $level; file = $e[0]; line = [int]$e[1]; column = [int]$e[2]; project = $e[3]; text = $e[4] }
    }
  }
  $list.ShowErrors = $true; $list.ShowWarnings = $true
  if ($counts['error'] -gt 0 -or $failed -gt 0) { Say @{ kind = 'done'; ok = $false; errors = $counts['error']; warnings = $counts['warning']; failedProjects = $failed }; exit 0 }
${write ? `  Say @{ kind = 'step'; text = ${ps(MODES[write])} }
  # (from here XAE answers its own questions: no hidden dialog waits)
  $dte.SuppressUI = $true
${writeStep}` : `  Say @{ kind = 'done'; ok = $true; errors = 0; warnings = $counts['warning'] }`}
} catch {
  Say @{ kind = 'done'; ok = $false; fatal = $_.Exception.Message }
} finally {
  if ($dte) { try { $dte.Quit() } catch { } }
  [KssMessageFilter]::Revoke()
  # (still running: stopped, only this script's own)
  Start-Sleep -Seconds 2
  foreach ($id in $mine) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  # (only when the user's own XAE did not quit meanwhile: then the changes may be its own)
  $still = @(Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (@($before | Where-Object { $still -notcontains $_ }).Count -eq 0) { Restore-KssSettings }
}
`;
}

/** Runs the script (JSON lines: progress as they come) → { ok, items, errors, fatal, written } */
/** The TcXaeShell processes running now (their ids) */
function xaeProcesses() {
  try {
    const out = require('child_process').execFileSync('tasklist', ['/FI', 'IMAGENAME eq TcXaeShell.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    return new Set([...out.matchAll(/^"TcXaeShell\.exe","(\d+)"/gim)].map((m) => Number(m[1])));
  } catch {
    return new Set();
  }
}

function runScript(script, { dir, onStep, timeoutMs = 15 * 60 * 1000 }) {
  const file = path.join(dir, 'kss-build.ps1');
  // (UTF-8 with its BOM: Windows PowerShell 5.1 reads the file as such)
  fs.writeFileSync(file, '﻿' + script);
  if (dry()) return Promise.resolve({ ok: true, items: [], errors: 0, dry: file });
  // (the XAE this build starts: stopped when the script cannot, a timeout; the user's are left alone)
  const before = xaeProcesses();
  return new Promise((resolve) => {
    const items = [];
    let done = null;
    let rest = '';
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', file], { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error?.killed) for (const id of xaeProcesses()) if (!before.has(id)) try { process.kill(id); } catch { /* gone */ }
      if (done) return resolve({ ...done, items });
      if (error?.killed) return resolve({ ok: false, items, errors: items.filter((i) => i.level === 'error').length, fatal: `XAE did not finish in ${Math.round(timeoutMs / 60000)} minutes (a dialog waiting?): stopped, nothing written` });
      resolve({ ok: false, items, errors: items.filter((i) => i.level === 'error').length, fatal: (String(stderr).trim().split('\n')[0] || error?.message || 'XAE stopped').slice(0, 500) });
    });
    child.stdout.on('data', (d) => {
      rest += d;
      const lines = rest.split(/\r?\n/);
      rest = lines.pop();
      for (const l of lines) {
        let m;
        try {
          m = JSON.parse(l);
        } catch {
          continue;
        }
        if (m.kind === 'item') items.push({ level: m.level, text: m.text, file: m.file, line: m.line, column: m.column, project: m.project });
        else if (m.kind === 'step') onStep?.(m.text);
        else if (m.kind === 'online' && process.env.KSS_BUILD_DEBUG) console.log('online', JSON.stringify(m));
        
        else if (m.kind === 'done') done = m;
      }
    });
  });
}

/** An error's place in the edited sources: the PLC project's path of its file (null: another file) */
// XAE names a message's place "<file>.TcPOU@<method> (Impl)": the file, the member (a method, action, property
// accessor: Prop.Get), its declaration (Decl) or implementation (Impl); the line within that part
function placeOf(item, ws) {
  const m = /^(.*?\.Tc(?:POU|DUT|GVL|IO))(?:@([^ (]+))?(?:\s*\((Impl|Decl)\))?\s*$/i.exec(String(item.file || '').trim());
  if (!m) return null;
  const f = m[1].replace(/\//g, '\\');
  for (const p of ws.plcProjects) {
    const d = p.dir.replace(/\//g, '\\') + '\\';
    if (f.toLowerCase().startsWith(d.toLowerCase())) {
      return { plcProject: p.name, path: f.slice(d.length).replace(/\\/g, '/'), member: m[2] ?? null, part: m[3] ? (m[3].toLowerCase() === 'decl' ? 'declaration' : 'implementation') : null, line: item.line || null };
    }
  }
  return null;
}

/** Is TwinCAT XAE's Automation Interface on this computer (its ProgID registered)? */
function xaeAvailable(progId = 'TcXaeShell.DTE.17.0') {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (dry()) return Promise.resolve(true);
  return new Promise((resolve) => execFile('reg', ['query', `HKCR\\${progId}`], { windowsHide: true }, (err) => resolve(!err)));
}

/**
 * Build (and write back): read the project from the PLC (client: its ADS connection), put the edits in, build with
 * XAE. write: null (build only), 'online', 'download'. → { ok, items: [{ level, text, file, line, place }], ... }
 */
async function buildFromPlc(client, { edits = [], plcProject = '', write = null, netId = '', adsPort = 851, onStep } = {}) {
  if (!(await xaeAvailable())) return { ok: false, fatal: 'TwinCAT XAE is not installed on this computer: its Automation Interface builds the project (TcXaeShell)', items: [] };
  onStep?.('Reading the project from the PLC');
  const archives = await fetchProjectArchives((rel) => readBootFile(client, rel));
  const ws = writeWorkspace(archives, edits);
  const plc = ws.plcProjects.find((p) => p.name.toLowerCase() === plcProject.toLowerCase()) ?? ws.plcProjects[0];
  if (!plc) return { ok: false, fatal: 'The PLC\'s TwinCAT project has no PLC project', items: [] };
  const r = dry()
    ? standInBuild(ws, edits, write)
    : await runScript(buildScript({ dir: ws.dir, tsproj: ws.tsproj, plcProject: plc.name, write, netId }), { dir: ws.dir, onStep });
  const items = (r.items ?? []).map((i) => ({ ...i, place: placeOf(i, ws) }));
  if (!dry()) fs.rm(ws.dir, { recursive: true, force: true }, () => {});
  // Written: the PLC's sources read again against its running code (their types as built against the PLC's own):
  // the same, or the write did not take
  let verified;
  if (r.ok && r.written) {
    onStep?.('Checking the PLC');
    try {
      const again = await readPlcSources(client, adsPort, { plcProject: plc.name });
      verified = again.error ? { ok: false, text: again.error } : again.stale ? { ok: false, text: again.stale } : { ok: true, text: 'The PLC runs the code written, and keeps its sources' };
    } catch (err) {
      verified = { ok: false, text: `Could not check the PLC: ${err?.message ?? err}` };
    }
    if (!verified.ok) items.push({ level: 'warning', text: `After the write: ${verified.text}`, file: '', line: 0, column: 0, project: '', place: null });
  }
  return { ...r, items, plcProject: plc.name, applied: ws.applied, workspace: dry() ? ws.dir : undefined, ...(verified ? { verified } : {}) };
}

/**
 * KSS_BUILD_DRYRUN: no XAE; the script is written, and a stand-in compiler reports each edited POU's lines that
 * assign noSuchVar (as XAE names them: the file, its member, the line in that part)
 */
function standInBuild(ws, edits, write) {
  const script = path.join(ws.dir, 'kss-build.ps1');
  fs.writeFileSync(script, '\uFEFF' + buildScript({ dir: ws.dir, tsproj: ws.tsproj, plcProject: ws.plcProjects[0].name, write }));
  const items = [];
  for (const e of edits) {
    const plc = ws.plcProjects.find((x) => x.name.toLowerCase() === String(e.plcProject ?? '').toLowerCase()) ?? ws.plcProjects[0];
    const file = path.join(plc.dir, e.path).replace(/\//g, '\\');
    const xml = String(e.content);
    // the POU's body and its methods: <ST><![CDATA[...]]> after the member's name
    for (const m of xml.matchAll(/<(Method|Action)\s+Name="([^"]+)"[\s\S]*?<ST><!\[CDATA\[([\s\S]*?)\]\]><\/ST>|<POU\s+Name="[^"]+"[\s\S]*?<Implementation>\s*<ST><!\[CDATA\[([\s\S]*?)\]\]><\/ST>/g)) {
      const member = m[2] ?? null;
      const code = m[3] ?? m[4] ?? '';
      code.split(/\r?\n/).forEach((l, i) => {
        if (/\bnoSuchVar\b/.test(l)) items.push({ level: 'error', text: "Identifier 'noSuchVar' not defined", file: `${file}${member ? `@${member}` : ''} (Impl)`, line: i + 1, column: 1, project: `${plc.name}\\${plc.name}.plcproj` });
      });
    }
  }
  items.push({ level: 'warning', text: 'A stand-in warning (dry run)', file: '', line: 0, column: 0, project: '' });
  const errors = items.filter((i) => i.level === 'error').length;
  return { ok: errors === 0, items, errors, warnings: 1, dry: script, ...(errors === 0 && write ? { written: write } : {}) };
}

/** A build request's edits and write checked: an error text, or null */
function checkEdits(req) {
  const edits = req?.edits ?? [];
  if (!Array.isArray(edits) || edits.length > 100) return 'The edits: up to 100 files';
  for (const e of edits) {
    if (!e || typeof e.path !== 'string' || e.path.length > 400 || !/\.(TcPOU|TcDUT|TcGVL|TcIO)$/i.test(e.path) || /(^|\/)\.\.(\/|$)/.test(e.path) || /^([a-z]:|\/|\\)/i.test(e.path)) return `Not a PLC source path: ${String(e?.path).slice(0, 100)}`;
    if (typeof e.content !== 'string' || e.content.length > 8 * 1024 * 1024) return `${e.path}: its content is missing or too large`;
    if (e.plcProject != null && (typeof e.plcProject !== 'string' || !SAFE_NAME.test(e.plcProject))) return 'Not a PLC project name';
  }
  if (req?.write != null && req.write !== 'online' && req.write !== 'activate') return 'write: online or activate';
  return null;
}

module.exports = { fetchProjectArchives, writeWorkspace, buildScript, runScript, placeOf, xaeAvailable, buildFromPlc, checkEdits, MODES };
