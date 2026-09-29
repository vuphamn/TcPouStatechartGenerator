// Rebuild the PLC's project, and write it back (Windows, TwinCAT XAE on this computer): the project as the PLC keeps
// it (its boot folder: CurrentConfig.tszip, the TwinCAT project; CurrentConfig/<name>.tpzip / .tfzip, its PLC and
// safety projects, downloaded with their sources) unpacked into a work folder, the POUs edited here put in, then
// built by TwinCAT XAE through its Automation Interface (an invisible TcXaeShell of its own: the user's XAE windows
// are not touched; kept open for the next build: KSS_BUILD_KEEP_MINUTES, default 10). The build's errors and warnings
// come back with the POU and line. Writing back: PLC login with online change (the PLC keeps running) and the boot project updated (a restart
// keeps the new code; the PLC's archive gets its sources), or, after its own confirmation, the configuration activated
// (TwinCAT restarts). The PLC is read again after a write: its code the one written?
// Used by the desktop app and Link (shared/liveSession.cjs) and the gateway.
// KSS_BUILD_DRYRUN=1: XAE is not started; the work folder is made and the script returned (the tests).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { readBootFile, unzip, readPlcSources } = require('./tcSources.cjs');
const { readTrialLicense, licenseState } = require('./tcLicense.cjs');
const { waitForRun } = require('./tcAppInfo.cjs');

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

// The PLC project's online interface (ITcPlcOnline, TwinCAT's automation assembly in the GAC): its Login takes flags,
// so an online change is asked for (FORCEONLINECHANGE) with no question shown (SILENT); XML LoginCmd cannot
const PLC_ONLINE = `
$tcsm = [Reflection.Assembly]::LoadWithPartialName('TCatSysManagerLib')
if (-not $tcsm) { throw 'The automation assembly of TwinCAT XAE (TCatSysManagerLib) is not installed' }
Add-Type -ReferencedAssemblies $tcsm.Location -TypeDefinition @"
public static class KssPlcOnline {
  static TCatSysManagerLib.ITcPlcOnline Of(object item) { return (TCatSysManagerLib.ITcPlcOnline)item; }
  public static bool Login(object item, int flags) { var o = Of(item); o.Login((TCatSysManagerLib.PLC_LOGIN_FLAGS)flags); return o.IsLoggedIn; }
  public static void Start(object item) { Of(item).Start(); }
  public static void Logoff(object item) { Of(item).Logoff(); }
}
"@
`;

const MODES = {
  // Login: the PLC takes the new code as an online change (it keeps running); XAE's own answers (SuppressUI)
  online: 'Online change',
  // Login with download: the PLC application stops, takes the new code and starts again (TwinCAT keeps running);
  // when an online change is not possible
  download: 'Download',
  // The whole configuration: TwinCAT restarts (the PLC stops, then starts again); its sources stored with it
  activate: 'Activate configuration',
};

// XAE's user settings: the hidden instance saves them when it quits (window layout, options). Copied when it starts,
// put back when it has quit: only the files that existed and changed; a file made meanwhile is left (it may be the
// user's own XAE's). Not the private registry hive (open in the user's own XAE)
const SETTINGS = `
$kssSettings = @(
  (Join-Path $env:LOCALAPPDATA 'Beckhoff\\TcXaeShell'),
  (Join-Path $env:APPDATA 'Beckhoff\\TcXaeShell'),
  (Join-Path $env:LOCALAPPDATA 'Beckhoff\\TwinCAT\\PlcEngineering\\Options')
) | Where-Object { Test-Path $_ }
$kssSettingsRx = '^\\.(vssettings|opt|prf|dat|winprf|xml|json|txt)$'
$kssKeep = Join-Path $env:TEMP ('kss-xae-settings-' + $PID)
$kssFiles = @{}
function Save-KssSettings {
  foreach ($root in $kssSettings) {
    foreach ($f in Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -match $kssSettingsRx -and $_.Length -lt 5MB }) {
      $copy = Join-Path $kssKeep ([guid]::NewGuid().ToString('N'))
      try { New-Item -ItemType Directory -Force -Path $kssKeep | Out-Null; Copy-Item -LiteralPath $f.FullName -Destination $copy -ErrorAction Stop; $kssFiles[$f.FullName] = @{ copy = $copy; time = $f.LastWriteTimeUtc } } catch { }
    }
  }
}
function Restore-KssSettings {
  foreach ($path in @($kssFiles.Keys)) {
    $was = $kssFiles[$path]
    try {
      $now = Get-Item -LiteralPath $path -ErrorAction Stop
      if ($now.LastWriteTimeUtc -ne $was.time) { Copy-Item -LiteralPath $was.copy -Destination $path -Force -ErrorAction Stop; (Get-Item -LiteralPath $path).LastWriteTimeUtc = $was.time }
    } catch { }
  }
  Remove-Item -LiteralPath $kssKeep -Recurse -Force -ErrorAction SilentlyContinue
}
`;

/**
 * The PowerShell for XAE: Start-Kss (a hidden TcXaeShell of its own), Build-Kss $r (open the work folder's project,
 * or keep the one open; build; report the Error List as JSON lines on stdout: {"kind":"item",...}, then
 * {"kind":"done",...}; write when asked: 'online', PLC login, the online change and the boot project; 'activate', the
 * configuration activated: TwinCAT restarts; only when the build has no errors), Stop-Kss. $r: { dir, tsproj,
 * plcProject, netId, write, changed: files rewritten while the project is open }
 */
