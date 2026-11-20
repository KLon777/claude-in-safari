#!/usr/bin/env python3
"""Live self-check for the 1.1.0 tools: snapshot, reader, screenshot_element, save_pdf, drag, dialog, upload_file, cookies, storage
and the working-tab indicator. Needs Safari with the extension enabled and the Swift server (SERVER_CMD=/path/to/claude-safari-server).
  python3 -u tools/feature_test_110.py          # local test page only
  python3 -u tools/feature_test_110.py --real   # plus a few real sites (needs internet)
Sensitive tools would open a confirmation dialog; the test answers them itself through CIS_CONFIRM_ANSWER=once."""
import base64, io, json, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = "--real" in sys.argv
if not os.environ.get("SERVER_CMD"):
    sys.exit("Set SERVER_CMD to the Swift server binary (the Node reference server has no 1.1.0 extras).")
web = subprocess.Popen([sys.executable, "-m", "http.server", "18766", "--bind", "127.0.0.1"], cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
srv = subprocess.Popen(os.environ["SERVER_CMD"].split(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                       env=dict(os.environ, CIS_CONFIRM_ANSWER="once"))
n = 0
results = []


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


def call(_tool, /, **a):
    return rpc("tools/call", {"name": _tool, "arguments": a})["result"]


def tool(_tool, /, **a):
    r = call(_tool, **a)
    text = r["content"][0]["text"]
    assert not r.get("isError"), f"{_tool} failed: {text}"
    return text


def jtool(_tool, /, **a):
    return json.loads(tool(_tool, **a))


def image(_tool, /, **a):
    from PIL import Image
    c = call(_tool, **a)["content"][0]
    assert c["type"] == "image", c
    return Image.open(io.BytesIO(base64.b64decode(c["data"])))


ONLY = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--only=")), "")  # run only checks whose label contains this


def check(label, fn):
    if ONLY and ONLY not in label and not label.startswith("local-setup"):
        return
    before = len(tabs)
    try:
        fn()
        results.append((label, None))
        print("PASS", label, flush=True)
    except Exception as e:
        results.append((label, e))
        import traceback
        line = [f for f in traceback.extract_tb(e.__traceback__) if f.filename.endswith("feature_test_110.py")][-1]
        print("FAIL", label, "->", repr(e)[:300], "(line %d: %s)" % (line.lineno, (line.line or "")[:120]), flush=True)
    for tb in tabs[max(before, 1):]:
        try:
            tool("safari_close_tab", tabId=tb)
        except Exception:
            pass
    del tabs[max(before, 1):]


def ref_of(tab, query):
    tree = jtool("safari_read_page", tabId=tab, query=query)["tree"]
    return tree.splitlines()[0].split("[")[1].split("]")[0]


def center(tab, selector):
    v = jtool("safari_eval_page", tabId=tab, code="const b=document.querySelector(%s).getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}" % json.dumps(selector))["value"]
    return v["x"], v["y"]


def page_text(tab, sel="#out"):
    return jtool("safari_eval_page", tabId=tab, code="document.querySelector(%s).textContent" % json.dumps(sel))["value"]


def wait(tab, **kw):
    for attempt in (1, 2):
        try:
            return tool("safari_wait", tabId=tab, **kw)
        except AssertionError as e:
            print("   wait attempt %d failed on tab %s %s: %s" % (attempt, tab, kw, str(e)[:80]), flush=True)
            if attempt == 2:
                raise


def open_tab(url):
    t = jtool("safari_new_tab", url=url)["id"]
    time.sleep(1.0)
    return t


tabs = []
upload = os.path.join(tempfile.gettempdir(), "cis-upload-test.txt")
open(upload, "w").write("hello-upload\n")
pdf_dir = tempfile.mkdtemp(prefix="cis-pdf-", dir=os.path.expanduser("~"))
try:
    rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "ft110", "version": "0"}})
    rpc("notifications/initialized", notify=True)
    time.sleep(3)
    names = [t["name"] for t in rpc("tools/list")["result"]["tools"]]
    for want in ("safari_snapshot", "safari_reader", "safari_cookies", "safari_storage", "safari_upload_file", "safari_drag", "safari_dialog", "safari_screenshot_element", "safari_save_pdf"):
        assert want in names, "tool missing: " + want

    # ---------- local page ----------
    t = open_tab("http://127.0.0.1:18766/test_page2.html?t=%d" % time.time())
    tabs.append(t)
    wait(t, text="Reader Heading")

    def snapshot():
        tree = jtool("safari_snapshot", tabId=t)["tree"]
        assert "- navigation" in tree and "heading \"Reader Heading\" level=1" in tree and "textbox \"File input\"" in tree, tree
        ref = tree.split("button \"Dialog\" [")[1].split("]")[0]
        sub = jtool("safari_snapshot", tabId=t, ref=ref)["tree"]
        assert sub.startswith("- button") and "Reader Heading" not in sub, sub
        small = jtool("safari_snapshot", tabId=t, limit=3)["tree"]
        assert "truncated" in small, small
    check("snapshot: tree, subtree by ref, limit", snapshot)

    def reader():
        r = jtool("safari_reader", tabId=t)
        assert r["text"].startswith("# Reader Heading") and "[link inside](" in r["text"] and "**bold text**" in r["text"], r
        assert "Menu link" not in r["text"], r
    check("reader: article without menu, links and bold kept", reader)

    def element_shot():
        img = image("safari_screenshot_element", tabId=t, ref=ref_of(t, "Dialog"), padding=4)
        assert 30 < img.width < 400 and 15 < img.height < 200, img.size
    check("screenshot_element: small crop around the button", element_shot)

    def indicator():
        # the mark is shown while a command runs; a plain screenshot must not contain it (it is hidden during captures)
        tool("safari_get_text", tabId=t)
        host = jtool("safari_eval_page", tabId=t, code="[...document.documentElement.children].filter(e => e.style && e.style.zIndex === '2147483647').map(e => getComputedStyle(e).display)")["value"]
        assert host == ["block"], host
        img = image("safari_screenshot", tabId=t).convert("RGB")
        px = [img.getpixel((2, img.height // 2)), img.getpixel((img.width // 2, 1))]
        assert all(not (p[0] > 230 and 130 < p[1] < 190 and p[2] < 60) for p in px), px  # no amber frame pixels in the capture
    check("indicator: shown while working, absent from screenshots", indicator)

    def drag_local():
        (ax, ay), (bx, by) = center(t, "#drag"), center(t, "#drop")
        assert "dragged" in tool("safari_drag", tabId=t, x=ax, y=ay, toX=bx, toY=by)
        out = page_text(t)
        assert "dragstart" in out and "drop" in out, out
    check("drag: HTML5 dragstart + drop", drag_local)

    def dialogs():
        assert "intercepting" in tool("safari_dialog", tabId=t, action="intercept", mode="accept", promptText="Claude")
        tool("safari_click", tabId=t, ref=ref_of(t, "Dialog"))
        out = page_text(t)
        assert "confirm=true" in out and "prompt=Claude" in out and "after-alert" in out, out
        rec = jtool("safari_dialog", tabId=t, action="list")
        assert [r["type"] for r in rec] == ["confirm", "prompt", "alert"], rec
        assert jtool("safari_dialog", tabId=t, action="list", clear=True) and jtool("safari_dialog", tabId=t, action="list") == []
        assert "native" in tool("safari_dialog", tabId=t, action="native")
    check("dialog: intercept/accept, record, list, clear, native", dialogs)

    def uploads():
        assert "attached" in tool("safari_upload_file", tabId=t, ref=ref_of(t, "File input"), paths=[upload])
        assert "file=cis-upload-test.txt:13" in page_text(t), page_text(t)
        bad = call("safari_upload_file", tabId=t, ref="1", paths=[os.path.expanduser("~/.ssh/id_rsa")])
        assert bad.get("isError") and "protected" in bad["content"][0]["text"], bad
    check("upload_file: file reaches the input; ~/.ssh refused", uploads)

    def hidden_uploads():
        tree = jtool("safari_snapshot", tabId=t)["tree"].splitlines()
        hid = [l for l in tree if "type=file" in l and "hidden" in l]
        assert hid, "the hidden file input is not listed by the snapshot"
        # through the visible button-like element that has no file input of its own: the tool must find the input next to it
        r = tool("safari_upload_file", tabId=t, ref=ref_of(t, "Pick an image"), paths=[upload])
        assert "attached" in r and "hidden input" in r, r
        assert "hidden=cis-upload-test.txt:13" in page_text(t), page_text(t)
        # and directly through the ref of the hidden input
        href = hid[0].split("[")[1].split("]")[0]
        assert "attached" in tool("safari_upload_file", tabId=t, ref=href, paths=[upload])
    check("upload_file: hidden input behind a menu item (found via the element or its own ref)", hidden_uploads)

    def data():
        ck = jtool("safari_cookies", tabId=t)
        assert any(c["name"] == "tc" and c["value"] == "cv" for c in ck), ck
        tool("safari_cookies", tabId=t, action="set", name="cis_t", value="1")
        assert jtool("safari_cookies", tabId=t, name="cis_t")[0]["value"] == "1"
        for _ in range(10):  # WebKit refreshes document.cookie in the page process a moment after the store changes
            if "cis_t=1" in jtool("safari_eval_page", tabId=t, code="document.cookie")["value"]:
                break
            time.sleep(0.5)
        else:
            raise AssertionError("document.cookie never showed the new cookie")
        tool("safari_cookies", tabId=t, action="delete", name="cis_t")
        assert jtool("safari_cookies", tabId=t, name="cis_t") == []
        # Safari keeps showing a deleted cookie in document.cookie of the tab that already read it; a fresh tab shows the truth
        fresh = open_tab("http://127.0.0.1:18766/test_page2.html?c=%d" % time.time())
        tabs.append(fresh)
        assert "cis_t" not in jtool("safari_eval_page", tabId=fresh, code="document.cookie")["value"]
        assert jtool("safari_storage", tabId=t, action="get", key="lskey")["value"] == "lsval"
        assert jtool("safari_storage", tabId=t, area="session", action="get", key="sskey")["value"] == "ssval"
        tool("safari_storage", tabId=t, action="set", key="k2", value="v2")
        assert any(r["key"] == "k2" for r in jtool("safari_storage", tabId=t)["value"])
        tool("safari_storage", tabId=t, action="delete", key="k2")
        assert not any(r["key"] == "k2" for r in jtool("safari_storage", tabId=t)["value"])
    check("cookies + storage: get/set/delete round trip", data)

    def pdf_local():
        path = os.path.join(pdf_dir, "local.pdf")
        r = jtool("safari_save_pdf", tabId=t, path=path)
        assert r["saved"] == path and open(path, "rb").read(5) == b"%PDF-", r
        r2 = jtool("safari_save_pdf", tabId=t, path=path)
        assert r2["saved"].endswith("local 2.pdf"), r2  # never overwrites
    check("save_pdf: file written, second save does not overwrite", pdf_local)

    # ---------- real sites ----------
    if REAL:
        def wiki():
            w = open_tab("https://en.wikipedia.org/wiki/Safari_(web_browser)")
            tabs.append(w)
            wait(w, text="WebKit", timeout=15000)
            r = jtool("safari_reader", tabId=w)
            assert not r.get("fallback") and r["length"] > 3000 and "WebKit" in r["text"], ("reader", r.get("fallback"), r["length"])
            assert "Navigation menu" not in r["text"] and "Edit links" not in r["text"], "menus leaked into the article"
            snap = jtool("safari_snapshot", tabId=w, limit=400)["tree"]
            assert "heading" in snap and "link" in snap, snap[:300]
            infobox = ref_of(w, "WebKit")  # a link inside the intro paragraph
            img = image("safari_screenshot_element", tabId=w, ref=infobox)
            assert img.width > 20 and img.height > 8, img.size
            path = os.path.join(pdf_dir, "wiki.pdf")
            p = jtool("safari_save_pdf", tabId=w, path=path, maxHeight=4000)
            assert p["pages"] >= 2 and os.path.getsize(path) > 50000, ("pdf", p)
        check("wikipedia: reader (long article), snapshot, element shot, multi-page PDF", wiki)

        def example():
            e = open_tab("https://example.com/")
            tabs.append(e)
            wait(e, text="documentation examples", timeout=20000)
            r = jtool("safari_reader", tabId=e)
            assert "documentation examples" in r["text"] and r["title"] == "Example Domain", r
            snap = jtool("safari_snapshot", tabId=e)["tree"]
            assert "documentation examples" in snap and "link" in snap, snap
            assert isinstance(jtool("safari_cookies", tabId=e), list)
        check("example.com: reader fallback/short page, snapshot, cookies call", example)

        def github():
            g = open_tab("https://github.com/KLon777/claude-in-safari")
            tabs.append(g)
            wait(g, text="claude-in-safari", timeout=20000)
            snap = jtool("safari_snapshot", tabId=g, limit=800)["tree"]
            assert "navigation" in snap and "link" in snap and "claude-in-safari" in snap, snap[:300]
            r = jtool("safari_reader", tabId=g)
            assert r["length"] > 500 and ("Safari" in r["text"]), r["length"]
            st = jtool("safari_storage", tabId=g)
            assert "value" in st, st
        check("github: snapshot with landmarks, reader on the README, storage list", github)

        def alerts():
            a = open_tab("https://the-internet.herokuapp.com/javascript_alerts")
            tabs.append(a)
            wait(a, text="JavaScript Alerts", timeout=20000)
            tool("safari_dialog", tabId=a, action="intercept", mode="accept", promptText="Claude")
            for q in ("JS Alert", "JS Confirm", "JS Prompt"):
                tool("safari_click", tabId=a, ref=ref_of(a, q))
            res = page_text(a, "#result")
            assert "Claude" in res, res
            assert [r["type"] for r in jtool("safari_dialog", tabId=a, action="list")] == ["alert", "confirm", "prompt"]
            tool("safari_dialog", tabId=a, action="intercept", mode="dismiss")
            tool("safari_click", tabId=a, ref=ref_of(a, "JS Confirm"))
            assert "Cancel" in page_text(a, "#result"), page_text(a, "#result")
        check("the-internet: alert/confirm/prompt accepted and dismissed", alerts)

        def dnd():
            d = open_tab("https://the-internet.herokuapp.com/drag_and_drop")
            tabs.append(d)
            wait(d, selector="#column-a", timeout=20000)
            before = page_text(d, "#column-a header")
            (ax, ay), (bx, by) = center(d, "#column-a"), center(d, "#column-b")
            tool("safari_drag", tabId=d, x=ax, y=ay, toX=bx, toY=by)
            assert page_text(d, "#column-a header") != before, "columns did not swap"
        check("the-internet: HTML5 drag and drop swaps the columns", dnd)

        def up():
            u = open_tab("https://the-internet.herokuapp.com/upload")
            tabs.append(u)
            wait(u, selector="#file-upload", timeout=15000)
            lines = jtool("safari_snapshot", tabId=u)["tree"].splitlines()
            rid = lambda l: l.split("[")[1].split("]")[0]
            fref = rid([l for l in lines if "type=file" in l][0])
            bref = rid([l for l in lines if "type=submit" in l][0])
            tool("safari_upload_file", tabId=u, ref=fref, paths=[upload])
            tool("safari_click", tabId=u, ref=bref)
            # the click submits a form and replaces the document: poll the new one instead of waiting inside the old one
            end = time.time() + 25
            last = ""
            while time.time() < end:
                time.sleep(1.5)
                try:
                    last = jtool("safari_get_text", tabId=u).get("text", "")
                    if "File Uploaded" in last:
                        break
                except AssertionError as e:
                    last = "ERR " + str(e)[:120]
            else:
                raise AssertionError("File Uploaded never appeared; last page text: %r" % last[:200])
            assert "cis-upload-test.txt" in page_text(u, "#uploaded-files"), page_text(u, "#uploaded-files")
        check("the-internet: real server receives the uploaded file", up)

        def cookies_real():
            c = open_tab("https://the-internet.herokuapp.com/")
            tabs.append(c)
            tool("safari_cookies", tabId=c, action="set", name="cis_real", value="42")
            assert any(x["name"] == "cis_real" and x["value"] == "42" for x in jtool("safari_cookies", tabId=c, name="cis_real"))
            tool("safari_cookies", tabId=c, action="delete", name="cis_real")
            assert jtool("safari_cookies", tabId=c, name="cis_real") == []
        check("the-internet: cookies set/filter/delete on a https site", cookies_real)
finally:
    for tb in tabs:
        try:
            tool("safari_close_tab", tabId=tb)
        except Exception:
            pass
    srv.kill(); web.kill()
    import shutil
    shutil.rmtree(pdf_dir, ignore_errors=True)
    try:
        os.remove(upload)
    except OSError:
        pass

bad = [(l, e) for l, e in results if e]
print("\n%d checks, %d failed" % (len(results), len(bad)))
sys.exit(1 if bad else 0)
