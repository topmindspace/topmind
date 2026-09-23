/**
 * Options page fallback — loaded as classic script (before module).
 * If the ES module (options.js) fails to load, this shows a visible error
 * so the user knows to reload the extension instead of seeing dead buttons.
 */
(function () {
  "use strict";

  function ti18n(key, sub) {
    try {
      if (typeof chrome !== "undefined" && chrome?.i18n?.getMessage) {
        var msg = chrome.i18n.getMessage(key, sub ? [sub] : undefined);
        if (msg) return msg;
      }
    } catch {
      /* fallback */
    }
    return key;
  }

  // Listen for module load errors (import failures, CSP blocks, etc.)
  window.addEventListener("error", function (e) {
    var msgEl = document.getElementById("msg");
    if (msgEl && e && e.message) {
      msgEl.textContent = ti18n("fallback_load_failed", e.message);
      msgEl.className = "msg-box err";
    }
  });

  // Timeout: if module hasn't marked itself ready in 3s, show fallback
  setTimeout(function () {
    if (!window.__topmindOptionsReady) {
      var msgEl = document.getElementById("msg");
      if (msgEl) {
        msgEl.textContent = ti18n("fallback_load_timeout");
        msgEl.className = "msg-box err";
      }
    }
  }, 3000);
})();