function xaeFunctions(progId) {
  return `$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
${MESSAGE_FILTER}
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }
${SETTINGS}
$script:dte = $null
$script:sln = $null
$script:sm = $null
$script:openTsproj = $null
# (the TcXaeShell this script starts: the ones already running, the user's, are left alone)
$script:before = @()
$script:mine = @()
function Start-Kss {
  # XAE's folder (its interop assembly): from its registered automation server
  $clsid = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\' + ${ps(progId)} + '\\CLSID')).'(default)'
  $server = (Get-ItemProperty ('Registry::HKEY_CLASSES_ROOT\\CLSID\\' + $clsid + '\\LocalServer32')).'(default)'
  $exe = if ($server.StartsWith('"')) { $server.Substring(1, $server.IndexOf('"', 1) - 1) } else { $server.Substring(0, $server.ToLower().IndexOf('.exe') + 4) }
  $interop = Join-Path (Split-Path $exe) 'PublicAssemblies\\Microsoft.VisualStudio.Interop.dll'
${ERROR_LIST}
${PLC_ONLINE}
  Say @{ kind = 'step'; text = 'Starting TwinCAT XAE (in the background)' }
  $script:before = @(Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  Save-KssSettings
  $script:dte = New-Object -ComObject ${ps(progId)}
  $script:mine = @(Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue | Where-Object { $script:before -notcontains $_.Id } | ForEach-Object { $_.Id })
  Say @{ kind = 'xae'; pids = $script:mine }
  # (the Error List fills only with the UI on; the window stays hidden)
  $script:dte.SuppressUI = $false
  $script:dte.MainWindow.Visible = $false
  $script:dte.UserControl = $false
  $script:sln = $script:dte.Solution
}
function Stop-Kss {
  if ($script:dte) { try { $script:dte.Quit() } catch { } }
  [KssMessageFilter]::Revoke()
  # (still running: stopped, only this script's own)
  Start-Sleep -Seconds 2
  foreach ($id in $script:mine) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  # (only when the user's own XAE did not quit meanwhile: then the changes may be its own)
  $still = @(Get-Process -Name TcXaeShell -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if (@($script:before | Where-Object { $still -notcontains $_ }).Count -eq 0) { Restore-KssSettings }
}
function Open-Kss($r) {
  if ($script:openTsproj -eq $r.tsproj) { return $false }
  if ($script:openTsproj) { try { $script:sln.Close($false) } catch { } }
  $script:openTsproj = $null
  Say @{ kind = 'step'; text = 'Opening the project in XAE' }
  $script:sln.Create($r.dir, 'StateScopeBuild')
  $proj = $script:sln.AddFromFile($r.tsproj)
  $script:sm = $proj.Object
  $script:openTsproj = $r.tsproj
  try { $script:dte.ExecuteCommand('View.ErrorList') } catch { }
  return $true
}
function Build-Kss($r) {
  $opened = Open-Kss $r
  if ($r.netId) { $script:sm.SetTargetNetId($r.netId) }
  if (-not $opened -and $r.changed) {
    # Files rewritten while the project is open: XAE reloads them (its question answered itself), given a moment
    Say @{ kind = 'step'; text = 'Taking in the changed files' }
    $script:dte.SuppressUI = $true
    Start-Sleep -Seconds 5
    $script:dte.SuppressUI = $false
  }
  Say @{ kind = 'step'; text = 'Building' }
  $script:sln.SolutionBuild.Build($true)
  $failed = $script:sln.SolutionBuild.LastBuildInfo
  $list = [KssErrorList]::List($script:dte)
  $counts = @{}
  foreach ($level in 'error', 'warning') {
    $list.ShowErrors = ($level -eq 'error'); $list.ShowWarnings = ($level -eq 'warning'); $list.ShowMessages = $false
    $found = [KssErrorList]::Settled($script:dte, $(if ($level -eq 'error' -and $failed -gt 0) { 30 } else { 8 }))
    # (the same message listed more than once: once)
    $seen = @{}
    $n = 0
    foreach ($e in $found) {
      $key = $e[0] + '|' + $e[1] + '|' + $e[4]
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = 1
      if ($n++ -ge 500) { continue }
      Say @{ kind = 'item'; level = $level; file = $e[0]; line = [int]$e[1]; column = [int]$e[2]; project = $e[3]; text = $e[4] }
    }
    $counts[$level] = $seen.Count
  }
  $list.ShowErrors = $true; $list.ShowWarnings = $true
  if ($counts['error'] -gt 0 -or $failed -gt 0) { Say @{ kind = 'done'; ok = $false; errors = $counts['error']; warnings = $counts['warning']; failedProjects = $failed }; return }
  if (-not $r.write) { Say @{ kind = 'done'; ok = $true; errors = 0; warnings = $counts['warning'] }; return }
  Say @{ kind = 'step'; text = [string]$r.writeText }
  # (from here XAE answers its own questions: no hidden dialog waits)
  $script:dte.SuppressUI = $true
  try {
    if ($r.write -eq 'online') {
      $plc = $script:sm.LookupTreeItem('TIPC^' + $r.plcProject + '^' + $r.plcProject + ' Project')
      # Login with an online change, asking nothing (ITcPlcOnline: PLC_LOGIN_FLAGS_FORCEONLINECHANGE | SILENT): the PLC
      # takes the new code while it runs; when an online change is not possible the login fails, nothing is downloaded
      $loginError = ''
      try { [KssPlcOnline]::Login($plc, 2 + 256) | Out-Null } catch { $loginError = $_.Exception.InnerException.Message; if (-not $loginError) { $loginError = $_.Exception.Message } }
      # (logged in a moment later: waited for)
      for ($w = 0; $w -lt 60; $w++) {
        $online = ([xml]$plc.ProduceXml($false)).TreeItem.IECProjectDef.OnlineSettings
        if ($online.LoggedIn -eq 'true') { break }
        Start-Sleep -Milliseconds 500
      }
      Say @{ kind = 'online'; loggedIn = [string]$online.LoggedIn; app = [string]$online.PlcAppState; op = [string]$online.PlcOpState; info = [string]$online.OnlineAppInfo.InnerXml; error = $loginError }
      if ($online.LoggedIn -ne 'true') { Say @{ kind = 'done'; ok = $false; errors = 0; fatal = ('No online change was made, nothing was written' + $(if ($loginError) { ': ' + $loginError } else { ' (XAE did not log in to the PLC)' }) + '. TwinCAT did not make the online change through the Automation Interface (it logs in only when it can compute one). Download writes it (the PLC application stops and starts again).') }; return }
      if ($online.PlcAppState -ne 'Run') { try { [KssPlcOnline]::Start($plc) } catch { } }
      # The boot project too (as XAE's Activate Boot Project): a restart keeps the new code, and the PLC's archive
      # gets its sources
      $boot = ''
      try { Say @{ kind = 'step'; text = 'Updating the boot project' }; $script:sm.LookupTreeItem('TIPC^' + $r.plcProject).GenerateBootProject($true) } catch { $boot = $_.Exception.Message }
      try { [KssPlcOnline]::Logoff($plc) } catch { }
      if ($boot) { Say @{ kind = 'item'; level = 'warning'; text = ('The boot project was not updated (a restart brings the old code back): ' + $boot); file = ''; line = 0; column = 0; project = '' } }
      Say @{ kind = 'done'; ok = $true; errors = 0; written = 'online'; plcState = [string]$online.PlcAppState; loggedIn = [string]$online.LoggedIn; bootProject = ($boot -eq '') }
    } elseif ($r.write -eq 'download') {
      # Login with download, asking nothing (FORCEDOWNLOAD | SILENT): the application stops, the new code in, started
      $plc = $script:sm.LookupTreeItem('TIPC^' + $r.plcProject + '^' + $r.plcProject + ' Project')
      $loginError = ''
      try { [KssPlcOnline]::Login($plc, 4 + 256) | Out-Null } catch { $loginError = $_.Exception.InnerException.Message; if (-not $loginError) { $loginError = $_.Exception.Message } }
      for ($w = 0; $w -lt 60; $w++) {
        $online = ([xml]$plc.ProduceXml($false)).TreeItem.IECProjectDef.OnlineSettings
        if ($online.LoggedIn -eq 'true') { break }
        Start-Sleep -Milliseconds 500
      }
      Say @{ kind = 'online'; loggedIn = [string]$online.LoggedIn; app = [string]$online.PlcAppState; op = [string]$online.PlcOpState; error = $loginError }
      if ($online.LoggedIn -ne 'true') { Say @{ kind = 'done'; ok = $false; errors = 0; fatal = ('The download was not made, nothing was written' + $(if ($loginError) { ': ' + $loginError } else { ' (XAE did not log in to the PLC)' })) }; return }
      # (after a download the application waits: started)
      try { [KssPlcOnline]::Start($plc) } catch { }
      Start-Sleep -Seconds 1
      $online = ([xml]$plc.ProduceXml($false)).TreeItem.IECProjectDef.OnlineSettings
      $boot = ''
      try { Say @{ kind = 'step'; text = 'Updating the boot project' }; $script:sm.LookupTreeItem('TIPC^' + $r.plcProject).GenerateBootProject($true) } catch { $boot = $_.Exception.Message }
      try { [KssPlcOnline]::Logoff($plc) } catch { }
      if ($boot) { Say @{ kind = 'item'; level = 'warning'; text = ('The boot project was not updated (a restart brings the old code back): ' + $boot); file = ''; line = 0; column = 0; project = '' } }
      Say @{ kind = 'done'; ok = $true; errors = 0; written = 'download'; plcState = [string]$online.PlcAppState; loggedIn = 'true'; bootProject = ($boot -eq '') }
    } elseif ($r.write -eq 'activate') {
      $script:sm.ActivateConfiguration()
      $script:sm.StartRestartTwinCAT()
      Say @{ kind = 'done'; ok = $true; errors = 0; written = 'activate' }
    }
  } finally {
    $script:dte.SuppressUI = $false
  }
}
`;
}

