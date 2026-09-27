@echo off
rem Stops the development server started with dev-start.cmd (or npm run dev): the Vite process of this folder
rem listening on port 3000. Another program on that port is left alone.
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "if (-not $c) { Write-Output 'The dev server is not running (nothing listens on port 3000).'; exit 0 }" ^
  "$p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.OwningProcess);" ^
  "if ($p.CommandLine -notmatch 'vite') { Write-Output ('Port 3000 is used by another program (' + $p.Name + '): not stopped.'); exit 1 }" ^
  "taskkill /PID $c.OwningProcess /T /F | Out-Null; Write-Output 'Dev server stopped.'"
exit /b %errorlevel%
