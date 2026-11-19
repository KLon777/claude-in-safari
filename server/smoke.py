import json, subprocess, time, sys, os
p = subprocess.Popen(["node", os.path.expanduser("~/SafariClaudeExt/server/server.js")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
n = 0
def rpc(method, params=None, notify=False):
    global n
    m = {"jsonrpc": "2.0", "method": method}
    if params is not None: m["params"] = params
    if not notify:
        n += 1; m["id"] = n
    p.stdin.write(json.dumps(m) + "\n"); p.stdin.flush()
    if notify: return None
    return json.loads(p.stdout.readline())
def tool(name, **a):
    r = rpc("tools/call", {"name": name, "arguments": a})["result"]
    c = r["content"][0]
    out = c["text"] if c["type"] == "text" else "<image %d b64 chars>" % len(c["data"])
    print(("ERR " if r.get("isError") else "OK  ") + name, "->", out[:600].replace("\n", " | "))
    return out
rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "0"}})
rpc("notifications/initialized", notify=True)
for _ in range(20):
    time.sleep(1)
    r = rpc("tools/call", {"name": "safari_tabs", "arguments": {}})["result"]
    if not r.get("isError"): break
else:
    print("Extension never connected"); p.kill(); sys.exit(1)
print("connected")
tool("safari_tabs")
t = json.loads(tool("safari_new_tab", url="https://example.com"))
tid = t["id"]
tool("safari_read_page", tabId=tid)
tool("safari_get_text", tabId=tid)
tool("safari_eval", tabId=tid, code="document.title")
tool("safari_scroll", tabId=tid, dy=50)
tool("safari_screenshot", tabId=tid)
ref = None
for line in json.loads(tool("safari_read_page", tabId=tid, filter="interactive"))["tree"].splitlines():
    if "[ref_" in line: ref = line.split("[")[1].split("]")[0]; break
if ref: tool("safari_click", tabId=tid, ref=ref); time.sleep(3); tool("safari_tabs")
tool("safari_close_tab", tabId=tid)
p.kill()
