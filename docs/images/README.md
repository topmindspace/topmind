# Desktop media and screenshot index

[English](README.md) · [简体中文](README.zh-CN.md)

Compressed UI screenshots and the full-flow product demo live here.  
High-resolution sources live under `topmind-desktop/resources/img/` — that directory is **gitignored** (development machine only), so treat it as the local source library, not as a repo path.

> **Stills are the 2026-09 three-column chrome**: 记一下 sits in the left sidebar header; PrimaryNav = 动态 / Inbox / 交付; search = ⌘K / ⌘P; the right column is the AI workspace (对话 / 建议 / 清单 / 应用). Where a still is left over from the 2026-08 chrome (TitleBar with Note it / 💡 / Search / Apps) the row says so explicitly — do not read it as living chrome.
>
> Media policy: the primary still is the compressed export of `topmind-desktop/resources/img/Stream-AI建议.png` (Chinese) and `Stream-AI建议-en.png` (same surface, English chrome). The full-flow demo uses a high-fidelity color GIF as the inline format (GitHub plays `<img>` animation natively). The MP4 is the HD download fallback.

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
| `desktop-stream.jpg` | `Stream-AI建议.png` | **Primary still (zh)**: three-column workbench, stream timeline + AI 建议 pane |
| `desktop-stream-en.jpg` | `Stream-AI建议-en.png` | **Primary still (en)**: same surface with English chrome |
| `desktop-ai-todo.jpg` | `AI清单.png` | AI workspace **List** pane — todos with AI provenance |
| `desktop-apps.jpg` | `AI应用.png` | AI workspace **Apps** pane — ingest · WeRead · bookkeeping |
| `desktop-editor.jpg` | `文章查看-编辑器.png` | Quiet Paper Markdown editor |
| `desktop-ingest.jpg` | `知识加工.png` | Multi-source ingest hub |
| `desktop-quick-capture.jpg` | `quicknote.png` | `⌘N` / `⌘⇧N` capture |
| `desktop-ai-agent.jpg` | `AI建议.png` | 2026-08 still of the old AI rail (not the 2026-09 AI workspace column) |
| `desktop-inbox.jpg` | `Stream.png` | Inbox buffer and organize |
| `desktop-inline-ai.jpg` | `文章查看-编辑器.png` | Inline AI polish and sanitize |
| `desktop-outputs.jpg` | `文章查看-编辑器.png` | Delivery |
| `desktop-settings-*.jpg` | Settings page sources | Settings center pages |

Stills other than the four panes above were exported before the three-column switch and are marked in their index rows; re-shoot them before reusing their composition for anything normative.

## Where they are used

| Document | Usage |
|----------|-------|
| [`../../README.md`](../../README.md) | Overview (en): `desktop-stream-en.jpg` + GIF + MP4 fallback |
| [`../../README.zh-CN.md`](../../README.zh-CN.md) | Overview (zh): `desktop-stream.jpg` + GIF + MP4 fallback |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) | Workbench: core still + List/Apps panes + GIF + interaction map |
| [`../../topmind-desktop/README.zh-CN.md`](../../topmind-desktop/README.zh-CN.md) | Same, Chinese |

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
