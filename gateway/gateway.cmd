@echo off
rem Kval MachineScope gateway: gateway.cmd init --host <name> | start | add-token <name> | remove-token <name>
rem With the Node.js the setup put beside it (node\node.exe), else the one on this computer's PATH.
setlocal
set "KSS_NODE=%~dp0node\node.exe"
if not exist "%KSS_NODE%" set "KSS_NODE=node"
"%KSS_NODE%" "%~dp0gateway.cjs" %*
exit /b %ERRORLEVEL%
