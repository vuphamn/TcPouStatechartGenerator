# Builds the Kval StateScope extension for TwinCAT XAE (TcXaeShell 64-bit, Visual Studio 2022 / 2026).
# Output: xae-extension\KvalStateScope.Xae\bin\<Configuration>\KvalStateScope.Xae.vsix
param([string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$project = Join-Path $PSScriptRoot 'KvalStateScope.Xae\KvalStateScope.Xae.csproj'
$appDir = Join-Path $PSScriptRoot 'KvalStateScope.Xae\StateScopeApp'

# 1. Web app -> dist/
Push-Location $repo
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
} finally { Pop-Location }

# 2. dist/ -> StateScopeApp/ (packaged into the VSIX)
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
Copy-Item (Join-Path $repo 'dist') $appDir -Recurse

# 3. VSIX (MSBuild from the newest Visual Studio; the VSSDK build tools come from NuGet)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msbuild = & $vswhere -latest -prerelease -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild) { throw 'MSBuild not found (install Visual Studio 2022 or newer)' }
& $msbuild $project /restore /p:Configuration=$Configuration /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { throw 'MSBuild failed' }

$vsix = Join-Path $PSScriptRoot "KvalStateScope.Xae\bin\$Configuration\KvalStateScope.Xae.vsix"
Write-Host "Built $vsix"
