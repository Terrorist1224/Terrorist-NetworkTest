@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [NetworkTest] Node.js is required. Install Node.js 22.12 or newer.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [NetworkTest] npm was not found.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=12)?0:1)"
if errorlevel 1 (
  echo [NetworkTest] Node.js 22.12 or newer is required.
  pause
  exit /b 1
)
if not exist "node_modules\electron" (
  echo [NetworkTest] Installing dependencies for the first run...
  call npm ci
  if errorlevel 1 (
    echo [NetworkTest] Dependency installation failed.
    pause
    exit /b 1
  )
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo [NetworkTest] Preparing Electron runtime...
  node node_modules\electron\install.js
  if errorlevel 1 (
    echo [NetworkTest] Electron runtime download failed.
    pause
    exit /b 1
  )
)
if not exist ".tmp" mkdir ".tmp"
echo [NetworkTest] Starting test client...
call npm run dev
if errorlevel 1 (
  echo [NetworkTest] Startup failed. Review the error above.
  pause
  exit /b 1
)
endlocal
