@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node 18+ ^(https://nodejs.org^)
  pause
  exit /b 1
)
node colony-local.cjs --install
if exist "..\colony.html" (
  start "" "..\colony.html"
) else if exist "colony.html" (
  start "" "colony.html"
)
