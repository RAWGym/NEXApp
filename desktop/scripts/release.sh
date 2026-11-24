#!/usr/bin/env bash
# Выпуск новой версии NEX Admin: собрать установщик и опубликовать его в GitHub Releases.
# Программа у сотрудников раз в 4 часа читает latest.json из последнего релиза и предлагает обновиться.
# Порядок: поднять "version" и "releaseNotes" в package.json и запушить в main.
# GitHub Actions (.github/workflows/desktop-release.yml) сам запустит этот скрипт.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
NOTES="${1:-$(node -p "require('./package.json').releaseNotes || 'Исправления и улучшения'")}"
if gh release view "desktop-v$VERSION" --repo RAWGym/NEXApp >/dev/null 2>&1; then
  echo "Версия $VERSION уже выпущена, пропускаю"
  exit 0
fi
FILE="NEX-Admin-Setup-$VERSION.exe"
rm -rf dist
bash scripts/make-installer.sh
SHA=$(sha256sum "dist/$FILE" | cut -d' ' -f1)
node -e 'const [v,f,s,n]=process.argv.slice(1);require("fs").writeFileSync("dist/latest.json",JSON.stringify({version:v,file:f,sha256:s,notes:n},null,1))' "$VERSION" "$FILE" "$SHA" "$NOTES"
cat dist/latest.json
gh release create "desktop-v$VERSION" "dist/$FILE" dist/latest.json \
  --repo RAWGym/NEXApp --title "NEX Admin $VERSION" --notes "$NOTES" --latest
