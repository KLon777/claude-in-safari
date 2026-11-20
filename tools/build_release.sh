#!/bin/zsh
# Builds dist/Claude-in-Safari-ru.dmg and dist/Claude-in-Safari-en.dmg: an ad-hoc signed app (no Apple account needed; users
# re-sign it with the wizard or allow unsigned extensions, see README) plus the MCP server (a Swift binary).
# The two images differ only in language: wizard dialogs, window background, README.txt and the wizard's file name.
# Usage: tools/build_release.sh [ru] [en]   (default: both)
set -euo pipefail
cd "$(dirname "$0")/.."
LANGS=("$@"); [ ${#LANGS[@]} -eq 0 ] && LANGS=(ru en)
COMMON="dist/common"
rm -rf dist build-release && mkdir -p "$COMMON/Claude Safari Server"

xcodebuild -project "Claude for Safari/Claude for Safari.xcodeproj" -scheme "Claude for Safari" \
  -configuration Release -destination "platform=macOS" -derivedDataPath build-release \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" build | tail -3

APP="build-release/Build/Products/Release/Claude for Safari.app"
cp -R "$APP" "$COMMON/Claude in Safari.app"

# MCP server: one universal Swift binary, no Node.js needed
for a in arm64 x86_64; do swiftc -O -swift-version 5 -target "$a-apple-macos12.0" -o "build-release/server-$a" swift-server/main.swift swift-server/Tools.swift swift-server/Policy.swift swift-server/Extras.swift; done
lipo -create build-release/server-arm64 build-release/server-x86_64 -output "$COMMON/Claude Safari Server/claude-safari-server"
codesign --force -s - "$COMMON/Claude Safari Server/claude-safari-server"

python3 tools/gen_wizard.py >/dev/null
DMGBUILD="$(command -v dmgbuild || echo "$HOME/Library/Python/$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')/bin/dmgbuild")"

for L in "${LANGS[@]}"; do
  STAGE="dist/stage-$L"; RES="dist/dmg-res-$L"
  mkdir -p "$STAGE" "$RES"
  cp -R "$COMMON/Claude in Safari.app" "$COMMON/Claude Safari Server" "$STAGE/"
  if [ "$L" = ru ]; then WIZ="Подписать своим сертификатом"; else WIZ="Sign with my certificate"; fi
  osacompile -o "$STAGE/$WIZ.app" "build/wizards/sign-wizard.$L.applescript"
  cp "tools/dmg/README.$L.txt" "$STAGE/README.txt"
  # DMG window with a drawn background (needs: python3 -m pip install --user dmgbuild)
  swift tools/dmg/background.swift "$RES" "$L" >/dev/null
  tiffutil -cathidpicheck "$RES/background.png" "$RES/background@2x.png" -out "$RES/background.tiff" 2>/dev/null
  "$DMGBUILD" -s tools/dmg/settings.py -D stage="$PWD/$STAGE" -D res="$PWD/$RES" -D wizard="$WIZ" "Claude in Safari" "dist/Claude-in-Safari-$L.dmg" >/dev/null
  rm -rf "$RES" "$STAGE"
done
rm -rf "$COMMON"
# The built copy must not stay registered with Safari/LaunchServices (it would shadow the installed extension).
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
B="$PWD/build-release/Build/Products/Release/Claude for Safari.app"
pluginkit -r "$B/Contents/PlugIns/Claude for Safari Extension.appex" 2>/dev/null || true
"$LSR" -u "$B" 2>/dev/null || true
rm -rf build-release
ls -lh dist/*.dmg
