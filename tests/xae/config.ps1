# Settings of the XAE tests (dot-sourced by the scripts here). Set them as environment variables:
#   KSS_XAE_SOURCE     the TwinCAT project folder to test on (read only: it is copied, never changed)
#   KSS_XAE_SOLUTION   the .sln, relative to that folder (default: the first *.sln in it)
#   KSS_XAE_POU        the .TcPOU to open, relative to that folder (default: the first SM_TableManager.TcPOU)
#   KSS_XAE_OTHER_POU  another POU's name, for the second tab (default: SM_KAxis)
#   KSS_XAE_COPY       where the copy goes (default: %TEMP%\kss)
#   KSS_VS_IDE         Visual Studio's IDE folder (default: VS 2022 Community)
$XaeRepo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$XaeSource = $env:KSS_XAE_SOURCE
if (-not $XaeSource -or -not (Test-Path $XaeSource)) { throw 'Set KSS_XAE_SOURCE to the TwinCAT project folder to test on (it is copied, not changed)' }
$XaeCopy = if ($env:KSS_XAE_COPY) { $env:KSS_XAE_COPY } else { Join-Path $env:TEMP 'kss' }
$XaeSolution = if ($env:KSS_XAE_SOLUTION) { $env:KSS_XAE_SOLUTION } else { (Get-ChildItem $XaeSource -Filter *.sln | Select-Object -First 1).Name }
$XaePou = if ($env:KSS_XAE_POU) { $env:KSS_XAE_POU } else {
  $hit = Get-ChildItem $XaeSource -Recurse -Filter SM_TableManager.TcPOU -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $hit) { throw 'Set KSS_XAE_POU to the .TcPOU to open (relative to KSS_XAE_SOURCE)' }
  $hit.FullName.Substring($XaeSource.TrimEnd('\').Length + 1)
}
$XaePouName = [IO.Path]::GetFileNameWithoutExtension($XaePou)
$XaeOtherPou = if ($env:KSS_XAE_OTHER_POU) { $env:KSS_XAE_OTHER_POU } else { 'SM_KAxis' }
$XaeIde = if ($env:KSS_VS_IDE) { $env:KSS_VS_IDE } else { 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE' }
$XaeVsix = Join-Path $XaeRepo 'xae-extension\KvalStateScope.Xae\bin\Release\KvalStateScope.Xae.vsix'
$XaeLog = Join-Path $env:LOCALAPPDATA 'KvalStateScope\log.txt'
# The experimental instance this folder started (the user's own IDEs are never touched)
$XaePidFile = Join-Path $PSScriptRoot '..\.output\xae-exp-pid.txt'
New-Item -ItemType Directory -Force (Split-Path $XaePidFile) | Out-Null
