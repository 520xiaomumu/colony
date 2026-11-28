#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================"
echo "  Colony 11.28 一键启动（单进程双端口）"
echo "========================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装 Node.js 18+: https://nodejs.org/"
  exit 1
fi
echo "[OK] 检测到 Node.js $(node -v)"

if [ ! -d "$DIR/local/sub/node_modules" ]; then
  echo "[1/2] 首次运行，正在为聚合网关与订阅驱动安装依赖..."
  (cd "$DIR/local/sub" && npm install --no-audit --no-fund) || echo "[警告] npm install 失败，Cursor 驱动可能不可用，其余渠道照常启动。"
else
  echo "[1/2] 聚合网关依赖已就绪"
fi

echo "[2/2] 后台启动单一 Colony 本机进程 (:4130 控制面 + :4135 聚合网关)..."
node "$DIR/local/colony-local.cjs" --install

sleep 1
echo "[完成] 单进程双端口已在后台就绪："
echo "  - 控制面  : http://127.0.0.1:4130 (锁死仅本机)"
echo "  - 聚合网关: http://127.0.0.1:4135/v1 (本机免密，OpenAI / Anthropic 通用)"
echo "正在打开: $DIR/colony.html"
if command -v open >/dev/null 2>&1; then
  open "$DIR/colony.html"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$DIR/colony.html" >/dev/null 2>&1 || true
fi
