# ADR 2026-09-17b — Writeback authorization model: locked = task snapshot, not AI deny

Status: accepted
Supersedes (partial): earlier “locked + AI auto = hard deny” policy in writeback-engine and product copy
Related: `2026-09-17-adversarial-deep-review.md`, `2026-08-07-engine-hardening-writeback-ai.md`, `2026-09-07-pi-engine-and-three-column-reevaluation.md`

## Context

Product review found the write gate too strict and too noisy:

1. **`locked` meant “AI cannot write in auto”** — multi-step agent work on important notes was blocked or forced into confirm mode.
2. **Every locked overwrite created a backup + YAML receipt** — a 10-edit task produced 10 backups.
3. **Receipt story was fuzzy** — users/agents could not tell evidence vs YAML receipt vs ops journal.
4. **Edit tools felt brittle** — prompts demanded `edit_file` for everything; models thrash `oldText` on multi-paragraph rewrites.

User product intent (this pass):

- Workspace-controllable fence stays absolute.
- Choosing an agent inside the workspace **is** authorization for routine writes.
- `locked` = “important → keep a recoverable snapshot”, **not** “hands off”.
- Snapshot **once per AI task**, not per tool call.
- Open files: agent writes freely; receipt = path evidence, not a second YAML file.
- Interaction: confirm mode for cautious review; destructive ops stay gated.

## Decisions

### D1 — Authorization model (final: 2026-09-17b loosen)

```text
Workspace fence (symlink-resolved)     → absolute deny outside
Agent session inside fence             → authorized to write
open                                   → write immediately (auto); evidence only
locked content edit                    → allowed; first write in task snapshots + YAML receipt
locked delete / archive (recoverable)  → allowed in auto (trash/destination + receipt)
permanent delete of locked/core        → user-only (AI denied)
writeback.mode=confirm                 → **graded**: content create/update/edit land immediately; only delete/archive pending
topmind.yaml                           → never via executeWrite (writeContract only)
```

### D2 — Task-scoped locked snapshot

`executeWrite({ taskId })`. Desktop agent passes `sessionId` as `aiTaskId` on the tool ctx.

- First write of a locked file in a task → rotating backup + YAML receipt.
- Later writes of the same file in the same task → in-place update, no second backup/receipt.
- No `taskId` (UTR one-shot, user RPC) → every locked overwrite still snapshots (safe default).

Ledger is process-local (`Map` in writeback-engine). Exported: `shouldSnapshotLockedWrite`, `resetTaskBackupLedger`.

### D3 — Receipt definition (anti-redundancy)

| Layer | When | Carrier |
|-------|------|---------|
| Tool evidence | every write | return: targetPath · wroteFiles · backupPath? · receiptPath? |
| YAML receipt | high-impact recovery trail only | `{system}/receipts/*.yaml` (locked first snapshot · recoverable delete/archive) |
| ops journal | every tool/maintain | Desktop `logs/ops.jsonl` (audit, **not** a second receipts store) |

`receiptPath` is non-null only when a real YAML file was written. Open-file writes never invent receipts.

### D4 — Tool protocol reliability

Prompts no longer force `edit_file` for every change:

- Small surgical → `edit_file` unique-span.
- Multi-paragraph / restructure / 2× failed edit → `save_file` full body (locked multi-edit is now cheap).
- Self-heal once, then switch tools — do not thrash `oldText`.

Pi native `read`/`write`/`edit` remain fenced aliases onto the same tools (unchanged ADR 2026-09-07).

### D5 — Cross-surface copy

Updated: `skills/shared/writeback-receipt.md`, `SECURITY.md`, root `DESIGN.md`, Desktop `writeback-mode-copy.mjs`, Obsidian `kernel-workspace-ops` writeback line, AGENTS Current Truth.

## What intentionally stays strict

- Path fence outside workspace.
- Contract file only via `writeContract` / `ensureContract`.
- Structural plane roots not archiveable (`evaluateLifecycleTarget`).
- Permanent directory archive refuses locked/core descendants (AI).
- AI permanent delete of locked/core (file or dir) denied — recoverable path only.

## Verification

```
node --test tests/writeback-engine.test.mjs tests/writeback-fences.test.mjs
npm run root:test
cd topmind-desktop && npm run typecheck && npm run check:i18n
```
