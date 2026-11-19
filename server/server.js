// Local MCP server: stdio for Claude, WebSocket (127.0.0.1) for the Safari extension.
// Several instances may run at once (one per Claude session). The first one owns the port
// ("hub") and talks to the extension; the others join the hub as clients and relay calls.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.SAFARI_CLAUDE_PORT || 18765);
const NOT_CONNECTED = "Safari extension is not connected. Open Safari and enable 'Claude for Safari' (Safari > Settings > Extensions).";
const log = (...a) => console.error("[safari-claude]", ...a);

// Access control for the local WebSocket. Web pages always send an Origin header, so only the extension's own origin is accepted
// from a browser; other local clients (MCP instances) must present the secret from ~/.claude-in-safari/token.
// shortcut: a local process of the same user can read the token or fake the extension origin, that is out of scope here.
const TOKEN_FILE = path.join(os.homedir(), ".claude-in-safari", "token");
function loadToken() {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString("hex"), { flag: "wx", mode: 0o600 }); } catch {}
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}
const TOKEN = loadToken();

let mode = null; // "hub" | "client"
let ext = null; // hub: the extension socket that gets commands (the most recent one)
const exts = new Set(); // hub: every connected extension page (there can briefly be two)
let hubWs = null; // client: socket to the hub
let seq = 0;
const pending = new Map(); // calls made by this instance
const routes = new Map(); // hub: relayed client calls, hub id -> { ws, id }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms) {
  for (let t = 0; t < ms && !cond(); t += 200) await sleep(200);
  return cond();
}
const extUp = () => ext && ext.readyState === 1;
const hubUp = () => hubWs && hubWs.readyState === 1;

function settle(m) {
  const p = pending.get(m.id);
  if (!p) return false;
  pending.delete(m.id);
  clearTimeout(p.timer);
  m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
  return true;
}

function startHub() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: PORT });
  wss.on("listening", () => { mode = "hub"; log("hub listening on 127.0.0.1:" + PORT); });
  wss.on("error", (e) => {
    if (e.code === "EADDRINUSE") joinHub();
    else log("WebSocket server error:", e.message);
  });
  wss.on("connection", (ws, req) => {
    const origin = req.headers.origin;
    const viaExtension = !!origin && origin.startsWith("safari-web-extension://");
    const token = new URL(req.url || "/", "http://x").searchParams.get("t");
    if (origin ? !viaExtension : token !== TOKEN) {
      log("rejected connection, origin=" + (origin || "none"));
      return ws.close(1008, "forbidden");
    }
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.hello === "safari") {
        if (!viaExtension) return ws.close(1008, "forbidden");
        exts.add(ws);
        ext = ws;
        log("Safari extension connected (" + exts.size + " page(s))");
        return;
      }
      if (m.ping) return ws.send(JSON.stringify({ ping: 1 }));
      if (m.method && !viaExtension) { // request relayed from a client instance
        waitFor(extUp, 6000).then((up) => {
          if (!up) return ws.readyState === 1 && ws.send(JSON.stringify({ id: m.id, error: NOT_CONNECTED }));
          const gid = ++seq;
          routes.set(gid, { ws, id: m.id });
          ext.send(JSON.stringify({ id: gid, method: m.method, params: m.params }));
        });
        return;
      }
      if (ws === ext) { // response from the extension
        const r = routes.get(m.id);
        if (r) {
          routes.delete(m.id);
          if (r.ws.readyState === 1) r.ws.send(JSON.stringify({ ...m, id: r.id }));
        } else {
          settle(m);
        }
      }
    });
    ws.on("close", () => {
      exts.delete(ws);
      if (ws === ext) ext = [...exts].pop() || null;
    });
  });
}

function joinHub() {
  mode = "client";
  const ws = new WebSocket("ws://127.0.0.1:" + PORT + "/?t=" + TOKEN);
  ws.on("open", () => { hubWs = ws; log("joined hub as client"); });
  ws.on("message", (raw) => {
    try { settle(JSON.parse(raw)); } catch {}
  });
  ws.on("error", () => {});
  ws.on("close", () => {
    hubWs = null;
    setTimeout(startHub, 300 + Math.random() * 700); // hub gone: try to become the hub
  });
}

async function call(method, params = {}, timeout = 45000) {
  await waitFor(() => mode !== null, 2000);
  if (mode === "hub") {
    if (!(await waitFor(extUp, 6000))) throw new Error(NOT_CONNECTED);
  } else if (!(await waitFor(hubUp, 3000))) {
    throw new Error("Safari bridge is starting, retry in a moment.");
  }
  const target = mode === "hub" ? ext : hubWs;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Timed out: " + method)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    target.send(JSON.stringify({ id, method, params }));
  });
}

startHub();

const text = (v) => {
  const s = v === undefined ? "ok (no data returned)" : typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return { content: [{ type: "text", text: s ?? "null" }] };
};
const run = (method) => async (args) => {
  try { return text(await call(method, args)); }
  catch (e) { return { isError: true, ...text(e.message) }; }
};

