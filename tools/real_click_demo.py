#!/usr/bin/env python3
"""Two-step check of real system clicks.
  real_click_demo.py open   - opens the test page, prints the screen point of the canvas text
  (click that point with a system-level tool, e.g. MacOS-MCP Click)
  real_click_demo.py check  - prints what the page recorded (isTrusted, offsets) and closes the tab
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = "/tmp/claude_real_click_tab"
web = srv = None
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


def tool(name, **a):
    r = rpc("tools/call", {"name": name, "arguments": a})["result"]
    assert not r.get("isError"), r["content"][0]["text"]
    text = r["content"][0]["text"]
    try:
        return json.loads(text)
    except ValueError:
        return text  # e.g. safari_wait answers "found"


mode = sys.argv[1] if len(sys.argv) > 1 else "open"
srv = subprocess.Popen(["node", os.path.join(HERE, "..", "server", "server.js")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
try:
    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "d", "version": "0"}})
    rpc("notifications/initialized", notify=True)
    time.sleep(3)
    if mode == "open":
        web = subprocess.Popen([sys.executable, "-m", "http.server", "18766", "--bind", "127.0.0.1"], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
        tab = tool("safari_new_tab", url="http://127.0.0.1:18766/test_page.html")["id"]
        tool("safari_activate_tab", tabId=tab)
        tool("safari_wait", tabId=tab, text="ready-late")
        hit = tool("safari_ocr", tabId=tab, query="4711")["lines"][0]
        pt = tool("safari_screen_point", tabId=tab, x=hit["cx"], y=hit["cy"])
        open(STATE, "w").write(str(tab))
        print(json.dumps({"tab": tab, "viewport_point": [hit["cx"], hit["cy"]], "screen_point": [pt["x"], pt["y"]], "pageFocused": pt["pageFocused"]}))
        time.sleep(60)  # keep the page server alive while the system click happens
    else:
        tab = int(open(STATE).read())
        out = tool("safari_eval", tabId=tab, code="document.getElementById('out').textContent")["value"]
        print(out)
        tool("safari_close_tab", tabId=tab)
finally:
    srv.kill()
    if web:
        web.kill()
