#!/usr/bin/env python3
"""Generates the two independent landing pages for GitHub Pages: docs/index.html (English) and docs/ru/index.html (Russian),
plus docs/sitemap.xml. Usage: python3 tools/gen_site.py"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://klon777.github.io/claude-in-safari/"
REL = "https://github.com/KLon777/claude-in-safari/releases/latest"
DL = REL + "/download/Claude-in-Safari-%s.dmg"

L = {
    "en": dict(
        path="", assets="", other="ru/", other_name="Русский", html_lang="en",
        title="Claude in Safari — let Claude drive your real Safari (MCP, unofficial)",
        desc="Unofficial Safari Web Extension + local MCP server: Claude or any MCP client reads pages, clicks, types, takes screenshots, runs OCR and JavaScript in your real Safari.",
        og="Safari Web Extension + local MCP server that lets Claude drive your real Safari.",
        lead="A Safari Web Extension plus a local MCP server that lets Claude, or any MCP client, work in your real Safari, the way \"Claude in Chrome\" works in Chrome.",
        dl="Download DMG (English)", guide="Full guide", guide_url="https://github.com/KLon777/claude-in-safari/blob/main/README.en.md",
        note="<b>Unofficial project.</b> Not affiliated with or endorsed by Anthropic. The extension gives an MCP client control of your <i>real</i> Safari sessions: enable it only if you understand that.",
        alt="Claude reading a page in Safari", alt_full="Full-page screenshot",
        h_can="What it can do", h_inst="Install",
        grid=[("Tabs", "list, open, close, navigate, history, frames"),
              ("Read", "accessibility snapshot with refs, page text, reader mode, shadow DOM, iframes (cross-origin too)"),
              ("Act", "click, double/right click, hover, type, keys, forms, scroll, drag and drop, dialogs, wait"),
              ("See", "screenshots (page, full page, one element), PDF, on-device OCR (Apple Vision, ru+en)"),
              ("Files and data", "upload files to a page, cookies, localStorage and sessionStorage (asks you every time)"),
              ("Debug", "console, fetch/XHR log, JavaScript in the extension or page world"),
              ("Private", "everything stays on 127.0.0.1; Origin check and token protect the port; site block list and confirmations")],
        steps=["Download <code>Claude-in-Safari-en.dmg</code> from <a href=\"%s\">Releases</a> and open it." % REL,
               "Run <b>Sign with my certificate</b>: the wizard copies the app to Applications, guides you through a free Apple Development certificate (Xcode + your Apple ID), signs the app and puts the server in place. Without a certificate use Safari &rarr; Develop &rarr; Allow Unsigned Extensions (repeat after each Safari restart).",
               "Safari &rarr; Settings &rarr; Extensions: enable <b>Claude in Safari</b> and allow all websites.",
               "Restart Claude Desktop: the server <b>Claude in Safari</b> is already in its config."],
        foot="\"Claude\" is a trademark of Anthropic.",
    ),
    "ru": dict(
        path="ru/", assets="../", other="", other_name="English", html_lang="ru",
        title="Claude in Safari — Claude управляет вашим настоящим Safari (MCP, неофициально)",
        desc="Неофициальное расширение Safari и локальный MCP-сервер: Claude или любой MCP-клиент читает страницы, кликает, печатает, делает скриншоты, распознаёт текст и выполняет JavaScript в вашем настоящем Safari.",
        og="Расширение Safari и локальный MCP-сервер: Claude управляет вашим настоящим Safari.",
        lead="Расширение Safari и локальный MCP-сервер: Claude (или любой MCP-клиент) работает в вашем настоящем Safari, так же как «Claude in Chrome» в Chrome.",
        dl="Скачать DMG (русский)", guide="Полная инструкция", guide_url="https://github.com/KLon777/claude-in-safari/blob/main/README.md",
        note="<b>Неофициальный проект.</b> Не связан с Anthropic и не одобрен ею. Расширение даёт MCP-клиенту управление вашими <i>настоящими</i> сессиями Safari: включайте его, только понимая это.",
        alt="Claude читает страницу в Safari", alt_full="Скриншот страницы целиком",
        h_can="Что умеет", h_inst="Установка",
        grid=[("Вкладки", "список, открыть, закрыть, перейти, история, фреймы"),
              ("Чтение", "снимок доступности с ref, текст страницы, режим чтения, shadow DOM, iframe (в том числе чужие домены)"),
              ("Действия", "клик, двойной и правый клик, наведение, ввод, клавиши, формы, прокрутка, drag and drop, диалоги, ожидание"),
              ("Зрение", "скриншоты (страница, вся страница, один элемент), PDF, распознавание текста на устройстве (Apple Vision, ru+en)"),
              ("Файлы и данные", "загрузка файлов на страницу, cookies, localStorage и sessionStorage (каждый раз спрашивает вас)"),
              ("Отладка", "консоль, журнал fetch/XHR, JavaScript в мире расширения или страницы"),
              ("Приватно", "всё на 127.0.0.1; порт защищают проверка Origin и токен; чёрный список сайтов и подтверждения")],
        steps=["Скачайте <code>Claude-in-Safari-ru.dmg</code> из <a href=\"%s\">Releases</a> и откройте его." % REL,
               "Запустите <b>«Подписать своим сертификатом»</b>: мастер скопирует приложение в «Программы», проведёт через получение бесплатного сертификата Apple Development (Xcode и ваш Apple ID), подпишет приложение и положит сервер на место. Без сертификата: Safari &rarr; Разработка &rarr; Разрешить неподписанные расширения (после каждого перезапуска Safari заново).",
               "Safari &rarr; Настройки &rarr; Расширения: включите <b>Claude in Safari</b> и разрешите все сайты.",
               "Перезапустите Claude Desktop: сервер <b>Claude in Safari</b> уже добавлен в его конфиг."],
        foot="«Claude» — торговая марка Anthropic.",
    ),
}

CSS = """:root{color-scheme:dark light;--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--card:#161b22;--line:#30363d;--acc:#2ea98f}
@media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#1f2328;--mut:#59636e;--card:#f6f8fa;--line:#d1d9e0;--acc:#0f7d68}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 20px 80px}
header{text-align:center}header img{width:110px;border-radius:24px}
h1{font-size:2.2rem;margin:.4em 0 .1em}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.3em}
p.lead{color:var(--mut);font-size:1.1rem;max-width:640px;margin:0 auto}
.btns{margin:24px 0;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btns a{padding:10px 18px;border-radius:8px;border:1px solid var(--line);color:var(--fg);text-decoration:none;font-weight:600}
.btns a.primary{background:var(--acc);border-color:var(--acc);color:#fff}
.lang{text-align:center;margin-top:8px}.lang a{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-left:4px solid #d29922;border-radius:6px;padding:12px 16px;margin:20px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.grid div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
img.shot{max-width:100%;border:1px solid var(--line);border-radius:8px}
footer{margin-top:3em;color:var(--mut);font-size:.9rem;text-align:center}"""

PAGE = """<!doctype html>
<html lang="{html_lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="canonical" href="{canon}">
<link rel="alternate" hreflang="en" href="{BASE}">
<link rel="alternate" hreflang="ru" href="{BASE}ru/">
<link rel="alternate" hreflang="x-default" href="{BASE}">
<meta name="description" content="{desc}">
<meta property="og:title" content="Claude in Safari">
<meta property="og:description" content="{og}">
<meta property="og:locale" content="{og_locale}">
<meta property="og:image" content="{BASE}social-preview.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{BASE}social-preview.png">
<link rel="icon" href="{assets}icon.png">
<style>
{css}
</style>
</head>
<body>
<main>
<header>
  <img src="{assets}icon.png" alt="Claude in Safari icon">
  <h1>Claude in Safari</h1>
  <p class="lead">{lead}</p>
  <div class="btns">
    <a class="primary" href="{dl_url}">{dl}</a>
    <a href="{guide_url}">{guide}</a>
    <a href="https://github.com/KLon777/claude-in-safari">GitHub</a>
  </div>
  <div class="lang"><a href="{other_url}" hreflang="{other_lang}">{other_name}</a></div>
</header>

<div class="note">{note}</div>

<img class="shot" src="{assets}screenshot-viewport.jpg" alt="{alt}">

<h2>{h_can}</h2>
<div class="grid">
{grid}
</div>
<p><img class="shot" src="{assets}screenshot-fullpage.jpg" alt="{alt_full}" style="max-width:320px"></p>

<h2>{h_inst}</h2>
<ol>
{steps}
</ol>

<footer>MIT License · © 2026 KLon777 · <a href="https://github.com/KLon777/claude-in-safari">GitHub</a> · {foot}</footer>
</main>
</body>
</html>
"""


def page(lang):
    d = L[lang]
    other = "ru" if lang == "en" else "en"
    return PAGE.format(
        css=CSS, BASE=BASE, canon=BASE + d["path"], og_locale="ru_RU" if lang == "ru" else "en_US",
        dl_url=DL % lang, other_url=d["assets"] + d["other"] if d["other"] else d["assets"] or "./", other_lang=other,
        grid="\n".join("  <div><b>%s</b><br>%s</div>" % g for g in d["grid"]),
        steps="\n".join("<li>%s</li>" % s for s in d["steps"]),
        **{k: v for k, v in d.items() if k not in ("grid", "steps", "path", "other")})


for lang in L:
    out = os.path.join(ROOT, "docs", L[lang]["path"], "index.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w", encoding="utf-8").write(page(lang))
    print(out)

sm = os.path.join(ROOT, "docs", "sitemap.xml")
open(sm, "w").write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
                    + "".join('  <url><loc>%s</loc><xhtml:link rel="alternate" hreflang="en" href="%s"/><xhtml:link rel="alternate" hreflang="ru" href="%sru/"/></url>\n' % (BASE + p, BASE, BASE) for p in ("", "ru/"))
                    + "</urlset>\n")
print(sm)