const server = new McpServer({ name: "Claude in Safari", version: "1.1.0" });
const frame = z.number().optional().describe("Frame id from safari_frames; omit for the top page (child frames are separate documents, so refs and queries apply to one frame at a time)");
const tabId = z.number().optional().describe("Tab id from safari_tabs; defaults to the active tab");

server.tool("safari_tabs", "List all open Safari tabs (id, title, url).", {}, run("tabs"));
server.tool("safari_frames", "List the iframes of a tab that have a content script (frameId, url), including cross-origin ones. Pass a frameId as frame to read_page/click/type/get_text/eval_page etc. to work inside that frame.", { tabId }, run("frames"));
server.tool("safari_new_tab", "Open a new Safari tab, optionally at a URL.", { url: z.string().optional() }, run("new_tab"));
server.tool("safari_close_tab", "Close a Safari tab.", { tabId: z.number() }, run("close_tab"));
server.tool("safari_activate_tab", "Bring a tab to the front.", { tabId: z.number() }, run("activate"));
server.tool(
  "safari_navigate",
  "Navigate a tab to a URL, wait for load, and return the visible interactive elements with refs (same as safari_read_page). Pass read=false to skip the element list.",
  { url: z.string(), tabId, read: z.boolean().optional(), filter: z.enum(["interactive", "all"]).optional() },
  run("navigate"),
);
server.tool("safari_history", "Go back or forward in tab history.", { direction: z.enum(["back", "forward"]), tabId }, run("history"));
server.tool("safari_read_page", "List visible interactive elements with refs usable by click/type. filter=all also includes headings and text blocks.", { filter: z.enum(["interactive", "all"]).optional(), query: z.string().optional().describe("Only elements whose role, name or href contains this text"), tabId, frame }, run("read_page"));
server.tool("safari_get_text", "Return the page's visible text.", { tabId, frame }, run("get_text"));
server.tool("safari_click", "Click an element by ref (from safari_read_page) or by viewport x,y. action: left (default), double, right, hover.", { ref: z.string().optional(), x: z.number().optional(), y: z.number().optional(), action: z.enum(["left", "double", "right", "hover"]).optional(), tabId, frame }, run("click"));
server.tool("safari_type", "Type text into a ref'd element or the focused one. clear=true replaces existing content.", { text: z.string(), ref: z.string().optional(), clear: z.boolean().optional(), tabId, frame }, run("type"));
server.tool("safari_key", "Press a key (e.g. Enter, Escape, Tab) on the focused element, optionally with modifiers.", { key: z.string(), modifiers: z.array(z.enum(["ctrl", "shift", "alt", "meta"])).optional(), tabId, frame }, run("key"));
server.tool("safari_form_input", "Set a form control by ref: select option (value or visible text), checkbox/radio (true/false), or text/textarea content.", { ref: z.string(), value: z.union([z.string(), z.boolean()]), tabId, frame }, run("form_input"));
server.tool("safari_wait", "Wait until the page contains text or a CSS selector matches (timeout ms, default 10000, max 30000).", { text: z.string().optional(), selector: z.string().optional(), timeout: z.number().optional(), tabId, frame }, run("wait"));
server.tool("safari_console", "Console output and page errors recorded since the page loaded (reload tabs opened before the extension started). level: log|info|warn|error|debug; filter: substring; clear empties the buffer.", { level: z.enum(["log", "info", "warn", "error", "debug"]).optional(), filter: z.string().optional(), limit: z.number().optional(), clear: z.boolean().optional(), tabId, frame }, run("console"));
server.tool("safari_network", "fetch/XHR requests made by the page since it loaded (method, url, status, ms). filter: substring of the record; clear empties the buffer.", { filter: z.string().optional(), limit: z.number().optional(), clear: z.boolean().optional(), tabId, frame }, run("network"));
server.tool("safari_ocr", "Recognise text on the tab's visible area with on-device OCR (Apple Vision, ru+en). Returns lines with boxes in viewport pixels; pass cx,cy to safari_click as x,y to click a line. query filters lines by substring.", { query: z.string().optional(), limit: z.number().optional(), tabId }, run("ocr"));
server.tool("safari_screen_point", "Convert a viewport point (x,y, e.g. cx,cy from safari_ocr) to macOS screen coordinates, for a real system click with another tool. Real click recipe: safari_activate_tab, make Safari the active app, call this and require pageFocused=true, then click the returned x,y with a system-level tool (e.g. MacOS-MCP Click). The page then receives a trusted event.", { x: z.number(), y: z.number(), tabId }, run("screen_point"));
server.tool("safari_fullpage_screenshot", "Screenshot of the whole page (scrolls and stitches; restores the scroll position). maxHeight in CSS px, default 12000. Sticky headers may repeat.", { maxHeight: z.number().optional(), tabId }, async (args) => {
  try {
    const { dataUrl } = await call("fullshot", args, 120000);
    const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl);
    return { content: [{ type: "image", data: m[2], mimeType: m[1] }] };
  } catch (e) {
    return { isError: true, ...text(e.message) };
  }
});
server.tool("safari_eval_page", "Run JavaScript in the page's own world (sees window, page variables, frameworks). code is an expression, or a function body that may use return/await. Result must be JSON-serializable. Pages whose CSP forbids eval (GitHub, for example) answer with an EvalError: use safari_eval or safari_read_page there.", { code: z.string(), timeout: z.number().optional(), tabId, frame }, run("eval_page"));
server.tool("safari_resize", "Resize the window that holds the tab.", { width: z.number(), height: z.number(), tabId }, run("resize"));
server.tool("safari_scroll", "Scroll by dx/dy pixels, or scroll a ref into view.", { dx: z.number().optional(), dy: z.number().optional(), ref: z.string().optional(), tabId, frame }, run("scroll"));
server.tool("safari_eval", "Run JavaScript in the tab (isolated content-script world); the value of the last expression is returned and must be JSON-serializable.", { code: z.string(), tabId }, run("eval"));

