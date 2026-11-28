#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请先安装 Node 18+ (https://nodejs.org)"
  read -r _
  exit 1
fi
node colony-local.cjs --install
if [ -f "../colony.html" ]; then
  open "../colony.html" 2>/dev/null || xdg-open "../colony.html" 2>/dev/null || true
elif [ -f "colony.html" ]; then
  open "colony.html" 2>/dev/null || xdg-open "colony.html" 2>/dev/null || true
fi
