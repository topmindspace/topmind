# ADR: Cross-platform window chrome, platform-correct chords, and the suggestion lifecycle

**Date:** 2026-09-15  
**Status:** Accepted (revised 2026-09-16: Windows OS chrome strip moved out of product TitleBar)  
**Kind:** Desktop UX / cross-platform correctness + AI suggestion lifecycle  
**Surfaces:** Desktop (renderer + Electron main) · Kernel (`lib/`) · docs  
**Related:** `topmind-desktop/DESIGN.md` §窗口外壳 / §7 键盘快捷键 / §0.0.3 · `topmind-desktop/ARCHITECTURE.md` · `AGENTS.md` (跨平台文案纪律) · `2026-09-07-pi-engine-and-three-column-reevaluation.md` (chrome layout this builds on) · `2026-09-14-product-vocabulary-rename.md`

> **Revision note (2026-09-16).** v4.2.0 implemented Windows chrome by mounting the menu strip **inside the center column TitleBar**. That gave one OS row, but it mixed OS chrome into product IA (三栏产品 header). The strip is now a dedicated full-width `OsChromeStrip` **above** the workbench; product column headers never take caption reserves. Caption measurement, native `Menu.popup`, Linux/macOS policy, float-window policy, and the suggestion lifecycle below are unchanged.
>
> **PrimaryNav placement (2026-09-16).** The three destinations (动态 / Inbox / 交付) left the 26px StatusBar — that bar is status, not navigation. They now live in a **sidebar destinations row** (`data-sidebar-primary-nav`); when the sidebar is collapsed, TitleBar mounts a compact icon-only PrimaryNav so destinations stay reachable. Shortcuts and IA labels are unchanged.

---

## Independently readable decisions

**D1 — A chord is declared once, in macOS glyph form, and rendered per platform at the edge.** `src/lib/chord.ts` (`formatChord`) is the only place `⌘` becomes `Ctrl`. Three consumers: literal markup, the i18next `chord` post-processor (so locale files are platform-blind by construction), and `WORKBENCH_SHORTCUTS[].display`'s doc contract. Rendering `display` raw is the defect this removes.

**D2 — The Windows float capture window has no native frame.** `resolveWindowShell({ forFloat: true, platform: "win32" })` returns `frame: false` — not `titleBarStyle: 'hidden'`. The note already draws its own 32px header (title + explicit ✕ + `v4-drag`), so a native bar repeats its identity, and the OS caption buttons would add a minimize on a `skipTaskbar` sticky note that hides it with no way back. `thickFrame` survives, so resize borders and the drop shadow do.

**D3 — Fullscreen is a CSS state, not a React one.** Main owns the truth (`enter-full-screen` / `leave-full-screen` → `window:fullscreen`); `src/lib/fullscreen-chrome.ts` writes `html[data-fullscreen]`. It collapses the chrome reserves that exist only to dodge OS buttons (macOS traffic-light pad, Windows `--wc-inset-right`), so fullscreen does not keep a blank strip where the buttons used to be.

**D4 — The fullscreen menu item's label follows the state.** `menu.fullscreen` / `menu.exitFullscreen` swapped from the same `updateMenuState` snapshot that already drove checkmarks. A menu that says 全屏 while the window is fullscreen is a lie the user can see.

**D5 — Dialog footers flip on Windows in CSS, never in the DOM.** DOM order is cancel-first everywhere; `html[data-platform="win"] [data-dialog-footer] { flex-direction: row-reverse }` moves the primary to the left. Tab order and the destructive-dialog guarantee ("Enter lands on Cancel") are properties of DOM order and must not travel with the layout.

**D6 — "Accept all" is one request, not a renderer loop.** `applySuggestions(items)` is a single IPC; the main process writes sequentially, loads settings once, and emits per-item progress. The previous renderer-side loop cost N round-trips and N settings loads, and left a half-applied card as the only evidence of a mid-way failure.

