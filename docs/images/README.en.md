# Desktop media and screenshot index

[简体中文](README.md) · [English](README.en.md)

Compressed UI screenshots and the full-flow product demo live here.  
High-resolution sources live under `topmind-desktop/resources/img/` — that directory is **gitignored** (development machine only), so treat it as the local source library, not as a repo path.

> **Stills are the 2026-09 three-column chrome · Design System 4.0.5 (ZCode Neutral + MD3 warm paper)**: capture (**记一下**) lives on the ActivityBar; PrimaryNav = 动态 / Inbox / 交付 / 我的情况; search = ⌘K / ⌘P; the right column is the AI workspace (Chat · Suggest · List · Apps). Pixel/IA truth: `topmind-desktop/DESIGN.md`. Rows that still use 2026-08 chrome (TitleBar capture / 💡 / search / Apps) or the old cool-gray / dark theme are labeled as such — do not treat them as current.
>
> 2026-09-27 refresh: `desktop-stream.jpg` and `desktop-stream-en.jpg` both re-shot from the live app in the warm-paper theme (the English still is no longer dark mode). `desktop-ai-agent.jpg` remains a 2026-08 still of the old AI rail.
>
> Media policy: the primary stills are the compressed exports of `Stream-AI建议.png` (Chinese) and `Stream-AI建议-en.png` (same surface, English chrome). The full-flow demo uses a high-fidelity color GIF as the inline format (GitHub plays `<img>` animation natively). The MP4 is the HD download fallback.

---

## Media list

### Product demo

| File | Format | Notes |
|------|--------|-------|
| `topmind-demo.gif` | Animated GIF (800px / 12fps / two-pass palette) | **Primary display** (GitHub `<img>` inline animation; 13 scenes with fades) |
| `topmind-demo.mp4` | MP4 (H.264 / 1080p / 30fps) | HD download fallback |
| `topmind-demo.webm` | WebM (VP9) | Script-generated compatibility copy (not referenced by READMEs) |

### Core stills

| Docs image | Source (`resources/img`) | Typical use |
|------------|--------------------------|-------------|
| `desktop-stream.jpg` | `Stream-AI建议.png` | **Primary still (zh)** — 2026-09 ZCode warm-paper three-column workbench |
| `desktop-stream-en.jpg` | `Stream-AI建议-en.png` | **Primary still (en)** — same surface, English chrome, same theme |
| `desktop-ai-todo.jpg` | `AI清单.png` | AI workspace **List** pane — todos with AI provenance |
| `desktop-apps.jpg` | `AI应用.png` | AI workspace **Apps** pane — ingest · WeRead · bookkeeping |
| `desktop-editor.jpg` | live app (2026-09-16) | Quiet Paper Markdown editor + sidebar destinations row |
| `desktop-ingest.jpg` | `知识加工.png` | Multi-source ingest hub |
| `desktop-quick-capture.jpg` | live app (2026-09-16) | `⌘N` / `⌘⇧N` capture (Quick note) |
| `desktop-ai-agent.jpg` | `AI建议.png` | 2026-08 still of the old AI rail (not the 2026-09 AI workspace column) |
| `desktop-inbox.jpg` | `Stream.png` | Inbox buffer and organize |
| `desktop-inline-ai.jpg` | `文章查看-编辑器.png` | Inline AI polish and sanitize |
| `desktop-outputs.jpg` | `文章查看-编辑器.png` | Delivery |
| `desktop-settings-*.jpg` | Settings page sources | Settings center pages |

### Obsidian plugin screenshots

| Asset | Notes |
|-------|-------|
| `obsidian-stream-zh.png` | topmind Stream plugin · stream timeline (Chinese UI) |
| `obsidian-stream-en.png` | topmind Stream plugin · stream timeline (English UI) |
| `obsidian-profile-zh.png` | Plugin "My Profile" memory browse (Chinese UI) |
| `obsidian-suggestions-zh.png` | Plugin sidebar AI suggestions (Chinese UI) |
| `obsidian-todos-zh.png` | Plugin sidebar todos (Chinese UI) |

Stills other than the four panes above were exported before the three-column switch and are marked in their index rows; re-shoot them before reusing their composition for anything normative.

## Where they are used

| Document | Usage |
|----------|-------|
| [`../../README.md`](../../README.md) · [`README.zh-CN.md`](../../README.zh-CN.md) | Overview (zh): `desktop-stream.jpg` primary, English chrome alongside (bilingual demo) + GIF + MP4 fallback |
| [`../../README.en.md`](../../README.en.md) | Overview (en): `desktop-stream-en.jpg` primary, Chinese chrome alongside + GIF + MP4 fallback |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) · [`README.zh-CN.md`](../../topmind-desktop/README.zh-CN.md) | Workbench (zh): core still + List/Apps panes + GIF + interaction map |
| [`../../topmind-desktop/README.en.md`](../../topmind-desktop/README.en.md) | Workbench (en): English core still + same panes |

## Update and compose

```bash
# Export a still: fit the longest edge to 1440px, then JPEG q85
sips -Z 1440 -s format jpeg -s formatOptions 85 \
  "topmind-desktop/resources/img/Stream-AI建议.png" --out docs/images/desktop-stream.jpg

# Narrow AI-workspace pane crops are already 1x — export without resampling
sips -s format jpeg -s formatOptions 88 \
  "topmind-desktop/resources/img/AI清单.png" --out docs/images/desktop-ai-todo.jpg

# Compose topmind-demo.mp4 / webm / gif
# Two-pass palette (stats_mode=diff) keeps GIF color close to the video
node scripts/create-demo-video.mjs
```

Exporting into `docs/images/` never modifies the source PNGs — always pass `--out`.

### GIF generation

GIF uses a **two-pass palette** so color stays faithful to the video:

1. **Pass 1**: build the palette from the full video (`palettegen=stats_mode=diff:max_colors=256`)
2. **Pass 2**: apply the palette (`paletteuse=dither=sierra2_4a:diff_mode=rectangle`)
3. **Params**: 800px wide / 12fps / lanczos

This avoids the color drift of a single-pass GIF.
