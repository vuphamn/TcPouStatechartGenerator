# Helpers to drive a running Visual Studio instance through its DTE automation object (found in the ROT by PID)
param([int]$ProcessId)
if (-not ('RotHelper' -as [type])) {
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class RotHelper {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable rot);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx ctx);
  public static object GetDte(int pid) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot);
    IEnumMoniker e; rot.EnumRunning(out e);
    IMoniker[] m = new IMoniker[1];
    while (e.Next(1, m, IntPtr.Zero) == 0) {
      IBindCtx ctx; CreateBindCtx(0, out ctx);
      string name; m[0].GetDisplayName(ctx, null, out name);
      if (name.StartsWith("!VisualStudio.DTE.") && name.EndsWith(":" + pid)) { object o; rot.GetObject(m[0], out o); return o; }
    }
    return null;
  }
}
'@
}
$script:dte = [RotHelper]::GetDte($ProcessId)
if (-not $script:dte) { throw "DTE for pid $ProcessId not found" }
