#!/bin/bash
# Claude in Safari: signs the app with YOUR OWN free Apple Development certificate (guided, double-click or run in Terminal).
# Подписывает приложение вашим собственным бесплатным сертификатом Apple Development (с подсказками).
# Options: --app PATH  sign this .app in place instead of copying it to /Applications (used for testing)
# Env: CIS_IDENTITY_FILTER (default "Apple Development"), CIS_WAIT seconds to wait for a certificate (default 900)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
FILTER="${CIS_IDENTITY_FILTER:-Apple Development}"
WAIT="${CIS_WAIT:-900}"
APPNAME="Claude in Safari.app"
TARGET=""
[ "${1:-}" = "--app" ] && TARGET="${2:-}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

# 1. The app: copy it from the disk image to /Applications unless --app was given.
if [ -z "$TARGET" ]; then
  [ -d "$HERE/$APPNAME" ] || die "Не нахожу '$APPNAME' рядом со скриптом. / '$APPNAME' not found next to this script."
  say "1/4 Копирую приложение в /Applications / Copying the app to /Applications"
  rm -rf "/Applications/$APPNAME" && cp -R "$HERE/$APPNAME" /Applications/ || die "Не удалось скопировать (нужны права на /Applications). / Copy failed."
  TARGET="/Applications/$APPNAME"
fi
[ -d "$TARGET" ] || die "Нет приложения: $TARGET / App not found: $TARGET"

# 2. The certificate. Only Xcode can issue it (needs your Apple ID, with 2FA), so we guide and wait.
find_identity() { security find-identity -v -p codesigning 2>/dev/null | grep "$FILTER" | head -1 | awk '{print $2}'; }
ID="$(find_identity)"
if [ -z "$ID" ]; then
  say "2/4 Нужен сертификат Apple Development / An Apple Development certificate is needed"
  if [ ! -d /Applications/Xcode.app ]; then
    echo "• Установите Xcode из App Store (бесплатно, ~10 ГБ; нужен только чтобы получить сертификат)."
    echo "  Install Xcode from the App Store (free, ~10 GB; only needed to obtain the certificate)."
    open "macappstore://apps.apple.com/app/id497799835" 2>/dev/null
    printf "  Жду установки Xcode… / Waiting for Xcode "
    for ((t = 0; t < WAIT; t += 5)); do [ -d /Applications/Xcode.app ] && break; printf '.'; sleep 5; done; echo
    [ -d /Applications/Xcode.app ] || die "Xcode не появился. Установите его и запустите скрипт снова. / Xcode did not appear; install it and run again."
  fi
  printf '\n\033[1mПуть к сертификату / Path to the certificate\033[0m\n'
  printf '  \033[36m1.\033[0m Откройте Xcode, примите лицензию / Open Xcode, accept the license\n'
  printf '  \033[36m2.\033[0m Меню / Menu:  \033[1mXcode ➜ Settings… (⌘,) ➜ Accounts\033[0m\n'
  printf '  \033[36m3.\033[0m Внизу слева / bottom left:  \033[1m«+» ➜ Apple ID ➜ Continue\033[0m  — войдите своим Apple ID / sign in\n'
  printf '  \033[36m4.\033[0m Выберите свой Apple ID в списке слева / select your Apple ID in the left list\n'
  printf '  \033[36m5.\033[0m Справа / on the right:  \033[1mManage Certificates… ➜ «+» (внизу слева / bottom left) ➜ Apple Development\033[0m\n'
  printf '  \033[36m6.\033[0m Закройте окна — скрипт сам увидит сертификат / close the windows — the script will notice the certificate\n\n'
  open -a Xcode 2>/dev/null
  printf "  Жду сертификат… / Waiting for the certificate "
  for ((t = 0; t < WAIT; t += 3)); do
    ID="$(find_identity)"; [ -n "$ID" ] && break
    # The certificate may be visible only without -v when Apple's intermediate certificate is missing: install it.
    if security find-identity -p codesigning 2>/dev/null | grep -q "$FILTER" && [ ! -f /tmp/.cis_wwdr ]; then
      touch /tmp/.cis_wwdr
      curl -fsSL -o /tmp/AppleWWDRCAG3.cer https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer \
        && security import /tmp/AppleWWDRCAG3.cer -k ~/Library/Keychains/login.keychain-db >/dev/null 2>&1
    fi
    printf '.'; sleep 3
  done; echo
  [ -n "$ID" ] || die "Сертификат не найден. Проверьте: security find-identity -v -p codesigning / No certificate found."
fi
echo "Сертификат / Certificate: $(security find-identity -v -p codesigning | grep "$ID" | head -1 | sed 's/^[^"]*//')"

# 3. Sign the extension first, then the app, keeping the sandbox entitlements (Safari refuses the extension without them).
say "3/4 Подписываю / Signing (macOS may ask for access to the key: choose \"Always Allow\" / «Всегда разрешать»)"
xattr -cr "$TARGET"
for A in "$TARGET"/Contents/PlugIns/*.appex "$TARGET"; do
  codesign --force --sign "$ID" --preserve-metadata=entitlements --options runtime "$A" || die "Не удалось подписать / Signing failed: $A"
done
codesign --verify --deep --strict "$TARGET" || die "Проверка подписи не прошла / Signature check failed"

say "4/4 Готово / Done"
cat <<'EOF'
Откройте приложение, затем Safari → Настройки → Расширения → включите «Claude in Safari», разрешите все сайты.
Open the app, then Safari → Settings → Extensions → enable "Claude in Safari" and allow all websites.
Сертификат действует год; после обновления приложения запустите скрипт снова. / Run this again after each app update.
EOF
[ "$TARGET" = "/Applications/$APPNAME" ] && open "$TARGET"
exit 0
