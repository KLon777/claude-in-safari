#!/usr/bin/env python3
"""Fills tools/sign-wizard.template.applescript with the strings of each language.
Usage: python3 tools/gen_wizard.py   ->   build/wizards/sign-wizard.ru.applescript, build/wizards/sign-wizard.en.applescript"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

S = {
    "ru": {
        "title": "Claude in Safari — подпись",
        "err_title": "Ошибка:",
        "btn_cancel": "Отмена", "btn_start": "Начать", "btn_check": "Проверить",
        "btn_store": "Открыть App Store", "btn_xcode": "Открыть Xcode",
        "btn_sign": "Подписать", "btn_done": "Готово", "btn_open_app": "Открыть приложение",
        "intro": "Это мастер подписи приложения «Claude in Safari» вашим собственным бесплатным сертификатом Apple Development.\n\n"
                 "Мастер скопирует приложение в «Программы» и подпишет его, а папку «Claude Safari Server» положит в /Users/Shared.\n\n"
                 "Нужен Apple ID.",
        "notfound_a": "Не нахожу «", "notfound_b": "» рядом с мастером.",
        "xcode_step": "Шаг 1 из 2: установите Xcode.\nОн бесплатный (~10 ГБ) и нужен только чтобы получить сертификат.",
        "cert_step": "Шаг 2 из 2: выпустите сертификат в Xcode.\n\n"
                     "1. Xcode ➜ Settings… (⌘,) ➜ Apple Accounts\n"
                     "2. Sign In… ➜ войдите своим Apple ID\n"
                     "3. Выберите свой аккаунт ➜ Manage Certificates…\n"
                     "4. Внизу слева «+» ➜ Apple Development\n\n"
                     "Потом нажмите «Проверить».\n\nОкно мастера скрылось? Нажмите его значок в Dock.",
        "err_no_xcode": "Xcode не установлен.", "err_no_cert": "Сертификат не найден.",
        "notif_nocert": "Сертификат пока не найден",
        "sign_ready": "Сертификат найден. Сейчас приложение будет подписано.\nmacOS может спросить доступ к ключу — нажмите «Всегда разрешать».",
        "progress": "Подписываю…",
        "done": "Готово: приложение подписано вашим сертификатом.\n\n"
                "Сервер добавлен в Claude Desktop; перезапустите Claude Desktop (⌘Q). Дальше: откройте приложение ➜ Safari ➜ Настройки ➜ Расширения ➜ включите «Claude in Safari» и разрешите все сайты.\n"
                "Сертификат действует год; после обновления приложения запустите мастер снова.",
    },
    "en": {
        "title": "Claude in Safari — signing",
        "err_title": "Error:",
        "btn_cancel": "Cancel", "btn_start": "Start", "btn_check": "Check",
        "btn_store": "Open App Store", "btn_xcode": "Open Xcode",
        "btn_sign": "Sign", "btn_done": "Done", "btn_open_app": "Open the app",
        "intro": "This wizard signs the \"Claude in Safari\" app with your own free Apple Development certificate.\n\n"
                 "It copies the app to Applications, signs it, and puts the \"Claude Safari Server\" folder into /Users/Shared.\n\n"
                 "You need an Apple ID.",
        "notfound_a": "'", "notfound_b": "' not found next to the wizard.",
        "xcode_step": "Step 1 of 2: install Xcode.\nIt is free (~10 GB) and only needed to obtain the certificate.",
        "cert_step": "Step 2 of 2: create the certificate in Xcode.\n\n"
                     "1. Xcode ➜ Settings… (⌘,) ➜ Apple Accounts\n"
                     "2. Sign In… ➜ sign in with your Apple ID\n"
                     "3. Select your account ➜ Manage Certificates…\n"
                     "4. Bottom left \"+\" ➜ Apple Development\n\n"
                     "Then click Check.\n\nWizard window hidden? Click its icon in the Dock.",
        "err_no_xcode": "Xcode is not installed.", "err_no_cert": "No certificate found.",
        "notif_nocert": "Certificate not found yet",
        "sign_ready": "Certificate found. The app will be signed now.\nIf macOS asks for access to the key, choose Always Allow.",
        "progress": "Signing…",
        "done": "Done: the app is signed with your certificate.\n\n"
                "The server was added to Claude Desktop; restart Claude Desktop (⌘Q). Next: open the app ➜ Safari ➜ Settings ➜ Extensions ➜ enable \"Claude in Safari\" and allow all websites.\n"
                "The certificate is valid for one year; run the wizard again after updating the app.",
    },
}


def lit(s):
    """AppleScript string content: escape quotes and turn newlines into `" & return & "`."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", '" & return & "')


def build(lang):
    t = open(os.path.join(ROOT, "tools", "sign-wizard.template.applescript"), encoding="utf-8").read()
    t = re.sub(r"@@(\w+)@@", lambda m: lit(S[lang][m.group(1)]), t)
    assert "@@" not in t
    out = os.path.join(ROOT, "build", "wizards")
    os.makedirs(out, exist_ok=True)
    p = os.path.join(out, "sign-wizard.%s.applescript" % lang)
    open(p, "w", encoding="utf-8").write(t)
    return p


if __name__ == "__main__":
    assert set(S["ru"]) == set(S["en"]), set(S["ru"]) ^ set(S["en"])
    for lang in S:
        print(build(lang))
