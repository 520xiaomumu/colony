#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  Colony 11.26 一键启动（单进程双端口）"
echo "========================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 Node.js 22+: https://nodejs.org/"
  exit 1
fi
echo "[OK] 检测到 Node.js $(node -v)"

if [ ! -d "$DIR/sub/node_modules" ]; then
  echo "[1/2] 首次运行，正在为聚合网关与订阅驱动安装依赖..."
  (cd "$DIR/sub" && npm install) || echo "[警告] npm install 失败，Cursor 驱动可能不可用。"
else
  echo "[1/2] 聚合网关依赖已就绪"
fi

if [ ! -e "$DIR/local/sub" ]; then
  ln -s "$DIR/sub" "$DIR/local/sub" 2>/dev/null || cp -R "$DIR/sub" "$HOME/colony-sub"
fi

mkdir -p "$DIR/.logs"
echo "[2/2] 启动单一 Colony 本机进程 (:4130 控制面 + :4135 聚合网关)..."
nohup node "$DIR/local/colony-local.cjs" --port 4130 --gateway-port 4135 >"$DIR/.logs/colony-local.log" 2>&1 &

sleep 1
echo "[完成] 单进程双端口已启动："
echo "  - 控制面 : http://127.0.0.1:4130 (锁死仅本机)"
echo "  - 聚合网关: http://127.0.0.1:4135/v1 (本机免密，OpenAI / Anthropic 通用)"
echo "请在浏览器中打开: $DIR/colony.html"
if command -v open >/dev/null 2>&1; then
  open "$DIR/colony.html"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/colony.html" >/dev/null 2>&1 || true
fi
