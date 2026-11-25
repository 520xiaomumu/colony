@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo   Colony 11.26 一键启动本机与订阅服务
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 22+ : https://nodejs.org/
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] 检测到 Node.js %NODE_VER%

if not exist "sub\node_modules" (
  echo.
  echo [1/3] 首次运行，正在为订阅代理安装依赖 ^(sub\node_modules^)...
  pushd sub
  call npm install
  if errorlevel 1 (
    popd
    echo [警告] npm install 失败，订阅代理中的 Cursor 渠道可能不可用，其余渠道仍可尝试启动。
  ) else (
    popd
  )
) else (
  echo [1/3] 订阅代理依赖已就绪
)

echo [2/3] 后台启动本机守护脚本 colony-local ^(127.0.0.1:4130^)...
start "Colony Local (4130)" /min cmd /c "node \"%~dp0local\colony-local.cjs\" --port 4130"

echo [3/3] 后台启动本机订阅代理 colony-sub ^(127.0.0.1:4135^)...
start "Colony Sub (4135)" /min cmd /c "cd /d \"%~dp0sub\" && node server.mjs --port 4135"

timeout /t 2 /nobreak >nul
echo.
echo [完成] 本机服务(4130)与订阅代理(4135)已启动！
echo        正在用默认浏览器打开 colony.html ...
echo        （提示：如要让浏览器网页插件生效，请记得在 Chrome 扩展页加载本目录下的 plugin 文件夹）
echo.
start "" "%~dp0colony.html"
pause
