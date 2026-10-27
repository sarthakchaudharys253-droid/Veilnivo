@echo off
setlocal
cd /d "%~dp0"
set "VEILNIVO_NODE=node"
where node >nul 2>&1
if not errorlevel 1 goto launch
set "VEILNIVO_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%VEILNIVO_NODE%" goto launch
echo Node.js 22 or newer is required. Install Node.js, reopen this folder,
echo then follow LOCAL-RUN.md to install pnpm, dependencies, and PostgreSQL.
pause
exit /b 1
:launch
"%VEILNIVO_NODE%" scripts\local.mjs start
if errorlevel 1 pause
