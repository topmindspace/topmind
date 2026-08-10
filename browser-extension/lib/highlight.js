/**
 * Page highlighter — injected into the tab (isolated world).
 * Drag-select or click blocks to mark passages for clip.
 *
 * Message API (from extension pages / background):
 *   { type: 'mh-hl-toggle' } → { active, count }
 *   { type: 'mh-hl-get' } → { highlights: [{text, id}], count }
 *   { type: 'mh-hl-clear' } → { ok: true }
 *   { type: 'mh-hl-status' } → { active, count }
 */
(function topmindHighlighter() {
  if (globalThis.__topmindHlInstalled) return;
  globalThis.__topmindHlInstalled = true;

  const STYLE_ID = "topmind-hl-style";
  const ATTR = "data-topmind-hl";
  let active = false;
  let seq = 0;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    // Brand Deep #31548e — injected into page content (isolated world);
    // cannot use CSS variables from extension popup.css, so value is hardcoded
    // to match Desktop --color-brand-deep / --color-accent-color.
    st.textContent = `
      [${ATTR}] {
        background: rgba(49, 84, 142, 0.22) !important;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        border-radius: 2px;
        cursor: pointer;
      }
      body.topmind-hl-active {
        cursor: crosshair !important;
      }
      body.topmind-hl-active ::selection {
        background: rgba(49, 84, 142, 0.35);
      }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  function collect() {
    return Array.from(document.querySelectorAll(`[${ATTR}]`)).map((el) => ({
      id: el.getAttribute(ATTR) || "",
      text: (el.textContent || "").trim(),
    })).filter((h) => h.text.length > 0);
  }

  function wrapRange(range) {
    if (!range || range.collapsed) return;
    const text = range.toString().trim();
    if (text.length < 2) return;
    try {
      const mark = document.createElement("mark");
      mark.setAttribute(ATTR, `h${++seq}`);
      range.surroundContents(mark);
    } catch {
      // Cross-element selection: extract and wrap text nodes best-effort
      try {
        const frag = range.extractContents();
        const mark = document.createElement("mark");
        mark.setAttribute(ATTR, `h${++seq}`);
        mark.appendChild(frag);
        range.insertNode(mark);
      } catch {
        /* ignore */
      }
    }
  }

  function onMouseUp() {
    if (!active) return;
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    // Don't highlight inside existing marks
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (el?.closest?.(`[${ATTR}]`)) return;
    wrapRange(range.cloneRange());
    sel.removeAllRanges();
  }

  function onClickMark(e) {
    if (!active) return;
    const mark = e.target?.closest?.(`[${ATTR}]`);
    if (!mark) return;
    // Alt-click removes
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize?.();
    }
  }

  function setActive(on) {
    ensureStyle();
    active = Boolean(on);
    document.body?.classList.toggle("topmind-hl-active", active);
    if (active) {
      document.addEventListener("mouseup", onMouseUp, true);
      document.addEventListener("click", onClickMark, true);
    } else {
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("click", onClickMark, true);
    }
    return { active, count: collect().length };
  }

  function clearAll() {
    for (const el of document.querySelectorAll(`[${ATTR}]`)) {
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize?.();
    }
    return { ok: true, count: 0 };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "mh-hl-toggle") {
      sendResponse(setActive(msg.active != null ? msg.active : !active));
      return true;
    }
    if (msg.type === "mh-hl-status") {
      sendResponse({ active, count: collect().length });
      return true;
    }
    if (msg.type === "mh-hl-get") {
      const highlights = collect();
      sendResponse({ highlights, count: highlights.length, active });
      return true;
    }
    if (msg.type === "mh-hl-clear") {
      sendResponse(clearAll());
      return true;
    }
  });
})();