/** A build request for Build-Kss (checked: the write mode) */
function xaeRequest({ dir, tsproj, plcProject, write = null, netId = '', changed = false }) {
  if (write && !MODES[write]) throw new Error(`Unknown write: ${write}`);
  return { dir, tsproj, plcProject, netId, write: write ?? null, writeText: write ? MODES[write] : '', changed: !!changed };
}

/**
 * One build as a script of its own: XAE started, the project opened, built (and written), XAE quit. The
 * KSS_BUILD_DRYRUN stand-in writes it for a look
 */
function buildScript({ dir, tsproj, plcProject, write = null, netId = '', progId = 'TcXaeShell.DTE.17.0' }) {
  const req = xaeRequest({ dir, tsproj, plcProject, write, netId });
  return `${xaeFunctions(progId)}
try {
  Start-Kss
  Build-Kss (${ps(JSON.stringify(req))} | ConvertFrom-Json)
} catch {
  Say @{ kind = 'done'; ok = $false; fatal = $_.Exception.Message }
} finally {
  Stop-Kss
}
`;
}

/**
 * XAE kept open between builds: this script reads one request per line on stdin (JSON: a build, or {"cmd":"quit"}),
 * answers each as a build does; XAE started with the first, quit at "quit" or when stdin closes
 */
