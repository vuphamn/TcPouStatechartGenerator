<#
.SYNOPSIS
  Captures a window (or the primary screen) as PNG frames, the mouse pointer drawn in: for the README's demo clips
  that need a real screen (the XAE edition in TcXaeShell, the installer). scripts/record-screen.cjs runs it and writes
  the GIF.

.DESCRIPTION
  The window: the first visible top-level window whose title contains -Title, or the main window of -Process; neither:
  the primary screen. Its place and size are taken once, at the start (keep it where it is while recording). Each
  frame is scaled to at most -MaxWidth pixels wide and saved as <ms since the start>.png in -Out. It stops after
  -Seconds, or when the file <Out>\stop exists (record-screen.cjs writes it when Enter is pressed).
#>
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Title = '',
  [string]$Process = '',
  [double]$Seconds = 30,
  [int]$Fps = 8,
  [int]$MaxWidth = 960
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class KmsWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static IntPtr Find(string part) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.Length > 0 && sb.ToString().IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static RECT Bounds(IntPtr h) {
    RECT r;
    // (the window as drawn, without its invisible resize border)
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
}
'@
[void][KmsWin]::SetProcessDPIAware()
if ([bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)) { throw 'The screen is locked: unlock it to record' }

$hwnd = [IntPtr]::Zero
if ($Title) { $hwnd = [KmsWin]::Find($Title); if ($hwnd -eq [IntPtr]::Zero) { throw "No visible window titled *$Title*" } }
elseif ($Process) {
  $p = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if (-not $p) { throw "No window of $Process" }
  $hwnd = $p.MainWindowHandle
}
if ($hwnd -ne [IntPtr]::Zero) {
  $r = [KmsWin]::Bounds($hwnd)
  $area = New-Object System.Drawing.Rectangle($r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
} else {
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}
if ($area.Width -lt 50 -or $area.Height -lt 50) { throw "The window is too small or minimized ($($area.Width)x$($area.Height))" }
$scale = [Math]::Min(1.0, $MaxWidth / $area.Width)
$w = [int][Math]::Round($area.Width * $scale)
$h = [int][Math]::Round($area.Height * $scale)
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Write-Host "Recording $($area.Width)x$($area.Height) at $($area.X),$($area.Y) -> ${w}x${h}, $Fps fps, up to $Seconds s"

$full = New-Object System.Drawing.Bitmap($area.Width, $area.Height)
$g = [System.Drawing.Graphics]::FromImage($full)
$small = New-Object System.Drawing.Bitmap($w, $h)
$gs = [System.Drawing.Graphics]::FromImage($small)
$gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$cursor = [System.Windows.Forms.Cursors]::Default
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$stop = Join-Path $Out 'stop'
$frames = 0
while ($clock.Elapsed.TotalSeconds -lt $Seconds -and -not (Test-Path $stop)) {
  $t = $clock.ElapsedMilliseconds
  $g.CopyFromScreen($area.Location, [System.Drawing.Point]::Empty, $area.Size)
  # (the pointer: CopyFromScreen leaves it out)
  $pos = [System.Windows.Forms.Cursor]::Position
  if ($area.Contains($pos)) { $cursor.Draw($g, (New-Object System.Drawing.Rectangle(($pos.X - $area.X), ($pos.Y - $area.Y), 32, 32))) }
  $gs.DrawImage($full, 0, 0, $w, $h)
  $small.Save((Join-Path $Out ('{0:D8}.png' -f $t)), [System.Drawing.Imaging.ImageFormat]::Png)
  $frames++
  $wait = [int](1000 / $Fps - ($clock.ElapsedMilliseconds - $t))
  if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
}
Write-Host "$frames frames"
