#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  print "GameStudio 需要 Node.js 24 或更新版本。"
  read -r "?按回车退出"
  exit 1
fi
if [ ! -d node_modules ]; then
  npm ci
fi
print "GameStudio 本地工作台：http://127.0.0.1:5173"
print "关闭此终端或按 Control+C 可停止。"
npm run dev
