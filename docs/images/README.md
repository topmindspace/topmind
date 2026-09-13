# Desktop media and screenshot index

[English](README.md) · [简体中文](README.zh-CN.md)

Compressed UI screenshots and the full-flow product demo live here.  
High-resolution sources live under `topmind-desktop/resources/img/` in this repo (not a personal home path).

> **Stills are a 2026-08 chrome snapshot** (spanning TitleBar with Note it / 💡 / Search / Apps). Living chrome is three-column (2026-09-07): 记一下 in the left sidebar header; PrimaryNav = 动态 / 收件箱 / 写出来; search = ⌘K / ⌘P; 建议 / 清单 / 应用 in the right AI workspace. Do not copy still composition into living DESIGN.
>
> Media policy: the primary still is the compressed export of `topmind-desktop/resources/img/Stream-AI建议.png`. The full-flow demo uses a high-fidelity color GIF as the inline format (GitHub plays `<img>` animation natively). The MP4 is the HD download fallback.

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
| `desktop-stream.jpg` | `Stream-AI建议.png` | **Primary screenshot**: Stream surface + AI organize / suggestions |
| `desktop-editor.jpg` | `文章查看-编辑器.png` | Quiet Paper Markdown editor |
| `desktop-ingest.jpg` | `知识加工.png` | Multi-source ingest hub |
| `desktop-quick-capture.jpg` | `quicknote.png` | `⌘N` / `⌘⇧N` capture |
| `desktop-ai-agent.jpg` | `AI建议.png` | 2026-08 still of the old AI rail (not the 2026-09 AI workspace column) |
| `desktop-ai-todo.jpg` | `AI建议.png` | AI todo maintenance |
| `desktop-inbox.jpg` | `Stream.png` | Inbox buffer and organize |
| `desktop-inline-ai.jpg` | `文章查看-编辑器.png` | Inline AI polish and sanitize |
| `desktop-outputs.jpg` | `文章查看-编辑器.png` | Deliverables / write-out |
| `desktop-settings-*.jpg` | Settings page sources | Settings center pages |

## Where they are used

| Document | Usage |
|----------|-------|
| [`../../README.md`](../../README.md) | Overview: primary Stream still + GIF + MP4 fallback |
| [`../../README.zh-CN.md`](../../README.zh-CN.md) | Chinese overview: same media |
| [`../../topmind-desktop/README.md`](../../topmind-desktop/README.md) | Workbench: core still + GIF + interaction map |

## Update and compose

```bash
# Compress and export JPG/PNG
node -e '
  import { execSync } from "child_process";
  execSync("sips -Z 1440 topmind-desktop/resources/img/*.png");
  execSync("sips -s format jpeg -s formatOptions 85 topmind-desktop/resources/img/Stream-AI建议.png --out docs/images/desktop-stream.jpg");
'

# Compose topmind-demo.mp4 / webm / gif
# Two-pass palette (stats_mode=diff) keeps GIF color close to the video
node scripts/create-demo-video.mjs
```

### GIF generation

GIF uses a **two-pass palette** so color stays faithful to the video:

1. **Pass 1**: build the palette from the full video (`palettegen=stats_mode=diff:max_colors=256`)
2. **Pass 2**: apply the palette (`paletteuse=dither=sierra2_4a:diff_mode=rectangle`)
3. **Params**: 800px wide / 12fps / lanczos

This avoids the color drift of a single-pass GIF.
