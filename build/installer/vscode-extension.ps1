<#
.SYNOPSIS
  Kval MachineScope desktop installer: installs or removes the VS Code extension (Open in Kval MachineScope on a
  .TcPOU's right-click menu in VS Code's Explorer).

.DESCRIPTION
  Finds VS Code (this user's installation, the one for all users, VS Code Insiders, or a "code" command on the PATH)
  and runs its command line: code --install-extension <vsix> --force (the same version again replaces it: a newer
  build keeps the version number), or --uninstall-extension. The extension goes to this user's VS Code profile
  (%USERPROFILE%\.vscode\extensions); a running VS Code picks it up after "Reload Window" or a restart.
  Exit codes: 0 done, 1 failed, 3 no VS Code found. -Action Detect prints the editions found (one line, comma
  separated).
#>
param(
  [ValidateSet('Detect', 'Install', 'Uninstall')][string]$Action = 'Detect',
  [string]$Vsix
)
$ErrorActionPreference = 'Stop'
$extensionId = 'kval.kval-machinescope-vscode'

# The editions found: their name and command line (code.cmd), each once
function Get-Editions {
  $found = [ordered]@{}
  $candidates = @(
    @{ name = 'VS Code'; cmd = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd' },
    @{ name = 'VS Code'; cmd = Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd' },
    @{ name = 'VS Code'; cmd = Join-Path ${env:ProgramFiles(x86)} 'Microsoft VS Code\bin\code.cmd' },
    @{ name = 'VS Code Insiders'; cmd = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd' },
    @{ name = 'VS Code Insiders'; cmd = Join-Path $env:ProgramFiles 'Microsoft VS Code Insiders\bin\code-insiders.cmd' }
  )
  # (on the PATH: a portable or other installation)
  $onPath = Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($onPath) { $candidates += @{ name = 'VS Code'; cmd = $onPath.Source } }
  foreach ($c in $candidates) {
    if (-not $c.cmd -or -not (Test-Path $c.cmd)) { continue }
    # (one per edition: the first found, this user's before all users')
    if (-not $found.Contains($c.name)) { $found[$c.name] = $c.cmd }
  }
  return $found
}

$editions = Get-Editions
if ($editions.Count -eq 0) {
  if ($Action -eq 'Detect') { Write-Output '' }
  exit 3
}
if ($Action -eq 'Detect') {
  Write-Output ($editions.Keys -join ', ')
  exit 0
}
if ($Action -eq 'Install' -and (-not $Vsix -or -not (Test-Path $Vsix))) { Write-Output "VSIX not found: $Vsix"; exit 1 }

$failed = 0
foreach ($name in $editions.Keys) {
  $cmd = $editions[$name]
  $arguments = if ($Action -eq 'Install') { @('--install-extension', $Vsix, '--force') } else { @('--uninstall-extension', $extensionId) }
  # (code.cmd prints what it did; its exit code tells. Its warnings on stderr are no failure: not stopped on)
  $ErrorActionPreference = 'Continue'
  $out = & $cmd @arguments 2>&1 | Out-String
  $ErrorActionPreference = 'Stop'
  $code = $LASTEXITCODE
  Write-Output "$name ($cmd): $($out.Trim())"
  # (uninstall: "not installed" is no failure)
  if ($code -ne 0 -and -not ($Action -eq 'Uninstall' -and $out -match 'not installed')) { $failed++ }
}
if ($failed) { Write-Output "$Action failed for $failed of $($editions.Count) edition(s)"; exit 1 }
Write-Output "$Action done for $($editions.Keys -join ', ')"
exit 0
