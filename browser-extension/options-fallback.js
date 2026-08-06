/**
 * Options page fallback — loaded as classic script (before module).
 * If the ES module (options.js) fails to load, this shows a visible error
 * so the user knows to reload the extension instead of seeing dead buttons.
 */
(function () {
  "use strict";

  // Listen for module load errors (import failures, CSP blocks, etc.)
  window.addEventListener("error", function (e) {
    var msgEl = document.getElementById("msg");
    if (msgEl && e && e.message) {
      msgEl.textContent = "加载失败: " + e.message;
      msgEl.className = "msg-box err";
    }
  });

  // Timeout: if module hasn't marked itself ready in 3s, show fallback
  setTimeout(function () {
    if (!window.__topmindOptionsReady) {
      var msgEl = document.getElementById("msg");
      if (msgEl) {
        msgEl.textContent =
          "设置页加载超时 — 请重新加载扩展 (chrome://extensions → 刷新)";
        msgEl.className = "msg-box err";
      }
    }
  }, 3000);
})();
