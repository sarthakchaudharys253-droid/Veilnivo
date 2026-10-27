@echo off
setlocal
cd /d "%~dp0"
set "VEILNIVO_NODE=node"
where node >nul 2>&1
if not errorlevel 1 goto stop
set "VEILNIVO_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%VEILNIVO_NODE%" goto stop
echo Node.js 22 or newer is required. See LOCAL-RUN.md.
pause
exit /b 1
:stop
"%VEILNIVO_NODE%" scripts\local.mjs stop
if errorlevel 1 pause
