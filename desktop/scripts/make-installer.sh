#!/usr/bin/env bash
# Собирает NEX Admin для Windows на Linux без Wine:
# 1) electron-builder делает dist/win-unpacked (+ портативный exe и zip)
# 2) makensis из кэша electron-builder пакует установщик build/installer.nsi
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
npx electron-builder --win portable zip --x64
NSIS=$(ls -d ~/.cache/electron-builder/nsis-3*/nsis-3*/ | grep -v '\.7z' | head -1)
RES=$(ls -d ~/.cache/electron-builder/nsis-resources-*/nsis-resources-*/ | grep -v '\.7z' | head -1)
chmod +x "$NSIS/linux/makensis"
NSISDIR="$NSIS" "$NSIS/linux/makensis" -V2 -DVERSION="$VERSION" \
  "-X!addplugindir /x86-unicode $RES/plugins/x86-unicode" build/installer.nsi
ls -la dist/*.exe
