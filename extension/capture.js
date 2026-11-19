// Content script at document_start: buffers what page-hook.js (MAIN world) reports about console/errors/fetch/XHR. content.js shares this isolated world and reads window.__claudeBuf.
(() => {
  if (window.__claudeBuf) return;
  let hooked = false;
  const api = typeof browser !== "undefined" ? browser : chrome;
  const buf = (window.__claudeBuf = { console: [], network: [] });
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.__claudeSafari !== 1) return;
    if (d.kind === "hook-ready") { hooked = true; return; }
    if (!buf[d.kind]) return;
    buf[d.kind].push({ t: Date.now(), ...d.data });
    if (buf[d.kind].length > 500) buf[d.kind].shift();
  });

  // Fallback for a Safari without "world": "MAIN": inject the same code inline (blocked by strict page CSP).
  setTimeout(async () => {
    if (hooked) return;
    const src = await fetch(api.runtime.getURL("page-hook.js")).then((r) => r.text());
    const s = document.createElement("script");
    s.textContent = src;
    (document.documentElement || document).appendChild(s);
    s.remove();
  }, 0);
})();
