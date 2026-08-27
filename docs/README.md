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
   • obsidian-plugin/README.md    • DESIGN.md                    • TOOLS.md
   • browser-extension/README.md  • PACKAGING.md
```

---

## 1. Surface documentation

| Surface | Role | English README | Chinese README | Architecture / design |
|---------|------|----------------|----------------|-----------------------|
| **Desktop** | Local rich-text workbench (Electron) | [`topmind-desktop/README.md`](../topmind-desktop/README.md) | [`README.zh-CN`](../topmind-desktop/README.zh-CN.md) | [`ARCHITECTURE`](../topmind-desktop/ARCHITECTURE.md) · [`DESIGN`](../topmind-desktop/DESIGN.md) |
| **Obsidian plugin** | Stream view inside an Obsidian vault | [`obsidian-plugin/README.md`](../obsidian-plugin/README.md) | [`README.zh-CN`](../obsidian-plugin/README.zh-CN.md) | [`ARCHITECTURE`](../obsidian-plugin/ARCHITECTURE.md) · [`DESIGN`](../obsidian-plugin/DESIGN.md) |
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
| [`DESIGN.md`](../DESIGN.md) | **Product interaction** | User concepts ≤ 5: Note it / Stream / Topic / My profile / Write out |
| [`SECURITY.md`](../SECURITY.md) | **Security and key boundary** | Local API keys, no telemetry, network scope |
| [`AGENTS.md`](../AGENTS.md) | **Agent behavior truth** | Quality gate, dead-code checks, multi-surface versioning |

---

## 3. Packaging and product references

| Guide | Notes |
|-------|-------|
| [`PACKAGING.md`](./PACKAGING.md) | Pack and release rules: installer names, GitHub Actions, Win/Mac/Linux |
| [`images/README.md`](./images/README.md) | Screenshot and demo media index |
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first product truth and ideal use |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | Capture · Clip · Ingest capability matrix |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | Knowledge-management comparison |

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
| [2026-07-21](./adr/2026-07-21-pi-agent-base-decision.md) | No Pi Agent Base | Stay on the Node engine; no Pi Agent shell |
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

---

## Version numbers and truth sources

Version digits live **only** in truth files. Do not hardcode them in docs. Print every surface:

```bash
npm run versions
```

| Surface | Truth source | Policy |
|---------|--------------|--------|
| Skills Pack | [`../skills/topmind-pack.json`](../skills/topmind-pack.json) | Independent |
| Desktop | [`../topmind-desktop/package.json`](../topmind-desktop/package.json) | Independent |
| Clip Extension | [`../browser-extension/manifest.json`](../browser-extension/manifest.json) | Independent |
| UTR | [`../utr/VERSION`](../utr/VERSION) | Follows Desktop |
| Obsidian Plugin | [`../obsidian-plugin/manifest.json`](../obsidian-plugin/manifest.json) | Independent |
