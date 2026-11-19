// Claude for Safari — background page. Connects to the local MCP server over WebSocket
// and executes commands against Safari tabs.
const api = typeof browser !== "undefined" ? browser : chrome;
const PORT = 18765;
let ws;

function connect() {
  try {
    ws = new WebSocket("ws://127.0.0.1:" + PORT);
  } catch (e) {
    return setTimeout(connect, 3000);
  }
  ws.onopen = () => ws.send(JSON.stringify({ hello: "safari", version: api.runtime.getManifest().version }));
  ws.onmessage = async (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.ping) return;
    let out;
    try {
      out = { id: m.id, result: await handle(m.method, m.params || {}) };
    } catch (err) {
      out = { id: m.id, error: String((err && err.message) || err) };
    }
    ws.send(JSON.stringify(out));
  };
  ws.onclose = () => setTimeout(connect, 1000);
  ws.onerror = () => { try { ws.close(); } catch {} };
}
connect();
setInterval(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ ping: 1 })); }, 20000);

async function activeTab() {
  const [t] = await api.tabs.query({ active: true, currentWindow: true });
  if (t) return t;
  const [any] = await api.tabs.query({ active: true });
  if (!any) throw new Error("No active tab");
  return any;
}
async function resolveTab(p) {
  return p.tabId ? api.tabs.get(p.tabId) : activeTab();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (t) => ({ id: t.id, windowId: t.windowId, active: t.active, title: t.title, url: t.url });

function waitComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const done = () => { api.tabs.onUpdated.removeListener(fn); clearTimeout(timer); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const timer = setTimeout(done, timeout);
    api.tabs.onUpdated.addListener(fn);
  });
}

// Child frames report themselves (content.js frame_hello); safari_frames lists them, requests with params.frame go to that frame only.
const frames = new Map();
api.runtime.onMessage.addListener((m, sender) => {
  if (m && m.cmd === "frame_hello" && sender.tab) {
    if (!frames.has(sender.tab.id)) frames.set(sender.tab.id, new Map());
    frames.get(sender.tab.id).set(sender.frameId, m.url);
  }
});
api.tabs.onUpdated.addListener((id, info) => { if (info.status === "loading" && info.url) frames.delete(id); });
api.tabs.onRemoved.addListener((id) => frames.delete(id));

// Vision drops text on very large screenshots (seen at 2636 px wide), so OCR gets the capture scaled down to a known-good width.
// Boxes are normalised, so the scale does not affect the returned coordinates.
async function shrinkForOcr(dataUrl, maxW) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("cannot decode the screenshot")); img.src = dataUrl; });
  if (img.width <= maxW) return dataUrl.split(",")[1];
  const c = document.createElement("canvas");
  c.width = maxW; c.height = Math.round(img.height * maxW / img.width);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.92).split(",")[1];
}

async function toContent(tabId, msg) {
  const frameId = msg.params && msg.params.frame > 0 ? msg.params.frame : undefined;
  const opts = frameId === undefined ? undefined : { frameId };
  if (frameId !== undefined) msg = { ...msg, params: { ...msg.params, __frame: true } };
  const send = () => api.tabs.sendMessage(tabId, msg, opts);
  let r;
  try { r = await send(); } catch { r = undefined; }
  let lastErr = "";
  for (let i = 0; r === undefined && i < 8; i++) {
    // Content script missing (tab opened before the extension, or the page is still loading/reloading): inject and retry for a few seconds.
    try { await api.tabs.executeScript(tabId, frameId === undefined ? { file: "content.js", runAt: "document_start" } : { file: "content.js", frameId, runAt: "document_start" }); } catch (e) { lastErr = String((e && e.message) || e); }
    try { r = await send(); } catch { r = undefined; }
    if (r === undefined) await new Promise((res) => setTimeout(res, 700));
  }
  if (r === undefined) throw new Error("No response from the page (it may be navigating or restricted); retry." + (lastErr ? " [inject: " + lastErr + "]" : ""));
  if (r && r.__error) throw new Error(r.__error);
  return r;
}

