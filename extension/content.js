// Claude for Safari — content script: page reading and input actions.
(() => {
  if (window.__claudeSafari) return;
  window.__claudeSafari = true;
  const api = typeof browser !== "undefined" ? browser : chrome;

  const byId = new Map();
  const ids = new WeakMap();
  let counter = 0;
  const refOf = (el) => {
    let id = ids.get(el);
    if (!id) { id = "ref_" + ++counter; ids.set(el, id); byId.set(id, el); }
    return id;
  };

  const INTERACTIVE = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem],[role=option],[role=switch],[contenteditable=''],[contenteditable=true],[onclick],[tabindex]:not([tabindex='-1'])";

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }
  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === "a") return "link";
    if (t === "input") return el.type === "checkbox" || el.type === "radio" ? el.type : el.type === "submit" || el.type === "button" ? "button" : "textbox";
    if (t === "textarea") return "textbox";
    if (t === "select") return "combobox";
    if (/^h[1-6]$/.test(t)) return "heading";
    return t;
  }
  function nameOf(el) {
    const s = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("alt") || el.getAttribute("title") || el.value && el.tagName !== "TEXTAREA" && el.type !== "password" && el.value || el.innerText || el.textContent || "";
    return s.replace(/\s+/g, " ").trim().slice(0, 100);
  }

  // Elements matching sel in the document, its open shadow roots and same-origin iframes.
  // shortcut: closed shadow roots and cross-origin frames are unreachable from here; frames are listed in `blocked`,
  // upgrade: all_frames content scripts with per-frame routing.
  function deepAll(root, sel, out, blocked) {
    out.push(...root.querySelectorAll(sel));
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) deepAll(el.shadowRoot, sel, out, blocked);
      if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
        let doc = null;
        try { doc = el.contentDocument; } catch {}
        if (doc) deepAll(doc, sel, out, blocked); else blocked.push(el);
      }
    }
    return out;
  }

  function activeEl() {
    let a = document.activeElement;
    for (;;) {
      const n = a && ((a.shadowRoot && a.shadowRoot.activeElement) || (a.contentDocument && a.contentDocument.activeElement));
      if (!n) return a;
      a = n;
    }
  }

  function pageText() {
    let t = document.body ? document.body.innerText : "";
    for (const f of document.querySelectorAll("iframe,frame")) {
      let d = null;
      try { d = f.contentDocument; } catch {}
      if (d && d.body) t += "\n[iframe " + (f.src || "") + "]\n" + d.body.innerText;
    }
    return t.slice(0, 100000);
  }

  function readPage(filter, query) {
    const lines = [];
    const q = (query || "").toLowerCase();
    const sel = filter === "all" ? INTERACTIVE + ",h1,h2,h3,h4,h5,h6,p,li,label,img[alt]" : INTERACTIVE;
    const blocked = [];
    for (const el of deepAll(document, sel, [], blocked)) {
      if (!visible(el)) continue;
      const role = roleOf(el), name = nameOf(el);
      if (q && !(role + " " + name + " " + (el.href || "")).toLowerCase().includes(q)) continue;
      const bits = [role, JSON.stringify(name), "[" + refOf(el) + "]"];
      if (el.href) bits.push("href=" + el.href);
      if (el.type) bits.push("type=" + el.type);
      if (el.checked) bits.push("checked");
      if (el.disabled) bits.push("disabled");
      lines.push(bits.join(" "));
      if (lines.length >= 1500) { lines.push("... truncated"); break; }
    }
    if (!q) for (const f of blocked) lines.push("iframe (cross-origin, not readable) src=" + (f.src || "about:blank"));
    return lines.join("\n");
  }

  function target(p) {
    if (p.ref) {
      const el = byId.get(p.ref);
      if (!el || !el.isConnected) throw new Error("Unknown or stale ref " + p.ref + " — call read_page again");
      return el;
    }
    if (typeof p.x === "number" && typeof p.y === "number") {
      const el = document.elementFromPoint(p.x, p.y);
      if (!el) throw new Error("No element at " + p.x + "," + p.y);
      return el;
    }
    throw new Error("Provide ref or x,y");
  }

  function click(p) {
    const el = target(p);
    const at = !p.ref && typeof p.x === "number"; // clicking a point: keep it, do not scroll
    if (!at) el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView || window, clientX: at ? p.x : r.left + r.width / 2, clientY: at ? p.y : r.top + r.height / 2, button: 0 };
    const fire = (types, extra) => types.forEach((t) => el.dispatchEvent(new MouseEvent(t, { ...o, ...extra })));
    const what = roleOf(el) + " " + JSON.stringify(nameOf(el));
    const action = p.action || "left";
    if (action === "hover") {
      fire(["pointerover", "mouseover", "mouseenter", "mousemove"]);
      return "hovered " + what;
    }
    if (action === "right") {
      fire(["pointerdown", "mousedown"], { button: 2, buttons: 2 });
      fire(["pointerup", "mouseup", "contextmenu"], { button: 2 });
      return "right-clicked " + what;
    }
    fire(["pointerdown", "mousedown"]);
    if (el.focus) el.focus();
    fire(["pointerup", "mouseup"]);
    const press = () => (at ? fire(["click"]) : el.click()); // a point click must keep its coordinates
    press();
    if (action === "double") {
      press();
      fire(["dblclick"], { detail: 2 });
      return "double-clicked " + what;
    }
    return "clicked " + what;
  }

  function type(p) {
    const el = p.ref ? target(p) : activeEl();
    if (!el) throw new Error("No focused element");
    el.focus();
    if (p.clear) {
      if ("value" in el) { el.select && el.select(); } else { el.ownerDocument.execCommand("selectAll"); }
    }
    if (!el.ownerDocument.execCommand("insertText", false, p.text) && "value" in el) {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, "value").set;
      set.call(el, (p.clear ? "" : el.value) + p.text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return "typed " + p.text.length + " chars";
  }

  function key(p) {
    const el = activeEl() || document.body;
    const m = p.modifiers || [];
    const init = { key: p.key, bubbles: true, cancelable: true, ctrlKey: m.includes("ctrl"), shiftKey: m.includes("shift"), altKey: m.includes("alt"), metaKey: m.includes("meta") };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    if (p.key === "Enter" && !m.length && el.form && el.tagName === "INPUT") el.form.requestSubmit();
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    return "pressed " + [...m, p.key].join("+");
  }

  function formInput(p) {
    const el = target(p);
    const v = p.value;
    if (el.tagName === "SELECT") {
      const i = [...el.options].findIndex((o) => o.value === String(v) || o.text.trim() === String(v));
      if (i < 0) throw new Error("No option " + JSON.stringify(v) + " in " + p.ref);
      el.selectedIndex = i;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "selected " + JSON.stringify(el.options[i].text.trim());
    }
    if (el.type === "checkbox" || el.type === "radio") {
      const want = v === true || v === "true";
      if (el.checked !== want) el.click(); // click so page handlers fire
      return (el.type) + " checked=" + el.checked;
    }
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return "set value (" + String(v).length + " chars)";
  }

  async function wait(p) {
    const end = Date.now() + Math.min(p.timeout || 10000, 30000);
    const ok = () => (p.text && pageText().includes(p.text)) || (p.selector && document.querySelector(p.selector));
    if (!p.text && !p.selector) throw new Error("Provide text or selector");
    while (Date.now() < end) {
      if (ok()) return "found";
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Timed out waiting for " + (p.text ? JSON.stringify(p.text) : p.selector));
  }

  function scroll(p) {
    if (p.ref) { target(p).scrollIntoView({ block: "center" }); return "scrolled to " + p.ref; }
    window.scrollBy(p.dx || 0, p.dy || 0);
    return "scrollY=" + Math.round(window.scrollY);
  }

  // Window origin + browser chrome (toolbar, tab bar, sidebar) = where the page's top-left sits on screen.
  function screenPoint(p) {
    const left = window.screenX + (window.outerWidth - window.innerWidth);
    const top = window.screenY + (window.outerHeight - window.innerHeight);
    return { x: Math.round(left + p.x), y: Math.round(top + p.y), pageFocused: document.hasFocus() };
  }

  // Runs code in the page's own world (page-hook.js evaluates it) and gets the result back via postMessage.
  function evalPage(p) {
    return new Promise((resolve, reject) => {
      const id = "e" + Math.random().toString(36).slice(2);
      const onMsg = (e) => {
        const d = e.data;
        if (e.source !== window || !d || d.__claudeEval !== id) return;
        window.removeEventListener("message", onMsg);
        clearTimeout(timer);
        if (d.error) reject(new Error(d.error));
        else resolve({ value: d.json === undefined ? null : JSON.parse(d.json) });
      };
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        reject(new Error("No result from the page: page-hook.js is not active here (reload the tab), or the code did not finish in time."));
      }, Math.min(p.timeout || 10000, 30000));
      window.addEventListener("message", onMsg);
      window.postMessage({ __claudeEvalReq: 1, id, code: p.code }, "*");
    });
  }

  function captured(kind, p) {
    const b = window.__claudeBuf;
    if (!b) throw new Error("Capture is not active on this page: reload the tab (it records only pages loaded after the extension started).");
    let rows = b[kind];
    if (p.level) rows = rows.filter((r) => r.level === p.level);
    if (p.filter) { const q = p.filter.toLowerCase(); rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)); }
    if (p.clear) b[kind] = [];
    return rows.slice(-(p.limit || 100)).map((r) => ({ ...r, t: new Date(r.t).toISOString().slice(11, 23) }));
  }

  if (window !== window.top) {
    try { Promise.resolve(api.runtime.sendMessage({ cmd: "frame_hello", url: location.href })).catch(() => {}); } catch (e) {}
  }
  api.runtime.onMessage.addListener((msg) => {
    const p = msg.params || {};
    // Child frames answer only requests addressed to them (background sets __frame), so the top page keeps answering by default.
    if (window !== window.top && !p.__frame) return;
    try {
      switch (msg.method) {
        case "read_page": return Promise.resolve({ url: location.href, title: document.title, tree: readPage(p.filter, p.query) });
        case "get_text": return Promise.resolve({ url: location.href, title: document.title, text: pageText() });
        case "click": return Promise.resolve(click(p));
        case "type": return Promise.resolve(type(p));
        case "key": return Promise.resolve(key(p));
        case "scroll": return Promise.resolve(scroll(p));
        case "form_input": return Promise.resolve(formInput(p));
        case "wait": return wait(p);
        case "screen_point": return Promise.resolve(screenPoint(p));
        case "eval_page": return evalPage(p).catch((e) => ({ __error: String((e && e.message) || e) }));
        case "console": return Promise.resolve(captured("console", p));
        case "network": return Promise.resolve(captured("network", p));
      }
    } catch (e) {
      return Promise.reject(e);
    }
  });
})();