**D7 — Apply failures are classified, and terminal ones count as a dismissal.** `src/lib/suggest-apply-label.ts` splits 12 reason codes into **terminal** (source gone, target exists, outside workspace, read/write failed) and **retryable** (AI busy, timeout, engine unavailable). Terminal → the card is removed and the suggestion is dismissed, because retrying cannot change the answer. Retryable → the card stays. Every reason has i18n copy; reason codes are never shown raw.

**D8 — "Dismiss" is persisted, not a session-local visual.** `lib/suggest-dismissed.mjs` writes `.topmind/suggest-dismissed.json`, and `suggest-engine` filters through it before returning. Without this, the next poll re-serves the exact suggestion the user just ignored — the same card, forever.

**D9 — The activity window keeps the newest N, not the first N seen.** `listRecentlyTouchedMarkdown` used to stop walking at `maxFiles * 3`, which pinned the result to whichever subtree DFS reached first. It now keeps a `TRIM_AT` working set sorted by mtime, so a newer file in a later directory still displaces an older one while memory stays bounded.

**D10 — AI prompt tool names and output locale are guarded, not reviewed.** `electron/lib/ai-tool-names.mjs` is the single source for both the prompt builder and the tool registry, cross-asserted in both locales; `tests/ai-locale-prompts.test.mjs` pins that the production `buildSystemPrompt` call site passes `locale` + `outputLocale`. Both classes of defect are invisible at runtime — a prompt naming an unregistered tool fails as "the model is bad at tools", and a missing locale falls back to the model's default language.

---

## Context

Six independent complaints about the same product surface, which turned out to be one theme: **the app had a macOS-shaped mental model written into places that are not macOS.**

