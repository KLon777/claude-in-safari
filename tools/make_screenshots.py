#!/usr/bin/env python3
"""Takes the README screenshots into ../docs through the extension itself. Needs Safari with the extension enabled."""
import base64, io, json, os, shutil, subprocess, sys, time
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")
os.makedirs(DOCS, exist_ok=True)
web = subprocess.Popen([sys.executable, "-m", "http.server", "18766", "--bind", "127.0.0.1"], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen(["node", os.path.join(HERE, "..", "server", "server.js")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
n = 0


def rpc(method, params=None, notify=False):
    global n
    m = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        m["params"] = params
    if not notify:
        n += 1
        m["id"] = n
    srv.stdin.write(json.dumps(m) + "\n")
    srv.stdin.flush()
    return None if notify else json.loads(srv.stdout.readline())


def call(name, **a):
    return rpc("tools/call", {"name": name, "arguments": a})["result"]


def text(name, **a):
    r = call(name, **a)
    assert not r.get("isError"), r
    return r["content"][0]["text"]


def save(name, fname, width=1100, **a):
    c = call(name, **a)["content"][0]
    assert c["type"] == "image", c
    img = Image.open(io.BytesIO(base64.b64decode(c["data"]))).convert("RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)))
    img.save(os.path.join(DOCS, fname), "JPEG", quality=82)
    print(fname, img.size)


tabs = []
try:
    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "shots", "version": "0"}})
    rpc("notifications/initialized", notify=True)
    time.sleep(3)
    t = json.loads(text("safari_new_tab", url="https://en.wikipedia.org/wiki/Safari_(web_browser)"))["id"]
    tabs.append(t)
    text("safari_wait", tabId=t, text="WebKit")
    save("safari_screenshot", "screenshot-viewport.jpg", tabId=t)
    save("safari_fullpage_screenshot", "screenshot-fullpage.jpg", width=700, tabId=t, maxHeight=2600)
    t2 = json.loads(text("safari_new_tab", url="http://127.0.0.1:18766/test_page.html"))["id"]
    tabs.append(t2)
    text("safari_wait", tabId=t2, text="ready-late")
    save("safari_screenshot", "screenshot-testpage.jpg", tabId=t2)
finally:
    for t in tabs:
        try:
            call("safari_close_tab", tabId=t)
        except Exception:
            pass
    srv.terminate()
    web.terminate()
shutil.copy(os.path.join(HERE, "..", "Claude for Safari", "Claude for Safari", "Resources", "Icon.png"), os.path.join(DOCS, "icon.png"))
