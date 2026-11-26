#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  Colony 11.26 一键启动本机与订阅服务"
echo "========================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 Node.js 22+: https://nodejs.org/"
  exit 1
fi
echo "[OK] 检测到 Node.js $(node -v)"

if [ ! -d "$DIR/sub/node_modules" ]; then
  echo "[1/3] 首次运行，正在为订阅代理安装依赖..."
  (cd "$DIR/sub" && npm install) || echo "[警告] npm install 失败，Cursor 渠道可能不可用。"
else
  echo "[1/3] 订阅代理依赖已就绪"
fi

mkdir -p "$DIR/.logs"
echo "[2/3] 后台启动 colony-local (127.0.0.1:4130)..."
nohup node "$DIR/local/colony-local.cjs" --port 4130 >"$DIR/.logs/colony-local.log" 2>&1 &

echo "[3/3] 后台启动 colony-sub (127.0.0.1:4135)..."
(cd "$DIR/sub" && nohup node server.mjs --port 4135 >"$DIR/.logs/colony-sub.log" 2>&1 &)

sleep 1
echo "[完成] 本机服务(4130)与订阅代理(4135)已启动。"
echo "请在浏览器中打开: $DIR/colony.html"
if command -v open >/dev/null 2>&1; then
  open "$DIR/colony.html"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/colony.html" >/dev/null 2>&1 || true
fi
