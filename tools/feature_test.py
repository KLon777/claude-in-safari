#!/usr/bin/env python3
"""Self-check for form_input, wait, click actions, key modifiers, read_page query, resize. Needs Safari with the extension enabled."""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
web = subprocess.Popen([sys.executable, "-m", "http.server", "18766", "--bind", "127.0.0.1"], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
web2 = subprocess.Popen([sys.executable, "-m", "http.server", "18767", "--bind", "127.0.0.1"], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # second origin for the cross-origin iframe
srv = subprocess.Popen(os.environ["SERVER_CMD"].split() if os.environ.get("SERVER_CMD") else ["node", os.path.join(HERE, "..", "server", "server.js")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
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
    text = r["content"][0]["text"]
    assert not r.get("isError"), f"{name} failed: {text}"
    return text


def image(name, **a):
    r = rpc("tools/call", {"name": name, "arguments": a})["result"]
    c = r["content"][0]
    assert c["type"] == "image", c
    from PIL import Image
    import base64, io
    return Image.open(io.BytesIO(base64.b64decode(c["data"])))


def ref(query, tab):
    line = json.loads(tool("safari_read_page", tabId=tab, query=query))["tree"].splitlines()[0]
    return line.split("[")[1].split("]")[0]


tab = None
try:
    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "ft", "version": "0"}})
    rpc("notifications/initialized", notify=True)
    time.sleep(3)
    tab = json.loads(tool("safari_new_tab", url="http://127.0.0.1:18766/test_page.html?t=%d" % time.time()))["id"]
    tool("safari_wait", tabId=tab, text="ready-late")
    tool("safari_form_input", tabId=tab, ref=ref("Choice", tab), value="Beta")
    tool("safari_form_input", tabId=tab, ref=ref("Check me", tab), value=True)
    tool("safari_form_input", tabId=tab, ref=ref("Text box", tab), value="hello")
    btn = ref("Target", tab)
    for action in ("double", "right", "hover"):
        tool("safari_click", tabId=tab, ref=btn, action=action)
    tool("safari_click", tabId=tab, ref=ref("Text box", tab))
    tool("safari_key", tabId=tab, key="k", modifiers=["ctrl"])
    for q in ("Shadow Btn", "Frame Btn"):
        tool("safari_click", tabId=tab, ref=ref(q, tab))
    assert "cross-origin" in json.loads(tool("safari_read_page", tabId=tab))["tree"]
    out = json.loads(tool("safari_eval", tabId=tab, code="document.getElementById('out').textContent"))["value"]
    for want in ("select=b", "check=true", "text=hello", "dbl", "ctx", "hover", "ctrl+k", "shadow-click", "frame-click"):
        assert want in out, f"missing {want!r} in {out!r}"
    assert "Target" in json.loads(tool("safari_read_page", tabId=tab, query="target"))["tree"]
    assert "Beta" not in json.loads(tool("safari_read_page", tabId=tab, query="nomatch"))["tree"]
    con = tool("safari_console", tabId=tab)
    assert "warn-test" in con and "boom-test" in con, con
    net = json.loads(tool("safari_network", tabId=tab, filter="test_page"))
    assert net and net[0]["status"] == 200, net
    ocr = json.loads(tool("safari_ocr", tabId=tab, query="4711"))
    assert ocr["lines"], ocr
    hit = ocr["lines"][0]
    tool("safari_click", tabId=tab, x=hit["cx"], y=hit["cy"])
    out = json.loads(tool("safari_eval", tabId=tab, code="document.getElementById('out').textContent"))["value"]
    cx, cy = [int(v) for v in out.split("canvas@")[1].split(";")[0].split(",")]
    assert 20 <= cx <= 400 and 10 <= cy <= 90, (hit, out)  # the click landed on the recognised text
    assert json.loads(tool("safari_eval_page", tabId=tab, code="window.pageSecret + 1"))["value"] == 42
    assert json.loads(tool("safari_eval_page", tabId=tab, code="await new Promise((r) => setTimeout(r, 50)); return [typeof console.warn, document.title]"))["value"] == ["function", "feature test"]
    assert json.loads(tool("safari_eval", tabId=tab, code="typeof pageSecret"))["value"] == "undefined"  # isolated world cannot see it
    bad = rpc("tools/call", {"name": "safari_eval_page", "arguments": {"tabId": tab, "code": "throw new Error('boom-page')"}})["result"]
    assert bad.get("isError") and "boom-page" in bad["content"][0]["text"], bad
    for _ in range(10):
        fl = json.loads(tool("safari_frames", tabId=tab))
        child = [f for f in fl if ":18767" in f["url"]]
        if child:
            break
        time.sleep(1)
    assert child, fl
    fid = child[0]["frameId"]
    tree = json.loads(tool("safari_read_page", tabId=tab, frame=fid))["tree"]
    assert "Blank Btn" in tree, tree
    tool("safari_click", tabId=tab, frame=fid, ref=tree.splitlines()[0].split("[")[1].split("]")[0])
    assert "clicked-ok" in json.loads(tool("safari_get_text", tabId=tab, frame=fid))["text"]
    one = image("safari_screenshot", tabId=tab)
    full = image("safari_fullpage_screenshot", tabId=tab)
    assert full.height > one.height * 1.3, (one.size, full.size)  # taller than one viewport
    full.convert("RGB").save("/tmp/claude_fullshot.jpg")  # for a manual look at the stitching
    w = json.loads(tool("safari_resize", tabId=tab, width=1100, height=800))
    assert w["width"] > 0
    print("PASS", out)
finally:
    if tab:
        try:
            tool("safari_close_tab", tabId=tab)
        except Exception:
            pass
    srv.kill()
    web.kill(); web2.kill()
