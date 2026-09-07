#!/usr/bin/env bash

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_PATH="${1:-}"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 20.19.0 或更高版本。" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm。请确认 npm 已加入 PATH。" >&2
  exit 1
fi

NODE_VERSION="$(node --version)"
node -e '
const version = process.argv[1].replace(/^v/, "").split(".").map(Number);
const [major, minor, patch] = version;
const tooOld = major < 20 || (major === 20 && minor < 19) || (major === 20 && minor === 19 && patch < 0);
if (tooOld) process.exit(1);
' "$NODE_VERSION" || {
  echo "当前 Node.js 版本为 $NODE_VERSION，需要 20.19.0 或更高版本。" >&2
  exit 1
}

if [ -z "$PACKAGE_PATH" ]; then
  mapfile -t CANDIDATES < <(find "$SCRIPT_DIR/.." -maxdepth 1 -type f -name 'hrhy-ai-codespec-*.tgz' -print)
  if [ "${#CANDIDATES[@]}" -ne 1 ]; then
    echo "请将 tgz 路径作为第一个参数传入。" >&2
    exit 1
  fi
  PACKAGE_PATH="${CANDIDATES[0]}"
fi

echo "使用离线包安装：$PACKAGE_PATH"
npm install -g "$PACKAGE_PATH" --offline --no-audit --no-fund
