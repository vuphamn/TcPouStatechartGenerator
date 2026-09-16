@echo off
setlocal
pushd "%~dp0"

echo === Publishing TcPouStatechartGenerator (Release, win-x64) ===
dotnet publish TcPouStatechartGenerator\TcPouStatechartGenerator.csproj -c Release
if errorlevel 1 goto :fail

echo === Building Installer (WiX MSI) ===
dotnet build Installer\Installer.wixproj -c Release
if errorlevel 1 goto :fail

echo.
echo === Build succeeded ===
echo MSI output: Installer\bin\x64\Release\TcPouStatechartGeneratorSetup.msi
popd
endlocal
exit /b 0

:fail
echo.
echo *** BUILD FAILED ***
popd
endlocal
exit /b 1
