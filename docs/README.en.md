# topmind documentation sitemap

[简体中文](README.md) · [English](README.en.md)

> **Product entry** [`../README.md`](../README.md) · **简体中文** [`../README.zh-CN.md`](../README.zh-CN.md)  
> Architecture lock, ADRs, packaging rules, and per-surface guides.  
> Workflow: `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整` · durable writes go only through Kernel `writeback-engine` · UTR `8 域 / 28 命令`

**README convention:** every module uses `README.md` for Simplified Chinese (GitHub default) and `README.en.md` for English. `README.zh-CN.md` is a compatibility redirect.

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
   • topmind-desktop/README.md    • PROJECT-MODEL.md             • topmind-skills/INSTALL.md
   • topmind-obsidian (sister repo)  • DESIGN.md                    • TOOLS.md
   • browser-extension/README.md  • PACKAGING.md
```

---

## 1. Surface documentation

| Surface | Role | English README | Chinese README | Architecture / design |
|---------|------|----------------|----------------|-----------------------|
| **Desktop** | Local rich-text workbench (Electron) | [`topmind-desktop/README.md`](../topmind-desktop/README.md) | [`README.zh-CN`](../topmind-desktop/README.zh-CN.md) | [`ARCHITECTURE`](../topmind-desktop/ARCHITECTURE.md) · [`DESIGN`](../topmind-desktop/DESIGN.md) |
| **Obsidian plugin** | Stream view inside an Obsidian vault | [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian) | [README.zh-CN](https://github.com/topmindspace/topmind-obsidian/blob/main/README.zh-CN.md) | [ARCHITECTURE](https://github.com/topmindspace/topmind-obsidian/blob/main/ARCHITECTURE.md) |
| **Skills** | Portable agent skill pack | [README](https://github.com/topmindspace/topmind-skills/blob/main/README.en.md) | [README.zh-CN](https://github.com/topmindspace/topmind-skills/blob/main/README.zh-CN.md) | [`SKILL-ARCHITECTURE`](../SKILL-ARCHITECTURE.md) · [INSTALL](https://github.com/topmindspace/topmind-skills/blob/main/INSTALL.md) |
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
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first use memo (numbers track `lib/activity-window.mjs`; policy: DESIGN / TOOLS / Reset) |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | Capture · Clip · Ingest capability matrix |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | Knowledge-management comparison |
| [`UIUX-AUDIT-2026-09-01.md`](./UIUX-AUDIT-2026-09-01.md) | **NON-LIVING** historical anchor (living IA: `topmind-desktop/DESIGN.md`) |

---

## 4. Architecture Decision Records

Archive: [`./adr/`](./adr/). Index is **one line per decision** — read the ADR for history.

| Date | Current constraint (one line) |
|------|-------------------------------|
| [2026-06-14](./adr/2026-06-14-desktop-ai-runtime.md) | Desktop AI Runtime — Vercel AI SDK |
| [2026-07-13](./adr/2026-07-13-browser-clip-extension.md) | Clip extension — MV3 + Readability + content_html |
| [2026-07-16](./adr/2026-07-16-desktop-agent-harness-upgrade.md) | Agent harness — edit / compact / steer |
| [2026-07-16](./adr/2026-07-16-desktop-skill-first-agent.md) | Skill-first — prefer bundled skills |
| [2026-07-16](./adr/2026-07-16-public-update-and-pack-root.md) | Public update + engine pack |
| [2026-07-17](./adr/2026-07-17-desktop-utr-bundle-tools-console.md) | Desktop UTR bundle + tools console |
| [2026-07-19](./adr/2026-07-19-knowledge-ingest-pipeline.md) | Ingest — anydoc sidecar / optional markitdown |
| [2026-07-21](./adr/2026-07-21-pi-agent-base-decision.md) | Fence / writeback / Skills still hold; **loop choice superseded 2026-09-07** |
| [2026-07-22](./adr/2026-07-22-stream-packing-and-core-memory.md) | Period-note packing + profile memory loop |
| [2026-08-02](./adr/2026-08-02-connector-bridge.md) | Connector Bridge contract |
| [2026-08-02](./adr/2026-08-02-kernel-ai-provider-context.md) | per-call aiProvider + createKernelContext |
| [2026-08-02](./adr/2026-08-02-workspace-model-split.md) | workspace-model facade split |
| [2026-08-06](./adr/2026-08-06-phase-d-desktop-hardening.md) | Desktop hardening · RPC · typed events |
| [2026-08-07](./adr/2026-08-07-comprehensive-design-optimization.md) | Visual refine (thin chrome / borders) |
| [2026-08-07](./adr/2026-08-07-desktop-single-entry-dedupe.md) | Single-entry noise cut |
| [2026-08-07](./adr/2026-08-07-engine-hardening-writeback-ai.md) | Receipt rotation · backoff · independent versions |
| [2026-08-07](./adr/2026-08-07-obsidian-plugin-architecture.md) | Standalone plugin repo · inlined Kernel |
| [2026-08-09](./adr/2026-08-09-stream-year-archive-memory-redesign.md) | Stream year dirs · periodic=reflection |
| [2026-08-13](./adr/2026-08-13-adversarial-first-principles-review.md) | Single contract writer · no AI yaml overwrite |
| [2026-08-13](./adr/2026-08-13-desktop-stream-editor-ai-review.md) | Preview ≠ live TipTap · stream strips chrome |
| [2026-08-13](./adr/2026-08-13-surface-ux-review.md) | Stream ≠ workbench · Note it ≠ Log it |
| [2026-08-16](./adr/2026-08-16-memory-consolidation.md) | Confirm-gated profile fact lifecycle |
| [2026-08-23](./adr/2026-08-23-contract-settings-integrity.md) | Repair convergence · atomic write · period stickiness |
| [2026-08-27](./adr/2026-08-27-desktop-log-rotation.md) | Support log rotation (2 MB × 3) |
| [2026-09-07](./adr/2026-09-07-pi-engine-and-three-column-reevaluation.md) | Hybrid pi-agent-core · three-column AI workspace |
| [2026-09-14](./adr/2026-09-14-product-vocabulary-rename.md) | Vocabulary: Inbox / Delivery |
| [2026-09-15](./adr/2026-09-15-boot-integrity-and-undeclared-identifiers.md) | Boot integrity · undeclared-identifier guard |
| [2026-09-15](./adr/2026-09-15-cross-platform-chrome-and-suggest-lifecycle.md) | Cross-platform chrome · batched suggest apply |
| [2026-09-17](./adr/2026-09-17-adversarial-deep-review.md) | Structural-plane fences · archive containment |
| [2026-09-17](./adr/2026-09-17b-writeback-authorization-model.md) | locked=task snapshot · graded confirm |
| [2026-09-17](./adr/2026-09-17c-adversarial-pass-fences-and-honesty.md) | Symlink fail-closed · memory single truth |
| [2026-09-17](./adr/2026-09-17e-global-memory-quality.md) | Global memory quality (dupe/restore/inject) |

Design proposals (non-ADR): [`./design/`](./design/).
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
