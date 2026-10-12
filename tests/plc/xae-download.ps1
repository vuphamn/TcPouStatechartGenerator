param([string]$Sln, [string]$Dll)
# The XAE extension's Download and start (its PlcDownload, from its own DLL: the code its tool window runs after Activate)
# against this computer's PLC: a hidden TcXaeShell (its own instance) opens the real-PLC check's solution, its PLC
# projects are downloaded and started; XAE quit. Prints "done <names>" (tests/plc/real-plc.test.cjs).
$ErrorActionPreference = 'Stop'
# (COM calls XAE rejects while busy: retried by a message filter)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[ComImport, Guid("00000016-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IOleMessageFilter {
  [PreserveSig] int HandleInComingCall(int t, IntPtr h, int e, IntPtr i);
  [PreserveSig] int RetryRejectedCall(IntPtr h, int e, int r);
  [PreserveSig] int MessagePending(IntPtr h, int e, int p);
}
public class KssFilter : IOleMessageFilter {
  [DllImport("Ole32.dll")] static extern int CoRegisterMessageFilter(IOleMessageFilter n, out IOleMessageFilter o);
  public static void Register() { IOleMessageFilter o; CoRegisterMessageFilter(new KssFilter(), out o); }
  public int HandleInComingCall(int t, IntPtr h, int e, IntPtr i) { return 0; }
  public int RetryRejectedCall(IntPtr h, int e, int r) { return r == 2 ? 200 : -1; }
  public int MessagePending(IntPtr h, int e, int p) { return 2; }
}
"@
[KssFilter]::Register()
# (TwinCAT's automation interfaces, as XAE has them loaded; then the extension's code)
$tcsm = [Reflection.Assembly]::LoadWithPartialName('TCatSysManagerLib')
if (-not $tcsm) { throw 'The automation assembly of TwinCAT XAE (TCatSysManagerLib) is not installed' }
[void][Reflection.Assembly]::LoadWithPartialName('Microsoft.CSharp')
[void][Reflection.Assembly]::LoadFrom($Dll)
$dte = New-Object -ComObject 'TcXaeShell.DTE.17.0'
try {
  Start-Sleep -Seconds 3
  $dte.SuppressUI = $true
  $dte.MainWindow.Visible = $false
  $dte.Solution.Open($Sln)
  Start-Sleep -Seconds 5
  $proj = $null
  foreach ($p in $dte.Solution.Projects) { if ($p.FullName -like '*.tsproj') { $proj = $p; break } }
  if (-not $proj) { throw "No TwinCAT project in $Sln" }
  $names = [KvalMachineScope.Xae.PlcDownload]::PlcProjectNames($proj.FullName)
  $log = [Action[string]] { param($m) [Console]::WriteLine("log $m") }
  $done = [KvalMachineScope.Xae.PlcDownload]::Run($proj.Object, $names, $log)
  "done $($done -join ',')"
} finally {
  try { $dte.Quit() } catch { }
}
