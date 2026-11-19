#!/usr/bin/env python3
"""Check cross-origin iframe tools on a real site (MDN live example iframe). Needs Safari with the extension enabled."""
import json, os, subprocess, sys, time

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
    return ("ERR " if r.get("isError") else "") + r["content"][0]["text"]


tab = None
try:
    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "ri", "version": "0"}})
    rpc("notifications/initialized", notify=True)
    time.sleep(3)
    tab = json.loads(tool("safari_new_tab", url="https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe"))["id"]
    time.sleep(6)
    print("top iframe lines:", [l[:110] for l in json.loads(tool("safari_read_page", tabId=tab, filter="all"))["tree"].splitlines() if "iframe" in l][:3])
    frames = json.loads(tool("safari_frames", tabId=tab))
    print("frames:", json.dumps(frames)[:600])
    for f in frames:
        if f.get("top"):
            continue
        out = tool("safari_read_page", tabId=tab, frame=f["frameId"])
        print("frame", f["frameId"], f["url"][:80], "->", out[:300].replace("\n", " | "))
        print("text:", tool("safari_get_text", tabId=tab, frame=f["frameId"])[:200].replace("\n", " | "))
finally:
    if tab:
        tool("safari_close_tab", tabId=tab)
    srv.terminate()