server.tool("safari_screenshot", "Screenshot of the tab's visible area (brings the tab to the front).", { tabId }, async (args) => {
  try {
    const { dataUrl } = await call("screenshot", args);
    return { content: [{ type: "image", data: dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" }] };
  } catch (e) {
    return { isError: true, ...text(e.message) };
  }
});

server.tool("safari_snapshot", "Accessibility-style tree of the page: landmarks, headings, text and interactive elements (with refs usable by click/type/form_input), nested by structure, including shadow DOM and same-origin iframes. Pass ref to snapshot only one subtree; limit caps the node count (default 1500).", { ref: z.string().optional(), limit: z.number().optional(), tabId, frame }, run("snapshot"));
server.tool("safari_reader", "The main article of the page as clean markdown-like text (title, byline, headings, paragraphs, lists, links), without menus, ads and comments. Falls back to the plain page text when no article is found.", { tabId }, run("reader"));
server.tool("safari_cookies", "Cookies of the tab's site (or of url). action: get (default; name filters), set (name, value, optional path/domain/secure/httpOnly/expires ISO date) or delete (name). Safari may keep showing a deleted cookie in document.cookie of the already open page in the tab that already read it (a fresh tab shows the truth). Sensitive: Claude in Safari asks you before every use.", { action: z.enum(["get", "set", "delete"]).optional(), name: z.string().optional(), value: z.string().optional(), url: z.string().optional(), path: z.string().optional(), domain: z.string().optional(), secure: z.boolean().optional(), httpOnly: z.boolean().optional(), expires: z.string().optional(), tabId }, run("cookies"));
server.tool("safari_storage", "localStorage or sessionStorage of the tab's page. area: local (default) | session; action: list (default; keys with previews), get, set or delete (key, value). Sensitive: Claude in Safari asks you before every use.", { area: z.enum(["local", "session"]).optional(), action: z.enum(["list", "get", "set", "delete"]).optional(), key: z.string().optional(), value: z.string().optional(), tabId }, run("storage"));
server.tool("safari_upload_file", "Put a file from this Mac into a page: ref of an <input type=file> (or of a drop zone). paths are absolute paths (max 20 MB each). Sensitive: Claude in Safari asks you before every use and refuses key/credential folders.", { ref: z.string(), paths: z.array(z.string()).min(1).max(10), tabId, frame }, run("upload_file"));
server.tool("safari_drag", "Drag one element onto another (by refs) or between viewport points: fires pointer, mouse and HTML5 drag events (dragstart, dragover, drop, ...), so sortable lists, kanban boards and drop zones react.", { ref: z.string().optional(), x: z.number().optional(), y: z.number().optional(), toRef: z.string().optional(), toX: z.number().optional(), toY: z.number().optional(), steps: z.number().optional(), tabId, frame }, run("drag"));
server.tool("safari_dialog", "alert/confirm/prompt dialogs. By default they stay native and block the page. action=intercept (mode accept|dismiss, promptText for prompt) makes the page answer them automatically and record them until it reloads; action=list shows the recorded ones (clear empties); action=native turns interception off.", { action: z.enum(["list", "intercept", "native"]).optional(), mode: z.enum(["accept", "dismiss"]).optional(), promptText: z.string().optional(), clear: z.boolean().optional(), tabId, frame }, run("dialog"));
server.tool("safari_screenshot_element", "Screenshot of one element by ref (scrolled into view, cropped; only the visible part if it is larger than the window). padding adds CSS pixels around it.", { ref: z.string(), padding: z.number().optional(), tabId }, async (args) => {
  try {
    const { dataUrl } = await call("screenshot_element", args);
    return { content: [{ type: "image", data: dataUrl.replace(/^data:image\/png;base64,/, ""), mimeType: "image/png" }] };
  } catch (e) {
    return { isError: true, ...text(e.message) };
  }
});
server.tool("safari_save_pdf", "Save the whole page as a PDF file (image-based pages: looks like the page, text is not selectable). path defaults to ~/Downloads/<title>.pdf; existing files are never overwritten. Available in the Swift server only.", { path: z.string().optional(), maxHeight: z.number().optional(), tabId }, async () => ({ isError: true, ...text("safari_save_pdf is available in the Swift server only") }));

await server.connect(new StdioServerTransport());
process.stdin.on("close", () => process.exit(0));
log("MCP server ready");