function serverScript(progId = 'TcXaeShell.DTE.17.0') {
  return `${xaeFunctions(progId)}
try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $r = $line | ConvertFrom-Json
    if ($r.cmd -eq 'quit') { break }
    try {
      if (-not $script:dte) { Start-Kss }
      Build-Kss $r
    } catch {
      Say @{ kind = 'done'; ok = $false; fatal = $_.Exception.Message; broken = $true }
    }
  }
} finally {
  Stop-Kss
}
`;
}

/** The script's JSON lines, as they come: items, steps; the done line ends a build */
function lineReader(onMessage) {
  let rest = '';
  return (d) => {
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
      if (m.kind === 'online' && process.env.KSS_BUILD_DEBUG) console.log('online', JSON.stringify(m));
      onMessage(m);
    }
  };
}
const itemOf = (m) => ({ level: m.level, text: m.text, file: m.file, line: m.line, column: m.column, project: m.project });

/** Runs one build's script (JSON lines: progress as they come) → { ok, items, errors, fatal, written } */
function runScript(script, { dir, onStep, timeoutMs = 15 * 60 * 1000 }) {
  const file = path.join(dir, 'kss-build.ps1');
  // (UTF-8 with its BOM: Windows PowerShell 5.1 reads the file as such)
  fs.writeFileSync(file, '﻿' + script);
  if (dry()) return Promise.resolve({ ok: true, items: [], errors: 0, dry: file });
  // (the XAE this build starts, as the script reports it: stopped when the script cannot, a timeout)
  let mine = [];
  return new Promise((resolve) => {
    const items = [];
    let done = null;
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', file], { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error?.killed) for (const id of mine) try { process.kill(id); } catch { /* gone */ }
      if (done) return resolve({ ...done, items });
      if (error?.killed) return resolve({ ok: false, items, errors: items.filter((i) => i.level === 'error').length, fatal: `XAE did not finish in ${Math.round(timeoutMs / 60000)} minutes (a dialog waiting?): stopped, nothing written` });
      resolve({ ok: false, items, errors: items.filter((i) => i.level === 'error').length, fatal: (String(stderr).trim().split('\n')[0] || error?.message || 'XAE stopped').slice(0, 500) });
    });
    child.stdout.on('data', lineReader((m) => {
      if (m.kind === 'item') items.push(itemOf(m));
      else if (m.kind === 'step') onStep?.(m.text);
      else if (m.kind === 'done') done = m;
      else if (m.kind === 'xae') mine = (m.pids ?? []).map(Number);
    }));
  });
}

/** Minutes XAE stays open after a build (the next one skips opening the project); KSS_BUILD_KEEP_MINUTES */
const keepMinutes = () => {
  const v = Number(process.env.KSS_BUILD_KEEP_MINUTES);
  return Number.isFinite(v) && v >= 0 ? v : 10;
};

/**
 * XAE kept open: one PowerShell running serverScript, one build at a time (queued); quit after keepMinutes() idle,
 * when a build breaks it or times out, or with this process
 */
