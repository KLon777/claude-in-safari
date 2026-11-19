#!/usr/bin/env python3
"""Policy tests for the Swift server with a fake Safari extension (no Safari, no dialogs).
Usage: python3 tools/policy_test.py [/path/to/claude-safari-server]"""
import json, os, socket, subprocess, base64, struct, sys, tempfile, threading, time, shutil

SERVER = sys.argv[1] if len(sys.argv) > 1 else "claude-safari-server"
TABS = {1: "https://bank.example/login", 2: "https://news.example/a", 3: "https://www.shop.example/cart", 4: "", 5: "favorites://", 6: "file:///Users/x/a.html"}
ACTIVE = 2
fails = []

def check(name, ok, info=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  -> " + str(info)))
    if not ok: fails.append(name)

class Ws:
    def __init__(self, port, origin, token):
        self.s = socket.create_connection(("127.0.0.1", port))
        h = ("GET /?t=%s HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
             "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: %s\r\n\r\n") % (token, origin)
        self.s.sendall(h.encode()); r = b""
        while b"\r\n\r\n" not in r: r += self.s.recv(1024)
    def send(self, o):
        d = json.dumps(o, ensure_ascii=False).encode(); m = os.urandom(4); n = len(d)
        hdr = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n))
        self.s.sendall(hdr + m + bytes(b ^ m[i % 4] for i, b in enumerate(d)))
    def rd(self, n):
        b = b""
        while len(b) < n:
            c = self.s.recv(n - len(b))
            if not c: raise EOFError
            b += c
        return b
    def recv(self):
        b1, b2 = self.rd(2); n = b2 & 0x7f
        if n == 126: n = struct.unpack(">H", self.rd(2))[0]
        return json.loads(self.rd(n))

def fake_extension(ws, broken_tab_info):
    def run():
        try:
            while True:
                m = ws.recv()
                if m.get("ping"): continue
                meth, p = m["method"], m.get("params", {})
                tid = p.get("tabId") or ACTIVE
                if meth == "tabs": res = [{"id": i, "title": "T%d" % i, "url": u, "active": i == ACTIVE} for i, u in TABS.items()]
                elif meth == "tab_info":
                    if broken_tab_info: ws.send({"id": m["id"], "error": "unknown method"}); continue
                    res = {"id": tid, "url": TABS[tid], "title": "T"}
                elif meth in ("new_tab", "navigate"):
                    u = p.get("url", "")
                    res = {"id": 9, "url": TABS[1] if u.endswith("/redirect") else u, "title": "N"}
                else: res = {"ok": True, "method": meth, "tab": tid}
                ws.send({"id": m["id"], "result": res})
        except Exception: pass
    threading.Thread(target=run, daemon=True).start()

class Srv:
    """One server instance with its own HOME (policy file, token) and port."""
    count = 0
    def __init__(self, policy, answer=None, broken_tab_info=False):
        Srv.count += 1
        self.port = 19300 + Srv.count + (os.getpid() % 500)
        self.home = tempfile.mkdtemp(prefix="cis-policy-")
        os.makedirs(self.home + "/.claude-in-safari")
        if policy is not None:
            with open(self.home + "/.claude-in-safari/policy.json", "w") as f: f.write(policy if isinstance(policy, str) else json.dumps(policy))
        env = dict(os.environ, HOME=self.home, SAFARI_CLAUDE_PORT=str(self.port))
        if answer: env["CIS_CONFIRM_ANSWER"] = answer
        self.p = subprocess.Popen([SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)
        self.id = 0
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
        time.sleep(0.6)
        token = open(self.home + "/.claude-in-safari/token").read().strip()
        self.ws = Ws(self.port, "safari-web-extension://test", token)
        self.ws.send({"hello": "safari"}); time.sleep(0.3)
        fake_extension(self.ws, broken_tab_info)
    def rpc(self, method, params):
        self.id += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.id, "method": method, "params": params}) + "\n"); self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())
    def tool(self, name, **args):
        r = self.rpc("tools/call", {"name": name, "arguments": args})["result"]
        return bool(r.get("isError")), r["content"][0].get("text", "")
    def close(self):
        self.p.kill(); shutil.rmtree(self.home, ignore_errors=True)

