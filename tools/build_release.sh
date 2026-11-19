#!/bin/zsh
# Builds dist/Claude-in-Safari.dmg: an ad-hoc signed app (no Apple account needed; users re-sign it or allow unsigned
# extensions, see README) plus the MCP server (a Swift binary).
set -euo pipefail
cd "$(dirname "$0")/.."
STAGE="dist/stage"
rm -rf dist build-release && SRVDIR="$STAGE/Claude Safari Server"; mkdir -p "$SRVDIR"

xcodebuild -project "Claude for Safari/Claude for Safari.xcodeproj" -scheme "Claude for Safari" \
  -configuration Release -destination "platform=macOS" -derivedDataPath build-release \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" build | tail -3

APP="build-release/Build/Products/Release/Claude for Safari.app"
cp -R "$APP" "$STAGE/Claude in Safari.app"

osacompile -o "$STAGE/Sign with my certificate.app" tools/sign-wizard.applescript
# MCP server: one universal Swift binary, no Node.js needed
mkdir -p build-release
for a in arm64 x86_64; do swiftc -O -swift-version 5 -target "$a-apple-macos12.0" -o "build-release/server-$a" swift-server/main.swift swift-server/Tools.swift swift-server/Policy.swift; done
lipo -create build-release/server-arm64 build-release/server-x86_64 -output "$SRVDIR/claude-safari-server"
codesign --force -s - "$SRVDIR/claude-safari-server"

cat > "$STAGE/README.txt" <<'EOF'
Claude in Safari (unofficial) - https://github.com/KLon777/claude-in-safari

1. Double-click "Sign with my certificate" (right-click > Open if macOS blocks it). The wizard copies the app to
   Applications, guides you through getting a free Apple Development certificate (needs Xcode + your Apple ID),
   signs the app and checks the result. Alternatively use Safari > Develop > Allow Unsigned Extensions
   (repeat after each Safari restart) - see the README.
2. Safari > Settings > Extensions: enable Claude in Safari, allow all websites.
3. The wizard copies "Claude Safari Server" to /Users/Shared and adds it to Claude Desktop's config by itself.
   Without the wizard: copy the folder there manually (Finder > Go > Go to Folder, Shift+Cmd+G), then run in Terminal:
   "/Users/Shared/Claude Safari Server/claude-safari-server" --install
4. Restart Claude Desktop.

Установка по-русски - в README репозитория.
EOF

# DMG window with a drawn background (needs: python3 -m pip install --user dmgbuild)
RES="dist/dmg-res"; mkdir -p "$RES"
swift tools/dmg/background.swift "$RES" >/dev/null
tiffutil -cathidpicheck "$RES/background.png" "$RES/background@2x.png" -out "$RES/background.tiff" 2>/dev/null
DMGBUILD="$(command -v dmgbuild || echo "$HOME/Library/Python/$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')/bin/dmgbuild")"
"$DMGBUILD" -s tools/dmg/settings.py -D stage="$PWD/$STAGE" -D res="$PWD/$RES" "Claude in Safari" dist/Claude-in-Safari.dmg >/dev/null
rm -rf "$RES"
rm -rf "$STAGE"
# The built copy must not stay registered with Safari/LaunchServices (it would shadow the installed extension).
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
B="$PWD/build-release/Build/Products/Release/Claude for Safari.app"
pluginkit -r "$B/Contents/PlugIns/Claude for Safari Extension.appex" 2>/dev/null || true
"$LSR" -u "$B" 2>/dev/null || true
rm -rf build-release
ls -lh dist/Claude-in-Safari.dmg
