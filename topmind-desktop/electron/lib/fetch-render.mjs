/**
 * Enhanced URL fetch via hidden BrowserWindow (JS-rendered SPA shells).
 * Never shown; skipTaskbar; registered as ephemeral so main.mjs won't dock-destroy mid-load.
 */
import { createRequire } from "node:module";
import { markEphemeralBrowserWindow } from "./ephemeral-windows.mjs";
import { enqueueRender } from "./fetch-render-queue.mjs";
import { t } from "./electron-i18n.mjs";

const require = createRequire(import.meta.url);

/**
 * Load URL in hidden Chromium, return outerHTML after network settle + light scroll.
 * Serialized via enqueueRender (max 1 concurrent).
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ html: string, finalUrl: string, method: 'render' }>}
 */
export async function fetchRenderedHtml(url, opts = {}) {
  return enqueueRender(() => fetchRenderedHtmlUnlocked(url, opts));
}

async function fetchRenderedHtmlUnlocked(url, opts = {}) {
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 18_000, 5_000), 45_000);
  const { BrowserWindow } = require("electron");

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      images: false,
      javascript: true,
    },
  });
  markEphemeralBrowserWindow(win);

  const destroy = () => {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* ignore */
    }
  };

  try {
    const loadPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(t("fetch.renderTimeout", { sec: Math.round(timeoutMs / 1000) })));
      }, timeoutMs);

      const finish = (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      };

      win.webContents.once("did-fail-load", (_e, code, desc) => {
        finish(new Error(t("fetch.renderFail", { desc: desc || code })));
      });

      win.webContents.once("did-finish-load", () => {
        // Give SPA a short window to hydrate; then scroll to trigger lazy content.
        setTimeout(() => finish(), 900);
      });
    });

    await win.loadURL(url, {
      userAgent:
        "Mozilla/5.0 (compatible; topmind/4.12; +https://github.com/topmindspace/topmind) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    await loadPromise;

    await win.webContents
      .executeJavaScript(
        `(() => {
          try {
            window.scrollTo(0, document.body.scrollHeight / 3);
            window.scrollTo(0, document.body.scrollHeight * 2 / 3);
            window.scrollTo(0, 0);
          } catch (e) {}
          return true;
        })()`,
        true,
      )
      .catch(() => {});

    // Brief settle after scroll
    await new Promise((r) => setTimeout(r, 400));

    const html = await win.webContents.executeJavaScript(
      "document.documentElement ? document.documentElement.outerHTML : document.body?.outerHTML || ''",
      true,
    );
    const finalUrl = win.webContents.getURL() || url;
    if (!html || String(html).length < 80) {
      throw new Error(t("fetch.renderNoHtml"));
    }
    return { html: String(html), finalUrl, method: "render" };
  } finally {
    destroy();
  }
}
