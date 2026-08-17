# UTR — 维护政策（非功能 backlog）

> 本文描述 **现状与维护边界**，不是未完成功能路线图。命令面真源：`TOOLS.md`。

UTR is the optional deterministic substrate for topmind. The external surface is CLI/MCP command IDs; the current project tool domains run on Node-only shared core.

## Decision

- External surface: `topmind-cli`, MCP, and JSON contracts.
- Internal target: TypeScript/Node-only shared core.
- Contract runtime: `node`.
- Special-domain libraries may be called behind Node wrappers, but contract tools do not expose alternate runtimes.
- Desktop **must not hard-depend** on UTR; if it soft-loads UTR, it must preserve contract, path, save setting, dry-run/apply, receipt, and reversible-safety semantics.
- Skills primary path remains host file tools.

## Current State

1. **Command surface** — `workspace-read`, `workspace-write`, `workspace-transform`, `workspace-maintain`, `contract`, `memory`, `lifecycle`, and `derived` on Node contracts and Node tool bodies. **28 commands** total; MCP default **19** (primary+danger); advanced folded. Canonical: `TOOLS.md` §Current Command Surface + `PRODUCT-BOUNDARIES.md`.
   - Primary: list-categories/topics/files/inbox/inspect · create-topic · capture-note · save-output · memory.promote · memory.digest · memory.append-profile · memory.append-topic · contract.validate · doctor-workspace · plan-inbox-routing
   - Danger: archive-topic · archive-stream-year · restore-safety-receipt · contract.reseed
   - Advanced: list-recent-captures · list-safety-receipts · update-topic · normalize-note-metadata · migrate-v4 · cleanup-empty-dirs · lifecycle.scan · derived.rebuild · contract.ensure

2. **Shared modules (`utr/core/`)** — workspace paths, frontmatter, result envelopes, receipts, workspace audit, backup/trash, and locked/final detection. `workspace-write` runs on Node with reversible backup, locked/final revision, preview/apply, and receipt behavior. Durable `.md` content writes go through Kernel `lib/writeback-engine.mjs` (`executeWrite`). `writeback-safety.mjs` is **only** the tool-executor transactional snapshot/restore helper (not a second content write gate). Safety receipt path classification lives in `safety-receipt-paths.mjs` (list + restore).

3. **Verification**
   - `npm run utr:test`
   - `npm run utr:doctor:engine` (clean fixture)
   - `npm run utr:doctor` (local workspace)

4. **Maintenance focus**
   - Keep UTR optional: Desktop/Skills must not hard-depend on it
   - New durable content writes: Kernel `writeback-engine` only; use `writeback-safety` solely for executor transactional rollback
   - Prefer shrinking advanced surface over adding commands

## UX Contract

- `writebackMode:"auto"|"confirm"` — auto apply + receipt; confirm returns review plan
- High-risk writes require a meaningful reason when the contract says so
- Locked/final files produce revision copies instead of in-place edits

## Verification commands

```bash
npm run utr:test
npm run utr:doctor:engine
node utr/bin/topmind-cli.mjs tool list
node utr/bin/topmind-cli.mjs tool preview workspace-read list-categories
```