def main():
    # 1. no policy: everything passes
    s = Srv({"blocked": [], "confirm": [], "confirmAll": False})
    e, t = s.tool("safari_click", tabId=1, ref="1"); check("empty policy: click allowed", not e, t); s.close()

    # 2. blocked hosts
    s = Srv({"blocked": ["bank.example", "*.shop.example"]})
    e, t = s.tool("safari_click", tabId=1, ref="1"); check("blocked tab: click refused", e and "Blocked by policy" in t, t)
    e, t = s.tool("safari_get_text", tabId=1); check("blocked tab: read refused", e and "Blocked by policy" in t, t)
    e, t = s.tool("safari_screenshot", tabId=1); check("blocked tab: screenshot refused", e, t)
    e, t = s.tool("safari_click", tabId=2, ref="1"); check("other tab: click allowed", not e, t)
    e, t = s.tool("safari_get_text"); check("active tab (news): read allowed", not e, t)
    e, t = s.tool("safari_click", tabId=3, ref="1"); check("subdomain pattern *.shop.example blocks www.shop.example", e, t)
    e, t = s.tool("safari_tabs"); tabs = json.loads(t)
    check("tabs: blocked tab redacted", tabs[0]["url"] == "[blocked by policy]" and tabs[0]["title"] == "[blocked by policy]", tabs[0])
    check("tabs: allowed tab intact", tabs[1]["url"] == TABS[2], tabs[1])
    check("tabs: id of blocked tab kept", tabs[0]["id"] == 1)
    e, t = s.tool("safari_new_tab", url="https://www.bank.example/x"); check("new_tab to blocked host refused (subdomain)", e and "Blocked" in t, t)
    e, t = s.tool("safari_navigate", url="https://bank.example", tabId=2); check("navigate to blocked host refused", e, t)
    e, t = s.tool("safari_navigate", url="https://ok.example/", tabId=2, read=False); check("navigate to allowed host ok", not e, t)
    e, t = s.tool("safari_navigate", url="https://ok.example/redirect", tabId=2, read=False)
    check("navigate that ends on a blocked host: content discarded", e is False and "Blocked by policy" in t and "bank.example/login" not in t.split("blocked site")[0], t)
    s.close()

    # 2b. tabs whose address Safari hides are refused; hostless pages (start page) are fine
    s = Srv({"blocked": ["bank.example"]})
    e, t = s.tool("safari_get_text", tabId=4); check("hidden-address tab refused", e and "hidden by Safari" in t, t)
    e, t = s.tool("safari_get_text", tabId=5); check("start page (favorites://) allowed", not e, t); s.close()

    # 2c. hostless pages are matched by scheme; "*" covers them too
    s = Srv({"blocked": ["file:"]})
    e, t = s.tool("safari_get_text", tabId=6); check("blocked file: refuses local files", e and "Blocked" in t, t)
    e, t = s.tool("safari_get_text", tabId=5); check("blocked file: start page still allowed", not e, t); s.close()
    s = Srv({"blocked": ["*"]})
    e, t = s.tool("safari_get_text", tabId=6); check('blocked "*" refuses local files', e and "Blocked" in t, t)
    e, t = s.tool("safari_get_text", tabId=5); check('blocked "*" refuses start page', e and "Blocked" in t, t); s.close()
    s = Srv({"confirm": ["file:"]}, answer="deny")
    e, t = s.tool("safari_click", tabId=6, ref="1"); check("confirm file: asks for local files", e and "Refused by the user" in t, t)
    e, t = s.tool("safari_click", tabId=5, ref="1"); check("confirm file: start page not asked", not e, t); s.close()

    # 3. confirmations (dialog replaced by CIS_CONFIRM_ANSWER)
    s = Srv({"confirm": ["news.example"]}, answer="deny")
    e, t = s.tool("safari_click", tabId=2, ref="1"); check("confirm host, answer deny: click refused", e and "Refused by the user" in t, t)
    e, t = s.tool("safari_type", tabId=2, ref="1", text="hi"); check("confirm host, answer deny: type refused", e, t)
    e, t = s.tool("safari_get_text", tabId=2); check("confirm host: read-only tool not asked", not e, t)
    e, t = s.tool("safari_click", tabId=1, ref="1"); check("host not in confirm list: no question", not e, t)
    s.close()
    s = Srv({"confirm": ["news.example"]}, answer="once")
    e, t = s.tool("safari_click", tabId=2, ref="1"); check("confirm host, answer once: allowed", not e, t); s.close()
    s = Srv({"confirm": ["news.example"]}, answer="site")
    e, t = s.tool("safari_eval", tabId=2, code="1"); check("confirm host, answer site: allowed", not e, t)
    e, t = s.tool("safari_eval", tabId=2, code="2"); check("confirm host, answer site: still allowed", not e, t); s.close()
    s = Srv({"confirmAll": True}, answer="deny")
    e, t = s.tool("safari_click", tabId=1, ref="1"); check("confirmAll deny: click refused anywhere", e, t)
    e, t = s.tool("safari_screenshot", tabId=1); check("confirmAll: screenshot not asked", not e, t)
    e, t = s.tool("safari_tabs"); check("confirmAll: tabs not asked", not e, t); s.close()

    # 4. blocked wins over confirm; broken policy and broken tab_info fail closed
    s = Srv({"blocked": ["news.example"], "confirm": ["news.example"]}, answer="once")
    e, t = s.tool("safari_click", tabId=2, ref="1"); check("blocked wins over confirm", e and "Blocked" in t, t); s.close()
    s = Srv("{ not json")
    e, t = s.tool("safari_click", tabId=2, ref="1"); check("broken policy.json: tool refused", e and "not valid JSON" in t, t); s.close()
    s = Srv({"blocked": ["bank.example"]}, broken_tab_info=True)
    e, t = s.tool("safari_click", tabId=2, ref="1"); check("tab_info failing: refused (fail closed)", e and "could not be checked" in t, t)
    e, t = s.tool("safari_tabs"); check("tab_info failing: tabs still listed (redacted)", not e, t); s.close()

    # 5. policy file is created with safe defaults and a live edit takes effect without restart
    s = Srv(None)
    e, t = s.tool("safari_click", tabId=1, ref="1"); check("no policy file: allowed", not e, t)
    path = s.home + "/.claude-in-safari/policy.json"
    check("policy.json created on first use", os.path.exists(path) and (os.stat(path).st_mode & 0o777) == 0o600)
    with open(path, "w") as f: f.write('{"blocked": ["bank.example"]}')
    e, t = s.tool("safari_click", tabId=1, ref="1"); check("live edit: now blocked", e and "Blocked" in t, t); s.close()

    print("\n%d failed" % len(fails) if fails else "\nALL OK")
    sys.exit(1 if fails else 0)

main()
