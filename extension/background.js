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
  let r;
  try { r = await api.tabs.sendMessage(tabId, msg, opts); } catch { r = undefined; }
  if (r === undefined) {
    // Content script missing (tab opened before the extension, or the page is reloading): inject and retry.
    await api.tabs.executeScript(tabId, frameId === undefined ? { file: "content.js" } : { file: "content.js", frameId });
    r = await api.tabs.sendMessage(tabId, msg, opts);
  }
  if (r === undefined) throw new Error("No response from the page (it may be navigating or restricted); retry.");
  if (r && r.__error) throw new Error(r.__error);
  return r;
}

async function handle(method, p) {
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
    case "network": {
      const t = await resolveTab(p);
      return toContent(t.id, { method, params: p });
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
