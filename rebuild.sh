#!/bin/zsh
# Rebuild "Claude for Safari", install it to ~/Applications and leave no duplicate registration.
# Run it after code updates and when your Apple Development certificate expires (about a year).
set -euo pipefail
cd "$(dirname "$0")"
# Your Apple Developer Team ID: export DEVELOPMENT_TEAM=XXXXXXXXXX or put it into a git-ignored file named .team
[ -z "${DEVELOPMENT_TEAM:-}" ] && [ -f .team ] && DEVELOPMENT_TEAM="$(tr -d '[:space:]' < .team)"
: "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM (your Apple Team ID) or create a .team file}"
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister
BUILT="$PWD/build/Build/Products/Debug/Claude for Safari.app"
DEST="$HOME/Applications/Claude in Safari.app"

xcodebuild -project "Claude for Safari/Claude for Safari.xcodeproj" -scheme "Claude for Safari" \
  -configuration Debug -destination "platform=macOS" -derivedDataPath build \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" -allowProvisioningUpdates build | tail -3

pluginkit -r "$BUILT/Contents/PlugIns/Claude for Safari Extension.appex" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$BUILT" "$DEST"
"$LSR" -u "$BUILT" 2>/dev/null || true
rm -rf "$BUILT"
open "$DEST"
echo "Installed: $DEST. If Safari still shows the old build, restart Safari."
