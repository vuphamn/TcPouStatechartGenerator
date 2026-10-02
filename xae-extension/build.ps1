# Builds the Kval MachineScope extension for TwinCAT XAE (TcXaeShell 64-bit, Visual Studio 2022 / 2026), and its build
# for TwinCAT 4024's TcXaeShell (the 32-bit Visual Studio 2017 shell) and Visual Studio 2017 / 2019 (not yet tested).
# Output: xae-extension\KvalMachineScope.Xae\bin\<Configuration>\KvalMachineScope.Xae.vsix,
#         xae-extension\KvalMachineScope.Xae.Vs2017\bin\<Configuration>\KvalMachineScope.Xae.Vs2017.vsix
param([string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $PSScriptRoot 'KvalMachineScope.Xae\KvalMachineScope.Xae.csproj'
$appDir = Join-Path $PSScriptRoot 'KvalMachineScope.Xae\MachineScopeApp'

# 1. Web app -> dist/
Push-Location $repo
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
} finally { Pop-Location }

# 2. dist/ -> MachineScopeApp/ (packaged into the VSIX)
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
Copy-Item (Join-Path $repo 'dist') $appDir -Recurse

# 3. VSIX (MSBuild from the newest Visual Studio; the VSSDK build tools come from NuGet)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msbuild = & $vswhere -latest -prerelease -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild) { throw 'MSBuild not found (install Visual Studio 2022 or newer)' }
# Rebuild: an incremental build can keep a stale extension.vsixmanifest (e.g. an old version number)
& $msbuild $project /restore /t:Rebuild /p:Configuration=$Configuration /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw 'MSBuild failed' }

$vsix = Join-Path $PSScriptRoot "KvalMachineScope.Xae\bin\$Configuration\KvalMachineScope.Xae.vsix"
Write-Host "Built $vsix"

# 4. The same sources for the Visual Studio 2017 shell (its own SDK; WebView2 shipped in it)
$project2017 = Join-Path $PSScriptRoot 'KvalMachineScope.Xae.Vs2017\KvalMachineScope.Xae.Vs2017.csproj'
& $msbuild $project2017 /restore /t:Rebuild /p:Configuration=$Configuration /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw 'MSBuild failed (the Visual Studio 2017 build)' }
Write-Host "Built $(Join-Path $PSScriptRoot "KvalMachineScope.Xae.Vs2017\bin\$Configuration\KvalMachineScope.Xae.Vs2017.vsix")"