async function handleInner(method, p) {
  switch (method) {
    case "tabs": {
      const tabs = await api.tabs.query({});
      return tabs.map(brief);
    }
    case "tab_info":
      return brief(await resolveTab(p));
    case "new_tab": {
      const t = await api.tabs.create({ url: p.url || "about:blank", active: true });
      if (p.url) await waitComplete(t.id);
      return brief(await api.tabs.get(t.id));
    }
    case "close_tab":
      await api.tabs.remove(p.tabId);
      return { closed: p.tabId };
    case "activate":
      await api.tabs.update(p.tabId, { active: true });
      return { activated: p.tabId };
    case "navigate": {
      const t = await resolveTab(p);
      await api.tabs.update(t.id, { url: p.url });
      await waitComplete(t.id);
      const info = brief(await api.tabs.get(t.id));
      if (p.read === false) return info;
      try {
        const page = await toContent(t.id, { method: "read_page", params: { filter: p.filter || "interactive" } });
        return { ...info, tree: page.tree };
      } catch (e) {
        return { ...info, treeError: String((e && e.message) || e) };
      }
    }
    case "history": {
      const t = await resolveTab(p);
      await api.tabs.executeScript(t.id, { code: p.direction === "forward" ? "history.forward()" : "history.back()" });
      await waitComplete(t.id, 10000);
      return brief(await api.tabs.get(t.id));
    }
    case "eval": {
      const t = await resolveTab(p);
      const r = await api.tabs.executeScript(t.id, { code: p.code });
      return { value: r && r[0] };
    }
    case "screenshot": {
      const t = await resolveTab(p);
      if (!t.active) await api.tabs.update(t.id, { active: true });
      const dataUrl = await api.tabs.captureVisibleTab(t.windowId, { format: "png" });
      return { dataUrl };
    }
    case "read_page":
    case "get_text":
    case "click":
    case "type":
    case "key":
    case "scroll":
    case "form_input":
    case "wait":
    case "console":
    case "eval_page":
    case "screen_point":
    case "snapshot":
    case "reader":
    case "upload_file":
    case "drag":
    case "dialog":
    case "network": {
      const t = await resolveTab(p);
      return toContent(t.id, { method, params: p });
    }
    case "cookies": {
      const t = await resolveTab(p);
      const url = p.url || t.url;
      if (!/^https?:/i.test(url || "")) throw new Error("cookies work on http(s) pages only");
      const a = p.action || "get";
      if (api.cookies) {
        if (a === "get") {
          const list = await api.cookies.getAll(p.name ? { url, name: p.name } : { url });
          return list.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString() : "session" }));
        }
        if (!p.name) throw new Error("name is required");
        if (a === "delete") { await api.cookies.remove({ url, name: p.name }); return { deleted: p.name }; }
        if (a === "set") {
          const d = { url, name: p.name, value: String(p.value == null ? "" : p.value) };
          if (p.path) d.path = p.path;
          if (p.domain) d.domain = p.domain;
          if (typeof p.secure === "boolean") d.secure = p.secure;
          if (typeof p.httpOnly === "boolean") d.httpOnly = p.httpOnly;
          if (p.expires) d.expirationDate = Math.floor(Date.parse(p.expires) / 1000);
          const c = await api.cookies.set(d);
          return { set: c ? c.name : p.name };
        }
        throw new Error("action must be get, set or delete");
      }
      // Fallback without the cookies API: only what scripts on the page may see (no httpOnly cookies).
      if (a === "get") {
        const raw = (await api.tabs.executeScript(t.id, { code: "document.cookie" }))[0] || "";
        return raw.split("; ").filter(Boolean).map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1) }; }).filter((c) => !p.name || c.name === p.name);
      }
      if (!p.name) throw new Error("name is required");
      const code = a === "delete"
        ? "document.cookie=" + JSON.stringify(p.name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=" + (p.path || "/")) + ";true"
        : "document.cookie=" + JSON.stringify(p.name + "=" + encodeURIComponent(String(p.value == null ? "" : p.value)) + "; path=" + (p.path || "/")) + ";true";
      await api.tabs.executeScript(t.id, { code });
      return { [a]: p.name, note: "cookies API unavailable: used document.cookie" };
    }
    case "storage": {
      const t = await resolveTab(p);
      const area = p.area === "session" ? "sessionStorage" : "localStorage";
      const a = p.action || "list";
      const arg = JSON.stringify({ area, a, key: p.key, value: p.value });
      const code = "(function(){var q=" + arg + ";var s=window[q.area];" +
        "if(q.a==='list'){var o=[];for(var i=0;i<s.length&&i<500;i++){var k=s.key(i);o.push({key:k,length:(s.getItem(k)||'').length,preview:(s.getItem(k)||'').slice(0,120)});}return o;}" +
        "if(q.a==='get'){return s.getItem(q.key);}" +
        "if(q.a==='set'){s.setItem(q.key,String(q.value==null?'':q.value));return 'set';}" +
        "if(q.a==='delete'){s.removeItem(q.key);return 'deleted';}" +
        "throw new Error('action must be list, get, set or delete');})()";
      if (a !== "list" && !p.key) throw new Error("key is required");
      const r = await api.tabs.executeScript(t.id, { code });
      return { area, value: r && r[0] };
    }
    case "screenshot_element": {
      const t = await resolveTab(p);
      if (!t.active) await api.tabs.update(t.id, { active: true });
      const rect = await toContent(t.id, { method: "element_rect", params: p });
      await sleep(250);
      const dataUrl = await api.tabs.captureVisibleTab(t.windowId, { format: "png" });
      const im = new Image(); im.src = dataUrl; await im.decode();
      const k = im.naturalWidth / rect.vw; // device pixels per CSS pixel
      const pad = Math.max(0, p.padding || 0);
      const x = Math.max(0, Math.floor((rect.x - pad) * k)), y = Math.max(0, Math.floor((rect.y - pad) * k));
      const w = Math.min(im.naturalWidth - x, Math.ceil((rect.w + 2 * pad) * k)), h = Math.min(im.naturalHeight - y, Math.ceil((rect.h + 2 * pad) * k));
      if (w < 2 || h < 2) throw new Error("The element is not visible (zero size or outside the viewport)");
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(im, x, y, w, h, 0, 0, w, h);
      return { dataUrl: cv.toDataURL("image/png"), width: w, height: h, note: rect.h > rect.vh || rect.w > rect.vw ? "element is larger than the viewport: only the visible part is captured" : undefined };
    }
    case "frames": {
      const t = await resolveTab(p);
      return [{ frameId: 0, url: t.url, top: true }, ...[...(frames.get(t.id) || [])].map(([frameId, url]) => ({ frameId, url }))];
    }
    case "fullshot": {
      // shortcut: fixed/sticky headers repeat in every frame, upgrade: hide position:fixed elements while shooting.
      const t = await resolveTab(p);
      if (!t.active) await api.tabs.update(t.id, { active: true });
      const run = async (code) => (await api.tabs.executeScript(t.id, { code }))[0];
      const m = await run("({ w: innerWidth, h: innerHeight, H: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), y: scrollY })");
      const H = Math.min(m.H, p.maxHeight || 12000);
      const shots = [];
      for (let y = 0; y < H; y += m.h) {
        await run("window.scrollTo(0, " + y + ")");
        await sleep(350);
        shots.push({ y: await run("scrollY"), url: await api.tabs.captureVisibleTab(t.windowId, { format: "png" }) });
      }
      await run("window.scrollTo(0, " + m.y + ")");
      const imgs = [];
      for (const s of shots) { const im = new Image(); im.src = s.url; await im.decode(); imgs.push(im); }
      const W = imgs[0].naturalWidth, k = W / m.w; // device pixels per CSS pixel
      const fin = Math.min(W, 1400), r = fin / W; // downscale very wide shots
      const cv = document.createElement("canvas");
      cv.width = fin;
      cv.height = Math.round(H * k * r);
      const g = cv.getContext("2d");
      imgs.forEach((im, i) => g.drawImage(im, 0, Math.round(shots[i].y * k * r), fin, Math.round(im.naturalHeight * r)));
      return { dataUrl: cv.toDataURL("image/jpeg", 0.85), pages: shots.length, height: H };
    }
    case "ocr": {
      const t = await resolveTab(p);
      if (!t.active) await api.tabs.update(t.id, { active: true });
      const dataUrl = await api.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 92 });
      const [vp] = await api.tabs.executeScript(t.id, { code: "({ w: window.innerWidth, h: window.innerHeight })" });
      const r = await api.runtime.sendNativeMessage("local.claudeinsafari", { cmd: "ocr", img: await shrinkForOcr(dataUrl, 2200) });
      if (!r || r.error) throw new Error("OCR failed: " + ((r && r.error) || "no response from the app"));
      const q = (p.query || "").toLowerCase();
      const lines = r.lines.map((l) => {
        // Vision boxes are normalised with the origin at the bottom-left; convert to viewport CSS pixels.
        const x = l.x * vp.w, w = l.w * vp.w, h = l.h * vp.h, y = (1 - l.y - l.h) * vp.h;
        return { text: l.text, conf: Math.round(l.conf * 100) / 100, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), cx: Math.round(x + w / 2), cy: Math.round(y + h / 2) };
      }).filter((l) => !q || l.text.toLowerCase().includes(q));
      return { viewport: vp, lines: lines.slice(0, p.limit || 200) };
    }
    case "resize": {
      const t = await resolveTab(p);
      const w = await api.windows.update(t.windowId, { width: p.width, height: p.height });
      return { windowId: w.id, width: w.width, height: w.height };
    }
    default:
      throw new Error("Unknown method: " + method);
  }
}


// Indicator: mark the tab Claude is working on (content.js draws a frame + label), but hide it while pixels are captured.
const NO_MARK = new Set(["tabs", "tab_info", "frames", "new_tab", "close_tab", "activate", "agent_mark"]);
const CAPTURES = new Set(["screenshot", "fullshot", "ocr", "screenshot_element"]);
async function handle(method, p) {
  if (NO_MARK.has(method)) return handleInner(method, p);
  let t = null;
  try { t = await resolveTab(p); } catch {}
  const mark = (on) => (t ? api.tabs.sendMessage(t.id, { method: "agent_mark", params: { on } }).catch(() => {}) : Promise.resolve());
  const capture = CAPTURES.has(method);
  if (capture) { await mark(false); await sleep(60); } else mark(true);
  try {
    return await handleInner(method, p);
  } finally {
    if (capture) mark(true);
  }
}
