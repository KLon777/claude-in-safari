// Runs in the page's own world (manifest "world": "MAIN"), so page CSP cannot block it. Hooks console/errors/fetch/XHR and
// reports through window.postMessage; capture.js (isolated world) buffers the reports.
(() => {
  // capture.js runs first and defines __claudeBuf in the isolated world: if it is visible here, "world": "MAIN" was ignored and this
  // file landed in the isolated world, so do nothing (capture.js then falls back to inline injection).
  if (window.__claudeBuf) return;
  if (window.__claudeInjected) return;
  window.__claudeInjected = true;
  window.postMessage({ __claudeSafari: 1, kind: "hook-ready", data: {} }, "*");
  const send = (kind, data) => window.postMessage({ __claudeSafari: 1, kind, data }, "*");
  const str = (v) => {
    try { return typeof v === "string" ? v : v instanceof Error ? v.stack || String(v) : JSON.stringify(v); } catch { return String(v); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level];
    console[level] = function (...a) {
      send("console", { level, text: a.map(str).join(" ").slice(0, 2000) });
      return orig.apply(this, a);
    };
  }
  addEventListener("error", (e) => send("console", { level: "error", text: e.message + " (" + e.filename + ":" + e.lineno + ")" }));
  addEventListener("unhandledrejection", (e) => send("console", { level: "error", text: "Unhandled rejection: " + str(e.reason) }));

  const f = window.fetch;
  window.fetch = function (input, init) {
    const url = String(typeof input === "string" ? input : input.url).slice(0, 500);
    const method = (init && init.method) || (input && input.method) || "GET";
    const t0 = Date.now();
    return f.apply(this, arguments).then(
      (r) => { send("network", { method, url, status: r.status, ms: Date.now() - t0 }); return r; },
      (e) => { send("network", { method, url, status: "error", error: String(e), ms: Date.now() - t0 }); throw e; },
    );
  };
  const open = XMLHttpRequest.prototype.open;
  const xsend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__claude = { method, url: String(url).slice(0, 500) };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const t0 = Date.now();
    this.addEventListener("loadend", () => this.__claude && send("network", { ...this.__claude, status: this.status || "error", ms: Date.now() - t0 }));
    return xsend.apply(this, arguments);
  };

  // safari_dialog: off by default (the page's own alert/confirm/prompt run natively). When content.js turns interception on,
  // dialogs do not block: they are recorded and answered by mode ("accept" or "dismiss"). Resets when the page reloads.
  let dlg = null;
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || !d.__claudeDialogCfg) return;
    dlg = d.mode === "accept" || d.mode === "dismiss" ? { mode: d.mode, promptText: d.promptText } : null;
  });
  const nAlert = window.alert, nConfirm = window.confirm, nPrompt = window.prompt;
  const msg = (m) => String(m === undefined ? "" : m).slice(0, 1000);
  window.alert = function (m) {
    if (!dlg) return nAlert.apply(this, arguments);
    send("dialog", { type: "alert", message: msg(m), answer: "ok" });
  };
  window.confirm = function (m) {
    if (!dlg) return nConfirm.apply(this, arguments);
    const a = dlg.mode === "accept";
    send("dialog", { type: "confirm", message: msg(m), answer: a });
    return a;
  };
  window.prompt = function (m, def) {
    if (!dlg) return nPrompt.apply(this, arguments);
    const a = dlg.mode === "accept" ? (typeof dlg.promptText === "string" ? dlg.promptText : def == null ? "" : String(def)) : null;
    send("dialog", { type: "prompt", message: msg(m), default: def == null ? null : String(def), answer: a });
    return a;
  };

  // safari_eval_page: content.js posts the code, it runs here in the page's own world and the result goes back the same way.
  // shortcut: pages whose CSP forbids eval (no 'unsafe-eval') answer with an EvalError; no way around that without the page's consent.
  window.addEventListener("message", async (e) => {
    const d = e.data;
    if (e.source !== window || !d || !d.__claudeEvalReq) return;
    const reply = (o) => window.postMessage({ __claudeEval: d.id, ...o }, "*");
    try {
      const AF = Object.getPrototypeOf(async function () {}).constructor;
      let f;
      try { f = new AF("return (" + d.code + ")"); } catch (err) { f = new AF(d.code); }
      const v = await f();
      let j;
      try { j = JSON.stringify(v); } catch (err) { j = JSON.stringify(String(v)); }
      reply({ json: j });
    } catch (err) { reply({ error: err && err.message ? err.name + ": " + err.message : String(err) }); }
  });
})();
