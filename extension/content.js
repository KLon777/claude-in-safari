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

  // ---- safari_snapshot: a compact accessibility-style tree; interactive nodes carry refs usable by click/type/form_input ----
  const SNAP_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "SVG", "CANVAS"]);
  const LANDMARK = { NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary", FORM: "form", ARTICLE: "article", UL: "list", OL: "list", LI: "listitem", TABLE: "table", TR: "row", TD: "cell", TH: "columnheader", DIALOG: "dialog", IMG: "img", HR: "separator" };
  function snapHidden(el) {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    const s = getComputedStyle(el);
    return s.display === "none" || s.visibility === "hidden";
  }
  function snapKids(el) {
    if (el.shadowRoot) return [...el.shadowRoot.children];
    if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      try { return el.contentDocument && el.contentDocument.body ? [el.contentDocument.body] : []; } catch { return []; }
    }
    return [...el.childNodes];
  }
  function snapshot(p) {
    const root = p.ref ? target({ ref: p.ref }) : document.body;
    if (!root) throw new Error("The page has no body yet");
    const max = Math.min(p.limit || 1500, 4000);
    const out = [];
    let truncated = false;
    const emit = (depth, s) => { if (out.length >= max) { truncated = true; return false; } out.push("  ".repeat(depth) + "- " + s); return true; };
    function walk(node, depth) {
      if (truncated) return;
      if (node.nodeType === 3) {
        const t = node.nodeValue.replace(/\s+/g, " ").trim();
        if (t) emit(depth, "text " + JSON.stringify(t.slice(0, 200)));
        return;
      }
      if (node.nodeType !== 1 || SNAP_SKIP.has(node.tagName.toUpperCase())) return;
      if (snapHidden(node)) return;
      const interactive = node.matches(INTERACTIVE);
      const isHeading = /^H[1-6]$/.test(node.tagName);
      const role = node.getAttribute("role") || LANDMARK[node.tagName] || "";
      if (interactive || isHeading || node.tagName === "IMG") {
        if (interactive && !visible(node)) return;
        const bits = [roleOf(node)];
        const name = nameOf(node);
        if (name) bits.push(JSON.stringify(name));
        if (isHeading) bits.push("level=" + node.tagName[1]);
        if (interactive) bits.push("[" + refOf(node) + "]");
        if (node.href) bits.push("href=" + node.href);
        if (node.type && node.tagName === "INPUT") bits.push("type=" + node.type);
        if (node.checked) bits.push("checked");
        if (node.disabled) bits.push("disabled");
        const ex = node.getAttribute("aria-expanded"); if (ex) bits.push("expanded=" + ex);
        const se = node.getAttribute("aria-selected"); if (se === "true") bits.push("selected");
        emit(depth, bits.join(" "));
        return; // the name already holds the text of an interactive element or heading
      }
      let d = depth;
      if (role) { const n = node.getAttribute("aria-label"); if (!emit(depth, role + (n ? " " + JSON.stringify(n) : ""))) return; d = depth + 1; }
      for (const k of snapKids(node)) walk(k, d);
    }
    walk(root, 0);
    if (truncated) out.push("... truncated (pass ref to snapshot a part, or a larger limit)");
    return { url: location.href, title: document.title, tree: out.join("\n") };
  }

  // ---- safari_reader: the main article of the page as markdown-like text (own heuristic, not Safari's Reader) ----
  const READER_BAD = /comment|footer|footnote|sidebar|\baside\b|nav|menu|promo|advert|\bads?\b|banner|cookie|share|related|breadcrumb|social|popup|modal|newsletter|subscribe|toolbar/i;
  const READER_DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "NAV", "FOOTER", "ASIDE", "FORM", "BUTTON", "SELECT", "INPUT", "TEXTAREA", "IFRAME", "SVG", "CANVAS", "VIDEO", "AUDIO", "DIALOG"]);
  function readerBad(el) { return READER_BAD.test((el.id || "") + " " + (typeof el.className === "string" ? el.className : "")); }
  function readerInline(el) {
    let s = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { s += n.nodeValue.replace(/\s+/g, " "); continue; }
      if (n.nodeType !== 1 || READER_DROP.has(n.tagName.toUpperCase()) || snapHidden(n)) continue;
      const t = n.tagName;
      const inner = readerInline(n);
      if (t === "A" && n.href && inner.trim()) s += "[" + inner.trim() + "](" + n.href + ")";
      else if (t === "STRONG" || t === "B") s += inner.trim() ? "**" + inner.trim() + "**" : "";
      else if (t === "EM" || t === "I") s += inner.trim() ? "*" + inner.trim() + "*" : "";
      else if (t === "CODE") s += "`" + inner + "`";
      else if (t === "BR") s += "\n";
      else if (t === "IMG") { const a = n.getAttribute("alt"); if (a) s += "![" + a + "](" + n.src + ")"; }
      else s += inner;
    }
    return s;
  }
  function readerBlocks(el, out) {
    for (const n of el.children) {
      if (READER_DROP.has(n.tagName.toUpperCase()) || snapHidden(n) || readerBad(n)) continue;
      const t = n.tagName;
      if (/^H[1-6]$/.test(t)) { const x = readerInline(n).trim(); if (x) out.push("#".repeat(+t[1]) + " " + x); }
      else if (t === "P") { const x = readerInline(n).replace(/[ \t]+/g, " ").trim(); if (x) out.push(x); }
      else if (t === "PRE") out.push("```\n" + n.innerText.replace(/\n+$/, "") + "\n```");
      else if (t === "BLOCKQUOTE") { const x = readerInline(n).trim(); if (x) out.push(x.split("\n").map((l) => "> " + l).join("\n")); }
      else if (t === "UL" || t === "OL") {
        let i = 0;
        const items = [...n.children].filter((li) => li.tagName === "LI").map((li) => (t === "OL" ? ++i + ". " : "- ") + readerInline(li).replace(/\s+/g, " ").trim()).filter((l) => l.length > 2);
        if (items.length) out.push(items.join("\n"));
      } else if (t === "TABLE") {
        const rows = [...n.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" | ")).filter(Boolean);
        if (rows.length) out.push(rows.join("\n"));
      } else if (t === "FIGURE") { const x = readerInline(n).trim(); if (x) out.push(x); }
      else readerBlocks(n, out);
    }
  }
  function reader() {
    // Score every container by the paragraph text under it (parent full, grandparent half), minus link-heavy and "bad" ones.
    const scores = new Map();
    for (const para of document.querySelectorAll("p, pre, li")) {
      if (snapHidden(para)) continue;
      const len = para.innerText.trim().length;
      if (len < 40) continue;
      const links = [...para.querySelectorAll("a")].reduce((a, x) => a + x.innerText.length, 0);
      const pts = Math.max(0, len - links * 1.5);
      for (const [el, k] of [[para.parentElement, 1], [para.parentElement && para.parentElement.parentElement, 0.5]]) {
        if (!el || el === document.body || el === document.documentElement) continue;
        scores.set(el, (scores.get(el) || 0) + pts * k);
      }
    }
    let best = null, top = 0;
    for (const [el, sc0] of scores) {
      const sc = readerBad(el) ? sc0 * 0.2 : sc0;
      if (sc > top) { top = sc; best = el; }
    }
    const art = document.querySelector("article, main, [role=main]");
    if (art && (!best || (scores.get(art) || art.innerText.length / 4) >= top * 0.6)) best = art;
    const meta = (n) => { const m = document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]'); return m ? m.content : ""; };
    const head = { url: location.href, title: meta("og:title") || document.title, byline: meta("author") || (document.querySelector("[rel=author]") || {}).innerText || "", published: meta("article:published_time") || meta("date") || "" };
    if (!best || top < 80) {
      const text = (document.body ? document.body.innerText : "").slice(0, 80000);
      return { ...head, fallback: true, note: "No article-like block found; this is the page's plain text.", length: text.length, text };
    }
    const out = [];
    if (!best.querySelector("h1")) out.push("# " + head.title);
    readerBlocks(best, out);
    const text = out.join("\n\n").slice(0, 80000);
    return { ...head, length: text.length, text };
  }

  // ---- safari_upload_file: files arrive as base64 from the server (which read them from disk after the user confirmed) ----
  function uploadFile(p) {
    const el = target(p);
    const files = (p.files || []).map((f) => {
      const bin = atob(f.data), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], f.name, { type: f.mime || "application/octet-stream" });
    });
    if (!files.length) throw new Error("No files");
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    const input = el.tagName === "INPUT" && el.type === "file" ? el : el.querySelector && el.querySelector("input[type=file]");
    const names = files.map((f) => f.name).join(", ");
    if (input) {
      if (files.length > 1 && !input.multiple) throw new Error("This file input accepts one file only");
      input.files = dt.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return "attached " + names + " to the file input";
    }
    const r = el.getBoundingClientRect();
    for (const type of ["dragenter", "dragover", "drop"]) {
      el.dispatchEvent(dragEvent(type, el, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, dt));
    }
    return "dropped " + names + " on " + roleOf(el) + " " + JSON.stringify(nameOf(el));
  }

  // ---- safari_drag: HTML5 drag events plus pointer/mouse moves, so both native drag and library-based (sortable, sliders) targets react ----
  function dragEvent(type, el, pt, dt) {
    const init = { bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView || window, clientX: pt.x, clientY: pt.y, dataTransfer: dt };
    let ev;
    try { ev = new DragEvent(type, init); } catch { ev = new MouseEvent(type, init); }
    if (!ev.dataTransfer) { try { Object.defineProperty(ev, "dataTransfer", { value: dt }); } catch {} }
    return ev;
  }
  async function drag(p) {
    const from = target({ ref: p.ref, x: p.x, y: p.y });
    const to = target({ ref: p.toRef, x: p.toX, y: p.toY });
    const center = (el, atPoint, x, y) => {
      if (atPoint) return { x, y };
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const A = center(from, !p.ref && typeof p.x === "number", p.x, p.y);
    const B = center(to, !p.toRef && typeof p.toX === "number", p.toX, p.toY);
    const steps = Math.max(2, Math.min(p.steps || 8, 40));
    const dt = new DataTransfer();
    const mouse = (type, el, pt, extra) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: pt.x, clientY: pt.y, button: 0, buttons: type.endsWith("up") ? 0 : 1, ...extra }));
    const ptr = (type, el, pt) => { try { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: pt.x, clientY: pt.y, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: type.endsWith("up") ? 0 : 1 })); } catch {} };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    ptr("pointerdown", from, A); mouse("mousedown", from, A);
    from.dispatchEvent(dragEvent("dragstart", from, A, dt));
    let last = from;
    for (let i = 1; i <= steps; i++) {
      const pt = { x: A.x + ((B.x - A.x) * i) / steps, y: A.y + ((B.y - A.y) * i) / steps };
      const under = i === steps ? to : document.elementFromPoint(pt.x, pt.y) || to;
      ptr("pointermove", under, pt); mouse("mousemove", under, pt);
      from.dispatchEvent(dragEvent("drag", from, pt, dt));
      if (under !== last) { last.dispatchEvent(dragEvent("dragleave", last, pt, dt)); under.dispatchEvent(dragEvent("dragenter", under, pt, dt)); last = under; }
      under.dispatchEvent(dragEvent("dragover", under, pt, dt));
      await wait(12);
    }
    to.dispatchEvent(dragEvent("drop", to, B, dt));
    from.dispatchEvent(dragEvent("dragend", from, B, dt));
    ptr("pointerup", to, B); mouse("mouseup", to, B);
    return "dragged " + roleOf(from) + " " + JSON.stringify(nameOf(from)) + " -> " + roleOf(to) + " " + JSON.stringify(nameOf(to));
  }

  // ---- safari_dialog: page-hook.js does the interception, this relays the setting and reads what was recorded ----
  function dialogCmd(p) {
    const a = p.action || "list";
    if (a === "list") {
      const b = window.__claudeBuf;
      if (!b) throw new Error("Capture is not active on this page: reload the tab.");
      const rows = b.dialog.map((r) => ({ ...r, t: new Date(r.t).toISOString().slice(11, 23) }));
      if (p.clear) b.dialog = [];
      return rows;
    }
    if (a === "intercept") {
      const mode = p.mode === "accept" ? "accept" : "dismiss";
      window.postMessage({ __claudeDialogCfg: 1, mode, promptText: p.promptText }, "*");
      return "intercepting dialogs on this page (" + mode + "); they are recorded, not shown. Resets when the page reloads.";
    }
    if (a === "native") { window.postMessage({ __claudeDialogCfg: 1, mode: "native" }, "*"); return "dialogs are native again"; }
    throw new Error("action must be list, intercept or native");
  }

  // ---- safari_screenshot_element: the background page captures the viewport and crops to this rectangle ----
  function elementRect(p) {
    if (p.__frame) throw new Error("screenshot_element works on the top page only");
    const el = target({ ref: p.ref });
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
  }

  // ---- indicator: while Claude works on this tab, a coloured frame and a small label show it ----
  // The overlay lives in a closed shadow root on <html>, ignores the mouse, and is hidden while screenshots/OCR are taken.
  let markHost = null, markTimer = 0;
  function agentMark(p) {
    if (!document.documentElement) return true;
    if (p.on === false) { if (markHost) markHost.style.display = "none"; return true; }
    if (!markHost) {
      markHost = document.createElement("div");
      markHost.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none";
      const sr = markHost.attachShadow({ mode: "closed" });
      const ru = (navigator.language || "").toLowerCase().startsWith("ru");
      const css = document.createElement("style");
      css.textContent = ".f{position:fixed;inset:0;box-shadow:inset 0 0 0 3px #f59e0b,inset 0 0 28px 6px rgba(245,158,11,.40);animation:p 1.8s ease-in-out infinite}" +
        ".l{position:fixed;top:10px;right:12px;background:#f59e0b;color:#1f1300;font:600 12px/1 -apple-system,system-ui,sans-serif;padding:6px 11px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
        "@keyframes p{50%{box-shadow:inset 0 0 0 3px #f59e0b,inset 0 0 14px 2px rgba(245,158,11,.25)}}@media(prefers-reduced-motion:reduce){.f{animation:none}}";
      const f = document.createElement("div"); f.className = "f";
      const l = document.createElement("div"); l.className = "l"; l.textContent = ru ? "Claude работает в этой вкладке" : "Claude is working in this tab";
      sr.append(css, f, l);
    }
    if (!markHost.isConnected) document.documentElement.appendChild(markHost);
    markHost.style.display = "block";
    clearTimeout(markTimer);
    markTimer = setTimeout(() => { if (markHost) markHost.style.display = "none"; }, 6000);
    return true;
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
        case "snapshot": return Promise.resolve(snapshot(p));
        case "reader": return Promise.resolve(reader(p));
        case "upload_file": return Promise.resolve(uploadFile(p));
        case "drag": return drag(p);
        case "dialog": return Promise.resolve(dialogCmd(p));
        case "element_rect": return Promise.resolve(elementRect(p));
        case "agent_mark": return Promise.resolve(agentMark(p));
      }
    } catch (e) {
      return Promise.reject(e);
    }
  });
})();
