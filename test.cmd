@echo off
rem Runs the test suites (tests\run.cjs): unit, web (the app in a headless Edge), live (simulated PLC), desktop
rem (the Electron app). A Vite dev server is started for web / desktop. Logs and screenshots: tests\.output.
rem
rem   test.cmd                      all suites
rem   test.cmd unit web             these suites (unit, web, live, desktop, all)
rem   test.cmd web --filter palette only the tests whose name has "palette"
rem
rem Needs Node.js 20+, npm and Microsoft Edge (the web and desktop suites drive it).
setlocal
cd /d "%~dp0"
rem VS Code terminals set this, which makes Electron run as plain Node (the desktop suite)
set ELECTRON_RUN_AS_NODE=

where node >nul 2>&1 || (echo Node.js 20 or later is needed: https://nodejs.org & exit /b 1)
if not exist node_modules (
  echo === Installing the dependencies
  call npm install || exit /b 1
)
if not exist gateway\node_modules (
  echo === Installing the gateway's dependencies
  call npm install --prefix gateway || exit /b 1
)

if "%~1"=="" (
  node tests\run.cjs all
) else (
  node tests\run.cjs %*
)
exit /b %errorlevel%
