# topmind documentation sitemap

[English](README.md) · [简体中文](README.zh-CN.md)

> **Product entry** [`../README.md`](../README.md) · **简体中文** [`../README.zh-CN.md`](../README.zh-CN.md)  
> Architecture lock, ADRs, packaging rules, and per-surface guides.  
> Workflow: `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整` · durable writes go only through Kernel `writeback-engine` · UTR `8 域 / 28 命令`

**README convention:** every module uses `README.md` for English (GitHub default) and `README.zh-CN.md` for Simplified Chinese.

---

## Quick paths by role

```text
               ┌──────────────────────────────────────────────┐
               │              topmind doc map                 │
               └──────────────────────┬───────────────────────┘
                                      │
       ┌──────────────────────────────┼──────────────────────────────┐
       ▼                              ▼                              ▼
   Users                          Architects / devs              Agent hosts
   • README.md                    • ARCHITECTURE-RESET.md        • SKILL-ARCHITECTURE.md
   • topmind-desktop/README.md    • PROJECT-MODEL.md             • skills/INSTALL.md
   • topmind-obsidian (sister repo)  • DESIGN.md                    • TOOLS.md
   • browser-extension/README.md  • PACKAGING.md
```

---

## 1. Surface documentation

| Surface | Role | English README | Chinese README | Architecture / design |
|---------|------|----------------|----------------|-----------------------|
| **Desktop** | Local rich-text workbench (Electron) | [`topmind-desktop/README.md`](../topmind-desktop/README.md) | [`README.zh-CN`](../topmind-desktop/README.zh-CN.md) | [`ARCHITECTURE`](../topmind-desktop/ARCHITECTURE.md) · [`DESIGN`](../topmind-desktop/DESIGN.md) |
| **Obsidian plugin** | Stream view inside an Obsidian vault | [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian) | [README.zh-CN](https://github.com/topmindspace/topmind-obsidian/blob/main/README.zh-CN.md) | [ARCHITECTURE](https://github.com/topmindspace/topmind-obsidian/blob/main/ARCHITECTURE.md) |
| **Skills** | Portable agent skill pack | [`skills/README.md`](../skills/README.md) | [`README.zh-CN`](../skills/README.zh-CN.md) | [`SKILL-ARCHITECTURE`](../SKILL-ARCHITECTURE.md) · [`INSTALL`](../skills/INSTALL.md) |
| **Clip extension** | One-click web clip and cleanup | [`browser-extension/README.md`](../browser-extension/README.md) | [`README.zh-CN`](../browser-extension/README.zh-CN.md) | [`capture-clip-matrix`](./capture-clip-matrix.md) |
| **UTR** | Deterministic CLI / MCP | [`utr/README.md`](../utr/README.md) | [`README.zh-CN`](../utr/README.zh-CN.md) | [`TOOLS.md`](../TOOLS.md) |

---

## 2. Architecture and specifications

| Document | Role | Key points |
|----------|------|------------|
| [`ARCHITECTURE-RESET.md`](./ARCHITECTURE-RESET.md) | **Architecture lock and honesty table** (only implementation truth) | Capability table, eight engines, Done / Non-goal |
| [`PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) | **Four-core boundaries** | Skills / Desktop / UTR / Obsidian independence and collaboration |
| [`PROJECT-MODEL.md`](../PROJECT-MODEL.md) | **Content model and 6 条核心规约** | Three-plane directories, naming, archive rules |
| [`DESIGN.md`](../DESIGN.md) | **Product interaction** | User concepts ≤ 5: Note it / Stream / Topic / My profile / Delivery |
| [`SECURITY.md`](../SECURITY.md) | **Security and key boundary** | Local API keys, no telemetry, network scope |
| [`AGENTS.md`](../AGENTS.md) | **Agent behavior truth** | Quality gate, dead-code checks, multi-surface versioning |

---

## 3. Packaging and product references

| Guide | Notes |
|-------|-------|
| [`PACKAGING.md`](./PACKAGING.md) | Pack and release rules: installer names, GitHub Actions, Win/Mac/Linux |
| [`images/README.md`](./images/README.md) | Screenshot and demo media index |
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first ideal-use memo (**not policy truth** — see DESIGN / TOOLS / Reset) |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | Capture · Clip · Ingest capability matrix |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | Knowledge-management comparison |
| [`UIUX-AUDIT-2026-09-01.md`](./UIUX-AUDIT-2026-09-01.md) | **NON-LIVING** 2026-09-01 snapshot (not current IA; three-column chrome is `topmind-desktop/DESIGN.md`) |

---

## 4. Active ADRs

| Date | Subject | Decision |
|------|---------|----------|
| [2026-06-14](./adr/2026-06-14-desktop-ai-runtime.md) | Desktop AI Runtime | Vercel AI SDK for Desktop AI |
| [2026-07-13](./adr/2026-07-13-browser-clip-extension.md) | Browser Clip Extension | Manifest V3 + Readability + `content_html` |
| [2026-07-16](./adr/2026-07-16-desktop-agent-harness-upgrade.md) | Agent Harness Upgrade | edit / compact / steer helper sessions |
| [2026-07-16](./adr/2026-07-16-desktop-skill-first-agent.md) | Skill-First Agent | Prefer bundled topmind skills |
| [2026-07-16](./adr/2026-07-16-public-update-and-pack-root.md) | Public Update & Pack | Public `latest.json` (no token) and engine pack |
| [2026-07-17](./adr/2026-07-17-desktop-utr-bundle-tools-console.md) | Desktop UTR Bundle | Bundled UTR and tools console |
| [2026-07-19](./adr/2026-07-19-knowledge-ingest-pipeline.md) | Ingest Pipeline | Offline ingest; default anydoc sidecar + optional markitdown/pandoc + built-in JS |
| [2026-07-21](./adr/2026-07-21-pi-agent-base-decision.md) | No full Pi coding-agent kernel | Fence / writeback / portable Skills still hold; **loop choice superseded 2026-09-07** (hybrid `pi-agent-core`) |
| [2026-07-22](./adr/2026-07-22-stream-packing-and-core-memory.md) | Stream & Core Memory | Period-note packing and profile memory loop |
| [2026-08-02](./adr/2026-08-02-kernel-ai-provider-context.md) | Kernel AI Context | Per-call `aiProvider` + `createKernelContext` |
| [2026-08-02](./adr/2026-08-02-workspace-model-split.md) | Workspace Model Split | `lib/workspace-model.mjs` facade split |
| [2026-08-02](./adr/2026-08-02-connector-bridge.md) | Connector Bridge | External connector Bridge contract |
| [2026-08-06](./adr/2026-08-06-phase-d-desktop-hardening.md) | Phase D Hardening | Desktop hardening, RPC validation, typed events |
| [2026-08-07](./adr/2026-08-07-desktop-single-entry-dedupe.md) | Single Entry Dedupe | Single-entry noise cut and UI tightening |
| [2026-08-07](./adr/2026-08-07-comprehensive-design-optimization.md) | Design Optimization | Visual refine (36/24px chrome, borders, shadows) |
| [2026-08-07](./adr/2026-08-07-engine-hardening-writeback-ai.md) | Engine Hardening | Receipt rotation, backoff retries, independent versions |
| [2026-08-07](./adr/2026-08-07-obsidian-plugin-architecture.md) | Obsidian Plugin Architecture | esbuild-inlined Kernel |
| [2026-08-09](./adr/2026-08-09-stream-year-archive-memory-redesign.md) | Stream Year Archive & Memory | Stream year dirs + year archive + periodic-as-reflection |
| [2026-08-13](./adr/2026-08-13-adversarial-first-principles-review.md) | Adversarial first-principles review | Single contract writer, AI must not overwrite yaml, delete home, one Clip converter, search in primary nav |
| [2026-08-13](./adr/2026-08-13-surface-ux-review.md) | Surface UX review | Stream ≠ workbench; Note it ≠ Log it; Clip must not teach a lite converter; archive is not a primary nav peer |
| [2026-08-13](./adr/2026-08-13-desktop-stream-editor-ai-review.md) | Stream / editor / AI review | Preview is not a live TipTap; stream composer strips chrome; Obsidian append is visible and comment-free |
| [2026-08-16](./adr/2026-08-16-memory-consolidation.md) | Memory Consolidation | Confirm-gated profile fact lifecycle: append / retire-to-history / update, industry-aligned (mem0 ADD/UPDATE/DELETE) |
| [2026-08-23](./adr/2026-08-23-contract-settings-integrity.md) | Contract & Settings Integrity | Repair convergence, backup-before-overwrite, atomic write, partial settings patches, bidirectional period-path stickiness, memory-plane contract paths (incl. skip evidence / todo / host open), settings close-path flush |
| [2026-08-27](./adr/2026-08-27-desktop-log-rotation.md) | Desktop Log Rotation | Size-capped support log (`main.log` 2 MB × 3 archives, self-healing on legacy oversized files) |
| [2026-09-07](./adr/2026-09-07-pi-engine-and-three-column-reevaluation.md) | Pi engine + three-column re-eval | Hybrid `pi-agent-core` (bash off, fenced FS); AI workspace column peer to canvas |
| [2026-09-14](./adr/2026-09-14-product-vocabulary-rename.md) | Product vocabulary rename | Inbox / 交付 / Delivery replace 收件箱 / 写出来 / Ship it; default template seeds move, existing workspace dirs do not |
| [2026-09-15](./adr/2026-09-15-cross-platform-chrome-and-suggest-lifecycle.md) | Cross-platform chrome & suggestion lifecycle | One-row Windows title bar (app-drawn strip → native popups), platform-correct chords via `formatChord`, fullscreen collapses chrome reserves, frameless float note, Windows dialog footer flip in CSS; batched suggest apply with terminal-vs-retryable failures and persisted dismissal |
| [2026-09-15](./adr/2026-09-15-boot-integrity-and-undeclared-identifiers.md) | Boot integrity & undeclared identifiers | `popupSink` was assigned but never declared — a ReferenceError in the ready handler killed every platform before its first window, past eight green gates; `install-skills.mjs` had been unparseable since the initial commit; adds a real scope-analysis check plus a test that boots the main process under a stubbed Electron |
| [2026-09-17](./adr/2026-09-17-adversarial-deep-review.md) | Adversarial deep review | Lifecycle structural-plane fences, archive-plane containment, capture dirty Esc guard, openPath realpath, todo actor=ai default |
| [2026-09-17b](./adr/2026-09-17b-writeback-authorization-model.md) | Writeback authorization model | `locked` = task-scoped snapshot (not AI deny); graded confirm (content lands; only delete/archive pending); permanent locked/core delete user-only |
| [2026-09-17c](./adr/2026-09-17c-adversarial-pass-fences-and-honesty.md) | Adversarial pass: fences & honesty | Dangling-symlink fail-closed; system safety leaves; archive verify fail-closed; memory single truth; graded-confirm UI rename; Esc guard re-arm |
| [2026-09-17e](./adr/2026-09-17e-global-memory-quality.md) | Global memory quality | Fact inventory · health (near-dupe) · restore · ranked prompt injection · organize section routing |

**Design proposals (non-ADR):**

| Doc | Topic |
|-----|-------|
| [design/2026-09-16-tools-and-logs-workspace-care.md](./design/2026-09-16-tools-and-logs-workspace-care.md) | Tools & Logs：stats · ops journal · 健康含契约 · 清理预览/去重 · C1–C9 修复 |

---

## Version numbers and truth sources

Version digits live **only** in truth files. Do not hardcode them in docs. Print every surface:

```bash
npm run versions
```

| Surface | Truth source | Policy |
|---------|--------------|--------|
| Skills Pack | [topmind-skills/topmind-pack.json](https://github.com/topmindspace/topmind-skills/blob/main/topmind-pack.json) | Independent |
| Desktop | [`../topmind-desktop/package.json`](../topmind-desktop/package.json) | Independent |
| Clip Extension | [`../browser-extension/manifest.json`](../browser-extension/manifest.json) | Independent |
| UTR | [`../utr/VERSION`](../utr/VERSION) | Follows Desktop |
| Obsidian Plugin | [topmind-obsidian/manifest.json](https://github.com/topmindspace/topmind-obsidian/blob/main/manifest.json) | Independent |
