@echo off
rem Builds everything the Desktop installer ships, then the installer itself:
rem   1. the TwinCAT XAE extension (VSIX for Visual Studio 2022 / 2026 and TcXaeShell), which also builds the web app
rem   2. Kval StateScope Link and the gateway (the web edition's live view helpers), staged for the installer
rem   3. the Desktop installer and portable exe (release\Kval StateScope Setup <version>.exe)
rem
rem   build.cmd            everything
rem   build.cmd noxae      keep the existing VSIX (a PC without Visual Studio's build tools)
rem
rem Needs Node.js 20+ and npm; for the extension, Visual Studio 2022 / 2026 with the extension development workload.
setlocal
cd /d "%~dp0"
rem VS Code terminals set this, which makes Electron tools run as plain Node
set ELECTRON_RUN_AS_NODE=

where node >nul 2>&1 || (echo Node.js 20 or later is needed: https://nodejs.org & exit /b 1)
if not exist node_modules (
  echo === Installing the dependencies
  call npm install || exit /b 1
)

if /i "%~1"=="noxae" (
  echo === Skipping the XAE extension: using the existing VSIX
  echo === [1/3] Web app
  call npm run build || exit /b 1
) else (
  echo === [1/3] TwinCAT XAE extension ^(and the web app^)
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0xae-extension\build.ps1" || exit /b 1
)

echo === [2/3] Kval StateScope Link, gateway and the installer's components
node scripts\prepare-installer.cjs || exit /b 1

echo === [3/3] Desktop installer
call npx electron-builder --win || exit /b 1

echo.
echo Done. In release\:
dir /b release\*.exe
echo Also: release\link\ ^(Link^), release\gateway\ ^(gateway^), the VSIX in xae-extension\KvalStateScope.Xae\bin\Release\
endlocal
