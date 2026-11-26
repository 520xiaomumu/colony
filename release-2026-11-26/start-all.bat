@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo   Colony 11.26 一键启动（单进程双端口）
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
  echo [1/2] 首次运行，正在为聚合网关与订阅驱动安装依赖 ^(sub\node_modules^)...
  pushd sub
  call npm install
  if errorlevel 1 (
    popd
    echo [警告] npm install 失败，Cursor 订阅驱动可能不可用，其余渠道与本机能力照常启动。
  ) else (
    popd
  )
) else (
  echo [1/2] 聚合网关依赖已就绪
)

if not exist "local\sub" (
  echo 正在关联本地目录让单进程自动挂载聚合网关...
  xcopy /E /I /Y /Q "sub" "%USERPROFILE%\colony-sub" >nul 2>nul
)

echo [2/2] 启动单一 Colony 本机进程（:4130 控制面 + :4135 聚合网关数据面）...
start "Colony Local (4130 + 4135)" /min cmd /c "node \"%~dp0local\colony-local.cjs\" --port 4130 --gateway-port 4135"

timeout /t 2 /nobreak >nul
echo.
echo [完成] 单进程双端口已就绪：
echo   - 控制面 : http://127.0.0.1:4130  (锁死仅本机，跑命令/读写文件)
echo   - 聚合网关: http://127.0.0.1:4135/v1  (本机免密，OpenAI / Anthropic 通用)
echo 正在用默认浏览器打开 colony.html ...
echo （提示：如要使用网页模型或免本机纯插件订阅，请在 Chrome 扩展页加载本目录 plugin 文件夹并开启「允许访问文件网址」）
echo.
start "" "%~dp0colony.html"
pause
