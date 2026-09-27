@echo off
rem Starts the development server (Vite, http://localhost:3000) in a window of its own; dev-stop.cmd stops it.
rem Edits to src\ show in the browser at once.
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo Node.js 20 or later is needed: https://nodejs.org & exit /b 1)
if not exist node_modules (
  echo === Installing the dependencies
  call npm install || exit /b 1
)

rem Already running: say so
powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo Port 3000 is in use: the dev server is running already ^(http://localhost:3000^). dev-stop.cmd stops it.
  exit /b 0
)

start "Kval StateScope dev server" cmd /c "npm run dev"
echo Dev server starting in its own window: http://localhost:3000   (dev-stop.cmd stops it)
