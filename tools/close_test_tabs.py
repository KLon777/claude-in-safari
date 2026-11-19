#!/usr/bin/env python3
"""Close leftover test tabs (title 'feature test', served from 127.0.0.1:18766)."""
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
    return rpc("tools/call", {"name": name, "arguments": a})["result"]["content"][0]["text"]


try:
    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "c", "version": "0"}})
    rpc("notifications/initialized", notify=True)
    time.sleep(3)
    closed = 0
    for t in json.loads(tool("safari_tabs")):
        if "127.0.0.1:18766" in (t.get("url") or ""):
            tool("safari_close_tab", tabId=t["id"])
            closed += 1
    print("closed", closed)
finally:
    srv.kill()
