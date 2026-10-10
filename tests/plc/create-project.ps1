param([string]$Dir)
# A new TwinCAT project made by a hidden TcXaeShell (its own instance): TwinCAT's project template, a PLC project from
# the Standard PLC Template (MAIN, PlcTask); saved, XAE quit. For the real-PLC check of the VS Code extension.
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
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$dte = New-Object -ComObject 'TcXaeShell.DTE.17.0'
try {
  Start-Sleep -Seconds 3
  $dte.SuppressUI = $true
  $dte.MainWindow.Visible = $false
  $sln = $dte.Solution
  $sln.Create($Dir, 'KssLocalTest')
  $template = 'C:\Program Files (x86)\Beckhoff\TwinCAT\3.1\Components\Base\PrjTemplate\TwinCAT Project.tsproj'
  $proj = $sln.AddFromTemplate($template, (Join-Path $Dir 'KssLocalTest'), 'KssLocalTest')
  $sm = $proj.Object
  $plcs = $sm.LookupTreeItem('TIPC')
  $null = $plcs.CreateChild('KssPlc', 0, '', 'Standard PLC Template.plcproj')
  $dte.ExecuteCommand('File.SaveAll')
  $sln.SaveAs((Join-Path $Dir 'KssLocalTest.sln'))
  'created'
} finally {
  try { $dte.Quit() } catch { }
}
