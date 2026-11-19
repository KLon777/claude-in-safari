#!/usr/bin/env python3
"""Does console/network capture work on strict-CSP pages? Prints record counts per URL."""
import json, os, subprocess, time

HERE = os.path.dirname(os.path.abspath(__file__))
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


def tool(name, **a):
    r = rpc("tools/call", {"name": name, "arguments": a})["result"]
    return r.get("isError"), r["content"][0]["text"]


rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "c", "version": "0"}})
rpc("notifications/initialized", notify=True)
time.sleep(3)
tab = None
try:
    _, o = tool("safari_new_tab", url="https://example.com/")
    tab = json.loads(o)["id"]
    for url in ("https://github.com/", "https://example.com/"):
        tool("safari_navigate", tabId=tab, url=url, read=False)
        time.sleep(2)
        e1, net = tool("safari_network", tabId=tab)
        e2, con = tool("safari_console", tabId=tab)
        print(url, "network:", net[:80] if e1 else len(json.loads(net)), "| console:", con[:80] if e2 else len(json.loads(con)))
finally:
    if tab:
        tool("safari_close_tab", tabId=tab)
    srv.kill()