1. Chords were authored and displayed in glyph form, so Windows/Linux users were told to press keys their keyboards do not have — and nothing failed, because both forms are valid strings.
2. The Windows title bar cost ~95px of chrome (native menu strip stacked above the app's own 44px row) while repeating identity the breadcrumb already carried, and Electron exposes no API to merge the HMENU into the caption.
3. Fullscreen left the chrome reserves in place: the padding that exists to dodge the traffic lights and caption buttons stayed after those buttons disappeared.
4. The float capture window carried a native title bar above its own header — two bars saying "topmind / 快速捕获 / ✕", and on Windows a global menu bar across a 480px note.
5. Dialog footers followed macOS convention (cancel left) on a platform whose convention is the opposite, while a DOM reorder would have broken the destructive-dialog Enter guarantee.
6. The suggestion inbox had three separate lifecycle holes: an N-round-trip "accept all", failures that were neither surfaced nor resolved, and a dismiss that the next poll forgot.

The common failure mode is worth naming, because it is the reason this ADR exists rather than a bug list: **every one of these produces a green build.** A wrong chord string, a redundant title bar, an unreclaimed inset, a forgotten dismissal — none of them throw, none fail typecheck, none fail a test that was not specifically written to look for them. Each required a deliberate cross-platform reading of the code.

---

## Decision

Fix the six, and — more importantly — move each one's rule into a place where it is stated once and asserted.

| Area | Truth source | Guard |
|------|--------------|-------|
| Chord rendering | `src/lib/chord.ts` + i18next `chord` post-processor (`src/locales/index.ts`) | `tests/chord-format.test.mjs` |
| Window shell per platform | `electron/lib/window-shell.mjs` | `tests/window-shell.test.mjs` |
| Caption-button insets | `src/lib/window-controls.ts` → `--wc-inset-*` | `tests/window-shell.test.mjs` (measure, never guess) |
| Fullscreen state | `src/lib/fullscreen-chrome.ts` → `html[data-fullscreen]` | `tests/window-shell.test.mjs` |
| Menu template | `electron/lib/menu-spec.mjs` (pure) | `tests/app-menu.test.mjs` (role chords vs `WORKBENCH_SHORTCUTS`) |
| Zoom ownership | `src/components/shell/useShellShortcuts.ts` | `tests/app-menu.test.mjs` (`view.zoom.*`, no zoom roles) |
| Suggest apply | `electron/workspace-service.mjs` `applySuggestions` + `src/lib/suggest-apply-label.ts` | `tests/suggest-apply-failure.test.mjs` |
| Suggest dismissal | `lib/suggest-dismissed.mjs` | `tests/suggest-dismissed.test.mjs` |
| Activity window | `lib/activity-window.mjs` | `tests/activity-window.test.mjs` |
| AI prompt / tool / locale contract | `electron/lib/ai-tool-names.mjs`, `lib/ai-output-locale.mjs` | `tests/ai-tools-inventory.test.mjs`, `tests/ai-locale-prompts.test.mjs` |

---

## The chrome work in detail

**Windows owns one OS chrome row — outside product IA.** `titleBarStyle: 'hidden'` + `titleBarOverlay: { height: 44 }` lets the app draw a full-width strip (`OsChromeStrip`) **above the three workbench columns** (icon · name · menu labels) while the OS keeps painting minimize / maximize / close at its right end — so snapping, resize borders and hit-testing are untouched. Electron still cannot merge the native HMENU into the caption into one *native* row; this is the practical one-row form. **v4.2.0 first put that strip inside the center TitleBar**, which mixed OS chrome into product IA and was rejected: product column headers must never take OS chrome or caption reserves. The menu becomes an app-drawn strip (`OsChromeStrip` → `AppMenuBar` ← `src/lib/menu-strip.ts`) whose items pop the **real** native submenu (`Menu.popup`). The strip knows only ids: main supplies the top-level entries, already localized, via `system.menuTopLevel`, and pops by id via `system.menuPopup`. No menu item, label or checkmark is reimplemented in the renderer, so adding a top-level menu does not touch the strip. The native menu stays installed with its bar hidden, so every accelerator it owns (F11 / Ctrl+R / Ctrl+Z) keeps working and Alt still reveals the bar as a keyboard-only fallback.

**Why the first attempt at this failed, and why it does not now.** The earlier overlay reserved a *guessed* width and lost the reservation to a `padding` shorthand declared later in the stylesheet. Three things had to happen at once for that to break; all three are now structurally impossible:

1. The width is measured, not guessed: `navigator.windowControlsOverlay.getTitlebarAreaRect()` on every `geometrychange`, so DPI, scale and RTL take care of themselves.
2. The reservation rule is a compound selector targeting only the OS strip (`html[data-wc-inset] [data-os-chrome]`) — never `[data-column-chrome]`.
3. `.v4-column-chrome` uses `padding-left/right` longhand only — the shorthand is banned there because it resets `padding-right`.

**Linux deliberately stays native.** Decorations belong to the desktop environment and whether an overlay is drawn at all depends on the DE and on X11 vs Wayland. A reservation that cannot be measured is exactly the failure mode being removed, so Linux keeps its frame and its always-visible native menu bar. **Linux therefore still costs a second menu row** — that is a deliberate, unmeasured-risk-avoiding trade, not an oversight.

**macOS deliberately stays `hiddenInset`** and returns `frame: null` rather than `false`: `titleBarStyle` and an explicit `frame` flag are not meant to be combined, and shipping a behaviour change to the platform that already reads as one integrated bar would be churn.

**Zoom has exactly one owner per platform.** `resetZoom` / `zoomIn` / `zoomOut` roles register their own `CmdOrCtrl+0/±` accelerators. On Windows/Linux the renderer listener already owns `Ctrl+±`, so using the roles would mean one keypress, two owners, two zoom steps. The menu therefore dispatches renderer commands (`view.zoom.*`), and the renderer listener excludes `metaKey` — on macOS the native 显示 menu owns `⌘0/⌘+/⌘-` and routes to the same `api.sys.zoom` call. The listener must accept Shift, because on Windows "Ctrl +" *is* `Ctrl+Shift+=`; the previous version rejected every Shift press, which made the `"+"` branch unreachable and left Windows users able to zoom in only with `Ctrl+=`.

**`role` items implicitly register their accelerators.** There is no display-only mode for a role. This is how `toggleDevTools` (default `Ctrl+Shift+I` on Windows/Linux) was found colliding with the renderer's Inbox (⌘⇧I): one keypress opened Inbox *and* DevTools. It now uses an explicit `F12`, and the guard compares **role effective chords** against `WORKBENCH_SHORTCUTS` — the earlier version only compared the menu against itself, which is exactly why it missed this.

---

## The suggestion lifecycle in detail

**Batch apply.** `applySuggestions(items)` runs in the main process: one settings load, sequential writes through the write gate, per-item progress over `ctx.emit`. The renderer subscribes and drives the pane progress bar and the status-bar `n/m` chip. Nothing is silent and nothing toasts per item.

**Failure classification.** Two sets, one i18n key per code:

- **Terminal** → card removed and suggestion dismissed. Source file no longer exists, target already exists, path would land outside the workspace, read failed, write failed, no result. Retrying cannot change the answer, so offering a retry button would be a lie.
- **Retryable** → card stays. AI busy, timeout, engine temporarily unavailable. These are the cases where "try again" is real.

A reminder for future edits: **the terminal set is the dangerous one.** Leaving a code out means the card sits there failing identically forever; putting a transient code in means a suggestion silently vanishes on a rate limit. `outside-workspace` was initially missing and had to be added.

**Persisted dismissal.** `markSuggestionsDismissed` / `loadDismissedSuggestions` / `filterDismissedSuggestions` in `lib/suggest-dismissed.mjs`, stored at `.topmind/suggest-dismissed.json`. `suggest-engine` filters before returning, so the decision survives a reload and a poll. One subtlety worth keeping: `filterDismissedSuggestions` must check the in-memory cache **before** the disk read and not early-return on an empty disk file — the first version returned early, which made a hot cache invisible.

---

## Consequences

- **Windows gains ~20px of vertical chrome and one fewer identity repetition**; the price is that the menu's *visible* form is app-drawn. Keyboard access is unchanged (native bar still installable via Alt, accelerators still live).
- **Linux keeps the two-row chrome.** Anyone comparing screenshots across platforms should read that as intentional.
- **The float window has no OS close button on Windows** and relies on its own ✕; it is frameless, so `skipTaskbar` + drag region + in-app ✕ must all keep working. This is asserted in `tests/window-shell.test.mjs` alongside the `APP_NAME` agreement with `electron/main.mjs`'s `refreshWindowTitle`.
- **Adding a shortcut now has three steps**: declare it in `shortcuts.ts` (canonical form), use `formatChord()`/the post-processor at display, and check it against role chords in `menu-spec.mjs`. `AGENTS.md` carries this as 跨平台文案纪律.
- **A dismissed suggestion now stays dismissed across restarts.** There is no "show ignored" surface yet; `.topmind/suggest-dismissed.json` is deletable to reset, and that is the honest current answer.
- **`smartBudgetCorpus` / `smartBudget` is unchanged** — the activity-window fix is about *which files enter* the window (mtime top-N), not about how the corpus is budgeted.

## Verification

```bash
cd topmind-desktop && node --test --test-force-exit \
  tests/chord-format.test.mjs tests/app-menu.test.mjs tests/window-shell.test.mjs \
  tests/suggest-apply-failure.test.mjs tests/suggest-dismissed.test.mjs \
  tests/ai-tools-inventory.test.mjs tests/ai-locale-prompts.test.mjs
node --test tests/activity-window.test.mjs        # repo root
npm run desktop:quality                           # gate 1–8
npm run validate                                  # root · skills · utr · obsidian
```
