# Window helpers for the test IDE instances: list top-level windows of a process, read a dialog's texts, click a button
if (-not ('WinH' -as [type])) {
Add-Type @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class WinH {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  static string Text(IntPtr h) { var t = new StringBuilder(2048); GetWindowText(h, t, 2048); return t.ToString(); }
  static string Cls(IntPtr h) { var c = new StringBuilder(256); GetClassName(h, c, 256); return c.ToString(); }
  public static List<IntPtr> Dialogs(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && Cls(h) == "#32770") r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static List<string> Describe(IntPtr dialog) {
    var r = new List<string> { "dialog '" + Text(dialog) + "'" };
    EnumChildWindows(dialog, (h, l) => { var t = Text(h); if (t.Length > 0) r.Add("  [" + Cls(h) + "] " + t.Replace("\r", " ").Replace("\n", " ")); return true; }, IntPtr.Zero);
    return r;
  }
  public static bool ClickButton(IntPtr dialog, string caption) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dialog, (h, l) => { if (Cls(h) == "Button" && Text(h).Replace("&", "") == caption) { found = h; return false; } return true; }, IntPtr.Zero);
    if (found == IntPtr.Zero) return false;
    SendMessage(found, 0x00F5, IntPtr.Zero, IntPtr.Zero);
    return true;
  }
}
'@
}