class XaeWorker {
  constructor(progId = 'TcXaeShell.DTE.17.0') {
    this.progId = progId;
    this.child = null;
    this.queue = Promise.resolve();
    this.idle = null;
    this.current = null;
    /** The project open in XAE (its .tsproj), as far as this side knows */
    this.openTsproj = null;
  }
  get running() {
    return !!this.child && this.child.exitCode === null;
  }
  start() {
    const file = path.join(os.tmpdir(), `kss-xae-server-${process.pid}.ps1`);
    fs.writeFileSync(file, '﻿' + serverScript(this.progId));
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', file], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    this.child = child;
    this.openTsproj = null;
    // (this process ends, the app quits: its XAE stopped with it; a script ended from outside cannot close it)
    if (!this.exitHook) {
      this.exitHook = () => this.stop(true);
      process.once('exit', this.exitHook);
    }
    this.mine = [];
    child.stdout.on('data', lineReader((m) => (m.kind === 'xae' ? (this.mine = (m.pids ?? []).map(Number)) : this.current?.(m))));
    child.on('exit', () => {
      if (this.child === child) {
        this.child = null;
        this.openTsproj = null;
      }
      this.current?.({ kind: 'done', ok: false, fatal: 'XAE stopped', broken: true });
    });
  }
  /** A build: the result when its done line comes; the request as xaeRequest makes it */
  /** Builds queued or running: this XAE is not closed for another project meanwhile */
  get busy() {
    return (this.pending ?? 0) > 0;
  }
  build(req, { onStep, timeoutMs = 15 * 60 * 1000 } = {}) {
    this.pending = (this.pending ?? 0) + 1;
    const run = () => new Promise((resolve) => {
      clearTimeout(this.idle);
      if (!this.running) this.start();
      const items = [];
      const timer = setTimeout(() => {
        this.stop(true);
        finish({ ok: false, fatal: `XAE did not finish in ${Math.round(timeoutMs / 60000)} minutes (a dialog waiting?): stopped, nothing written` });
      }, timeoutMs);
      const finish = (done) => {
        clearTimeout(timer);
        this.current = null;
        this.pending--;
        if (done.broken) this.stop(true);
        else this.openTsproj = req.tsproj;
        if (this.running) {
          this.until = Date.now() + keepMinutes() * 60000;
          this.idle = setTimeout(() => this.stop(false), keepMinutes() * 60000);
        }
        resolve({ ...done, items, errors: done.errors ?? items.filter((i) => i.level === 'error').length });
      };
      this.current = (m) => {
        if (m.kind === 'item') items.push(itemOf(m));
        else if (m.kind === 'step') onStep?.(m.text);
        else if (m.kind === 'done') finish(m);
      };
      this.child.stdin.write(`${JSON.stringify(req)}\n`);
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  /** Quit XAE (force: the process and this build's XAE stopped at once) */
  stop(force) {
    clearTimeout(this.idle);
    this.until = null;
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.openTsproj = null;
    if (!force) {
      try {
        child.stdin.end(`${JSON.stringify({ cmd: 'quit' })}\n`);
        return;
      } catch {
        // gone: stopped below
      }
    }
    try {
      child.kill();
    } catch {
      // gone
    }
    // (its own XAE only, as the script reported it)
    for (const id of this.mine ?? []) try { process.kill(id); } catch { /* gone */ }
  }
}
// One XAE per project (going back and forth between two projects keeps both open): at most KSS_BUILD_MAX_XAE
// (default 2, each XAE takes about 1 GB); for another one, the one used longest ago quits (not while it builds).
// Each worker keeps its work folder (ws: the project open in its XAE)
const maxXae = () => {
  const v = Number(process.env.KSS_BUILD_MAX_XAE);
  return Number.isInteger(v) && v >= 1 ? v : 2;
};
const workers = new Map();
const dropWorkspace = (w) => {
  if (w.ws) fs.rm(w.ws.dir, { recursive: true, force: true }, () => {});
  w.ws = null;
};
function xaeWorker(key) {
  let w = workers.get(key);
  if (w) {
    // (the most recently used last)
    workers.delete(key);
    workers.set(key, w);
    return w;
  }
  while (workers.size >= maxXae()) {
    const oldest = [...workers.entries()].find(([, x]) => !x.busy);
    if (!oldest) break;
    oldest[1].stop(false);
    dropWorkspace(oldest[1]);
    workers.delete(oldest[0]);
  }
  w = new XaeWorker();
  w.ws = null;
  workers.set(key, w);
  return w;
}
/** Until when this worker's XAE is kept open for the next build (ms since 1970), or null (not open) */
const openUntilOf = (w) => (w?.running && w.until ? w.until : null);
/** Until when an XAE is kept open for a next build (the latest), or null (none open) */
const xaeOpenUntil = () => Math.max(0, ...[...workers.values()].map((w) => openUntilOf(w) ?? 0)) || null;
/** The projects open in XAE now (their XAE kept open for the next build) */
const xaeOpenCount = () => [...workers.values()].filter((w) => w.running).length;
/** Close every XAE kept open now (the next build opens its project again); true when one was open */
function closeXae() {
  let open = false;
  for (const w of workers.values()) {
    open ||= w.running;
    w.stop(false);
    dropWorkspace(w);
  }
  workers.clear();
  return open;
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

/** TcXaeShell.exe: from its registered automation server (as Start-Kss finds it), or null */
function xaeExecutable(progId = 'TcXaeShell.DTE.17.0') {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const query = (key) => new Promise((resolve) => execFile('reg', ['query', key, '/ve'], { windowsHide: true }, (err, out) => resolve(err ? null : /REG_\w+\s+(.+)$/m.exec(String(out))?.[1]?.trim() ?? null)));
  return query(`HKCR\\${progId}\\CLSID`).then((clsid) => (clsid ? query(`HKCR\\CLSID\\${clsid}\\LocalServer32`) : null)).then((server) => {
    if (!server) return null;
    const exe = server.startsWith('"') ? server.slice(1, server.indexOf('"', 1)) : server.slice(0, server.toLowerCase().indexOf('.exe') + 4);
    return exe || null;
  });
}

/**
 * TwinCAT XAE opened for the user (a window of its own, as from the Start menu: theirs to use and close; its
 * license page renews a trial license). KSS_BUILD_DRYRUN: not started, said which. → { ok, message, dry? }
 */
async function openXae() {
  const exe = dry() ? 'C:\\TwinCAT\\3.1\\Components\\TcXaeShell\\Common7\\IDE\\TcXaeShell.exe' : await xaeExecutable();
  if (!exe) return { ok: false, message: 'TwinCAT XAE is not installed on this computer' };
  if (dry()) return { ok: true, dry: exe, message: 'TwinCAT XAE is starting' };
  try {
    require('child_process').spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, message: 'TwinCAT XAE is starting' };
  } catch (err) {
    return { ok: false, message: `Could not start TwinCAT XAE: ${err.message}` };
  }
}

/** The archives' fingerprint: the same, the work folder already open in XAE can be used again */
function archivesHash(archives) {
  const h = require('crypto').createHash('sha1');
  h.update(archives.system);
  for (const n of archives.nested) h.update(`|${n.name}|`).update(n.data ?? '');
  return h.digest('hex');
}

/**
 * The work folder of the last build, used again (its project open in XAE): the files an earlier build put in and
 * this one does not, back as the PLC has them; this build's edits put in. true when a file changed
 */
function reuseWorkspace(ws, edits) {
  let changed = false;
  const want = new Map();
  for (const e of edits) {
    const plc = ws.plcProjects.find((p) => p.name.toLowerCase() === String(e.plcProject ?? '').toLowerCase()) ?? (ws.plcProjects.length === 1 ? ws.plcProjects[0] : null);
    if (!plc) throw new Error(`No PLC project ${e.plcProject} in the PLC's TwinCAT project`);
    const p = inside(plc.dir, e.path);
    if (!ws.originals.has(p)) {
      if (!fs.existsSync(p)) throw new Error(`${e.path} is not in ${plc.name}`);
      ws.originals.set(p, fs.readFileSync(p));
    }
    want.set(p, Buffer.from(String(e.content).replace(/\r?\n/g, '\r\n'), 'utf8'));
  }
  for (const [p, original] of ws.originals) {
    const next = want.get(p) ?? original;
    if (!fs.readFileSync(p).equals(next)) {
      fs.writeFileSync(p, next);
      changed = true;
    }
  }
  ws.applied = edits.map((e) => `${e.plcProject ?? ws.plcProjects[0]?.name}/${e.path}`);
  return changed;
}

/**
 * After a write: is the PLC application back in Run (a download starts it within seconds; activating restarts TwinCAT
 * first)? Not in Run: a warning that says so, and why when its trial license ran out. → { state, ok }
 * KSS_BUILD_RUN_WAIT_MS: how long to wait (the tests)
 */
async function afterWrite(client, written, items, onStep) {
  onStep?.('Waiting for the PLC to run');
  const timeoutMs = Number(process.env.KSS_BUILD_RUN_WAIT_MS) || (written === 'activate' ? 45000 : 20000);
  const run = await waitForRun(client, { timeoutMs });
  if (!run.ok) {
    const lic = licenseState(await readTrialLicense(client).catch(() => null));
    const why = lic?.state === 'expired' ? ` ${lic.text}` : '';
    items.push({ level: 'warning', text: `After the ${MODES[written].toLowerCase()} the PLC is ${run.state ? `in ${run.state}` : 'not answering'}, not in Run: start it from XAE (PLC > Start), or look at TwinCAT's messages on the target.${why}`, file: '', line: 0, column: 0, project: '', place: null });
  }
  return { state: run.state, ok: run.ok };
}

/**
 * Build (and write back): read the project from the PLC (client: its ADS connection), put the edits in, build with
 * XAE (kept open for the next build: the same PLC's project, unchanged on the PLC, is not opened again). write: null
 * (build only), 'online', 'activate'. → { ok, items: [{ level, text, file, line, place }], ... }
 */
async function buildFromPlc(client, { edits = [], plcProject = '', write = null, netId = '', adsPort = 851, onStep } = {}) {
  if (!(await xaeAvailable())) return { ok: false, fatal: 'TwinCAT XAE is not installed on this computer: its Automation Interface builds the project (TcXaeShell)', items: [] };
  // A write that starts the application again (download, activate) on a trial license that ran out would leave the
  // PLC stopped: refused before anything is built; one running out soon: said
  let licenseNote = null;
  if (write) {
    const lic = licenseState(await readTrialLicense(client).catch(() => null));
    if (lic?.state === 'expired' && write !== 'online') return { ok: false, fatal: `Nothing was written: ${lic.text}`, items: [], license: lic };
    if (lic && lic.state !== 'ok') licenseNote = lic;
  }
  onStep?.('Reading the project from the PLC');
  const archives = await fetchProjectArchives((rel) => readBootFile(client, rel));
  const key = `${netId}|${archives.info?.project?.name ?? ''}`;
  const hash = archivesHash(archives);
  const w = xaeWorker(`plc|${key}`);
  let ws;
  let changed = false;
  if (!dry() && w.ws && w.ws.hash === hash && w.running && w.openTsproj === w.ws.tsproj && fs.existsSync(w.ws.tsproj)) {
    ws = w.ws;
    changed = reuseWorkspace(ws, edits);
  } else {
    // (another project, or the PLC's changed: a new folder; the old one removed once XAE has closed it)
    ws = writeWorkspace(archives, edits);
    ws.originals = new Map();
    for (const a of ws.applied) {
      const [plcName, ...rest] = a.split('/');
      const plc = ws.plcProjects.find((p) => p.name === plcName);
      const n = archives.nested.find((x) => x.name === plcName);
      const orig = n?.data ? unzip(n.data, (p) => p === rest.join('/'))[0] : null;
      if (plc && orig) ws.originals.set(inside(plc.dir, rest.join('/')), orig.data);
    }
    Object.assign(ws, { key, hash });
  }
  const plc = ws.plcProjects.find((p) => p.name.toLowerCase() === plcProject.toLowerCase()) ?? ws.plcProjects[0];
  if (!plc) return { ok: false, fatal: 'The PLC\'s TwinCAT project has no PLC project', items: [] };
  let r;
  if (dry()) r = standInBuild(ws, edits, write);
  else {
    const previous = w.ws;
    r = await w.build(xaeRequest({ dir: ws.dir, tsproj: ws.tsproj, plcProject: plc.name, write, netId, changed }), { onStep });
    w.ws = w.running ? ws : null;
    for (const old of [previous, ...(w.running ? [] : [ws])]) {
      if (old && old !== w.ws) fs.rm(old.dir, { recursive: true, force: true }, () => {});
    }
  }
  const items = (r.items ?? []).map((i) => ({ ...i, place: placeOf(i, ws) }));
  if (dry()) fs.rm(ws.dir, { recursive: true, force: true }, () => {});
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
    // (the PLC's archive changed with the write: its project opened afresh next time, this folder then removed)
    if (w.ws) w.ws.hash = '';
  }
  const plcRun = r.ok && r.written ? await afterWrite(client, r.written, items, onStep) : undefined;
  // (XAE kept open for the next build: until when; the stand-in says as a real build would)
  const openUntil = dry() ? Date.now() + keepMinutes() * 60000 : openUntilOf(w);
  if (licenseNote) items.unshift({ level: 'warning', text: licenseNote.text, file: '', line: 0, column: 0, project: '', place: null });
  const result = { ...r, items, plcProject: plc.name, applied: ws.applied, workspace: dry() ? ws.dir : undefined, ...(verified ? { verified } : {}), ...(plcRun ? { plcRun } : {}), ...(openUntil ? { xaeOpenUntil: openUntil, xaeOpenProjects: dry() ? 1 : xaeOpenCount() } : {}) };
  delete result.broken;
  return result;
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
  if (errors === 0 && write === 'online' && process.env.KSS_BUILD_REFUSE_ONLINE === '1') {
    return { ok: false, items, errors: 0, warnings: 1, dry: script, fatal: 'No online change was made, nothing was written (XAE did not log in to the PLC). TwinCAT did not make the online change through the Automation Interface (it logs in only when it can compute one). Download writes it (the PLC application stops and starts again).' };
  }
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
  if (req?.write != null && !Object.hasOwn(MODES, req.write)) return 'write: online, download or activate';
  return null;
}


// ---- From the engineering project on this computer (the desktop app: a POU opened from a TwinCAT project) ----
// Its compile information is the running code's when this project made the last download: then TwinCAT can compute
// an online change (a copy of the PLC's archive cannot). Built from a copy (the project folder is left as it is),
// the edits put in; after a write the new compile information is copied back, so XAE's next login still matches.

/** The folder holding the .tsproj above this file (up to 8 levels), or null */
function projectRootOf(file) {
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 8; i++) {
    try {
      if (fs.readdirSync(dir).some((f) => /\.tsproj$/i.test(f))) return dir;
    } catch {
      return null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

const SKIP_DIRS = new Set(['.vs', '.git', '_Boot', 'xae-settings']);
/** src copied onto dst, file by file where size or time differ (the rest left: XAE reloads only what changed) */
function syncTree(src, dst) {
  let changed = 0;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const a = path.join(src, e.name);
    const b = path.join(dst, e.name);
    if (e.isDirectory()) changed += syncTree(a, b);
    else if (e.isFile()) {
      const sa = fs.statSync(a);
      let sb = null;
      try {
        sb = fs.statSync(b);
      } catch {
        // new
      }
      if (!sb || sb.size !== sa.size || Math.abs(sb.mtimeMs - sa.mtimeMs) > 1) {
        fs.copyFileSync(a, b);
        fs.utimesSync(b, sa.atime, sa.mtime);
        changed++;
      }
    }
  }
  return changed;
}

/** The PLC projects of a project folder (their .plcproj): [{ name, dir, plcproj }] */
function plcProjectsIn(root, depth = 0, out = []) {
  if (depth > 4) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) plcProjectsIn(p, depth + 1, out);
    else if (/\.plcproj$/i.test(e.name)) out.push({ name: e.name.replace(/\.plcproj$/i, ''), dir: root, plcproj: p });
  }
  return out;
}

/**
 * Build (and write back) from the TwinCAT project on this computer: file (a POU of it) finds the project; edits:
 * [{ file: its full path, content }] put into the copy. write: null, 'online', 'download', 'activate'. →
 * { ok, items, ..., compileInfoCopied, compileInfoFiles: their paths in the project, plcRun }
 */
async function buildFromProject(client, { file, edits = [], plcProject = '', write = null, netId = '', adsPort = 851, syncCompileInfo = true, onStep } = {}) {
  if (!(await xaeAvailable())) return { ok: false, fatal: 'TwinCAT XAE is not installed on this computer: its Automation Interface builds the project (TcXaeShell)', items: [] };
  const root = file ? projectRootOf(file) : null;
  if (!root) return { ok: false, fatal: 'This POU is not in a TwinCAT project folder (no .tsproj above it)', items: [] };
  let licenseNote = null;
  if (write && client) {
    const lic = licenseState(await readTrialLicense(client).catch(() => null));
    if (lic?.state === 'expired' && write !== 'online') return { ok: false, fatal: `Nothing was written: ${lic.text}`, items: [], license: lic };
    if (lic && lic.state !== 'ok') licenseNote = lic;
  }
  const w = xaeWorker(`project|${root.toLowerCase()}`);
  onStep?.('Copying the project');
  // (the same project, its copy still open in XAE: only the changed files copied again)
  let ws;
  let changed = false;
  if (!dry() && w.ws && w.ws.root === root && w.running && w.openTsproj === w.ws.tsproj) {
    ws = w.ws;
    changed = syncTree(root, ws.dir) > 0;
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-project-'));
    syncTree(root, dir);
    const tsproj = fs.readdirSync(dir).find((f) => /\.tsproj$/i.test(f));
    ws = { root, dir, tsproj: path.join(dir, tsproj), plcProjects: plcProjectsIn(dir) };
  }
  // The POUs edited here (not saved yet, or saved: the same), into the copy
  const applied = [];
  for (const e of edits) {
    const rel = path.relative(root, path.resolve(String(e.file ?? '')));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.(TcPOU|TcDUT|TcGVL|TcIO)$/i.test(rel)) return { ok: false, fatal: `Not a source of this project: ${e.file}`, items: [] };
    const p = path.join(ws.dir, rel);
    const next = Buffer.from(String(e.content).replace(/\r?\n/g, '\r\n'), 'utf8');
    if (!fs.existsSync(p) || !fs.readFileSync(p).equals(next)) {
      fs.writeFileSync(p, next);
      changed = true;
    }
    applied.push(rel.replace(/\\/g, '/'));
  }
  const plc = ws.plcProjects.find((p) => p.name.toLowerCase() === plcProject.toLowerCase()) ?? ws.plcProjects[0];
  if (!plc) return { ok: false, fatal: 'The project has no PLC project (.plcproj)', items: [] };
  let r;
  if (dry()) r = standInBuild(ws, edits.map((e) => ({ plcProject: plc.name, path: path.relative(path.join(root, path.relative(ws.dir, plc.dir)), path.resolve(e.file)).replace(/\\/g, '/'), content: e.content })), write);
  else {
    const previous = w.ws;
    r = await w.build(xaeRequest({ dir: ws.dir, tsproj: ws.tsproj, plcProject: plc.name, write, netId, changed }), { onStep });
    w.ws = w.running ? ws : null;
    for (const old of [previous, ...(w.running ? [] : [ws])]) {
      if (old && old !== w.ws) fs.rm(old.dir, { recursive: true, force: true }, () => {});
    }
  }
  const items = (r.items ?? []).map((i) => ({ ...i, place: placeOf(i, ws) }));
  if (licenseNote) items.unshift({ level: 'warning', text: licenseNote.text, file: '', line: 0, column: 0, project: '', place: null });
  // Written: the new compile information into the project (XAE's next login matches the running code)
  let compileInfoCopied = 0;
  const compileInfoFiles = [];
  // (the stand-in: compile information as a build that wrote makes it)
  if (dry() && r.ok && r.written) {
    fs.mkdirSync(path.join(plc.dir, '_CompileInfo'), { recursive: true });
    fs.writeFileSync(path.join(plc.dir, '_CompileInfo', `StandIn-${Date.now()}.compileinfo`), 'stand-in');
  }
  if (r.ok && r.written && syncCompileInfo) {
    for (const p of ws.plcProjects) {
      const from = path.join(p.dir, '_CompileInfo');
      const to = path.join(root, path.relative(ws.dir, p.dir), '_CompileInfo');
      try {
        fs.mkdirSync(to, { recursive: true });
        for (const f of fs.readdirSync(from).filter((x) => /\.compileinfo$/i.test(x))) {
          if (!fs.existsSync(path.join(to, f))) {
            fs.copyFileSync(path.join(from, f), path.join(to, f));
            compileInfoCopied++;
            compileInfoFiles.push(path.relative(root, path.join(to, f)).replace(/\\/g, '/'));
          }
        }
      } catch {
        // (no compile information there)
      }
    }
  }
  const plcRun = r.ok && r.written && client ? await afterWrite(client, r.written, items, onStep) : undefined;
  const openUntil = dry() ? Date.now() + keepMinutes() * 60000 : openUntilOf(w);
  const result = { ...r, items, plcProject: plc.name, applied, project: path.basename(ws.tsproj, '.tsproj'), compileInfoCopied, compileInfoFiles, ...(plcRun ? { plcRun } : {}), ...(openUntil ? { xaeOpenUntil: openUntil, xaeOpenProjects: dry() ? 1 : xaeOpenCount() } : {}) };
  delete result.broken;
  if (dry()) fs.rm(ws.dir, { recursive: true, force: true }, () => {});
  return result;
}

module.exports = { fetchProjectArchives, writeWorkspace, buildScript, serverScript, xaeRequest, runScript, placeOf, xaeAvailable, buildFromPlc, checkEdits, reuseWorkspace, archivesHash, XaeWorker, MODES, xaeOpenUntil, xaeOpenCount, xaeWorker, closeXae, openXae, xaeExecutable, buildFromProject, projectRootOf, syncTree };
