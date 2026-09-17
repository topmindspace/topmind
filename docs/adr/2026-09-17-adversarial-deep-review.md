# ADR 2026-09-17 — Adversarial deep review: writeback fences, capture draft, privilege defaults

Status: accepted
Supersedes: none
Related: `2026-08-13-adversarial-first-principles-review.md`, `2026-09-15-boot-integrity-and-undeclared-identifiers.md`, `2026-08-23-contract-settings-integrity.md`

## Context

A full monorepo adversarial pass (Kernel engines · Desktop UI/UX · docs/scripts/cross-surface contracts) plus independent probes. Root tests were green (501) before the pass; Desktop quality gates were green. The pass asked: where can a confused agent, a hostile `topmind.yaml` edit, a multi-surface race, or an ordinary Esc keystroke destroy data or break the documented fence?

Independently confirmed by probe (not only by reading):

| Probe | Before | After |
|-------|--------|-------|
| `executeArchive(topmind.yaml, user+confirm)` | **removed the contract** | denied |
| `executeArchive(memory/, user+confirm)` | **moved the semantic plane away** | denied |
| `executeArchive(99-归档)` | raw OS error (`copy to subdirectory of self`) | clean policy deny |
| `writeback.backup_to: "../outside/backups"` | accepted (first segment exists) | rejected / default fallback |
| Capture Esc with draft body | silent discard | dirty-confirm |
| `resolvePiToolPath` / `openPath` symlink-out | allowlist without realpath | `assertPathWithin` (openPath) |

## Decisions

### D1 — Lifecycle targets: structural planes are not archiveable

`evaluateLifecycleTarget` (writeback-engine) hard-denies:

- workspace root
- `topmind.yaml` / legacy `.topmind-config.json` (must go through `writeContract` / `ensureContract`)
- system/archive plane root (e.g. `99-归档`) — self-recursive archive was an OS error, not a policy answer
- memory plane root (`{memory.dir}`)

Content *inside* those planes remains archiveable. Tests: `tests/writeback-fences.test.mjs`.

### D2 — Archive-plane destinations are contained

`resolveArchivePlaneRel` now rejects `..` / absolute / NUL configs and re-checks the resolved destination with `isPathInsideWorkspace`. Hostile `backup_to` / `receipts` can no longer redirect locked backups, trash, or receipts outside the workspace.

### D3 — Contract file is locked for writeback

`resolveProtection` treats `topmind.yaml` as `locked`. AI auto-mode cannot `executeWrite` policy. User writes of the contract still go through `writeContract` (single writer).

### D4 — Permanent directory archive walks recoverability

`executeArchive({ permanent: true })` refuses when any descendant is locked/core-recoverable (`findProtectedDescendant`). An open `topic.md` no longer authorizes irreversible delete of locked child notes.

### D5 — Todo write privilege defaults to AI

`writeTodoList` / `buildWriteOptions` default `actor` to `"ai"` (same fail-closed posture as `memoryWriteGate`). Forgetting `actor` no longer grants user privilege + auto-confirm. Desktop/Obsidian user RPCs pass `actor: "user"` explicitly. `syncTodoToStream` plumbs originating actor instead of hard-coding `user+confirmed`.

### D6 — `isPathInsideWorkspace` `..foo` false-deny

`rel.startsWith("..")` rejected in-root names like `..foo.md`. Now compares posix `..` / `../` segments only.

### D7 — Capture Esc/Cancel dirty guard

Overlay close guard supports **veto** (`return false`). Capture registers a dirty guard; Esc, menu close, and Cancel ask before discarding body/title/attachments. Scrim was already form-safe; keyboard was not.

### D8 — `openPath` / `revealPath` realpath

Renderer allowlist now uses `assertPathWithin` (realpath both sides). A workspace-internal symlink can no longer open an outside path via system-service.

### D9 — Living vocabulary / security honesty

- Living skill/shared/capture-matrix/PRODUCT-BOUNDARIES copy updated `88-输出` → `88-交付` (historical ADRs stay frozen per `2026-09-14`).
- `SECURITY.md` documents dual-layer secrets (`safeStorage` + `state/.secret-key`) and the Linux libsecret plaintext fallback.
- `AGENTS.md` UTR domain ids aligned to registry (`workspace-read|write|transform|maintain` + `contract|memory|lifecycle|derived`).

### D10 — Archive binary head peek

`archiveFile` uses a 32KB head read for frontmatter (same as `executeDelete`) instead of loading multi-GB binaries as UTF-8.

## What was already solid (not reinvestigated)

Path fence core (realpath both sides), contract ensure/backup/atomic write, locked+AI auto deny, todo `expectedRawContent`, memoryWriteGate, precise-edit uniqueness, Desktop i18n/dead-code/undeclared gates, dialog a11y, suggest failure taxonomy.

## Deferred backlog (documented, not this pass)

| ID | Finding | Why deferred |
|----|---------|--------------|
| X1 | Corrupt `topmind.yaml` load fails open to `writeback.mode: auto` | Needs `inspectContract` on the write hot path; behavior change larger than a fence |
| X2 | `archiveStreamYear` still moves files without writeback evidence | Bulk path; needs a bulk-archive evidence contract |
| X3 | Period-note RMW without `expectedHash` | Multi-surface optimistic lock is a protocol change |
| X4 | Capture/AI stream workspace-switch flush race | Needs IPC-ack reload, not a timer |
| X5 | Locked-protection affordance missing in editor chrome | Product UI pass, not a kernel fix |
| X6 | Search recents not partitioned by workspace | localStorage key schema change |
| X7 | Clip workspace-direct write (documented intentional exception) | Must carve out of any future “all writes gated” enforcement |
| X8 | Living-doc vocabulary lint for skills | Add forbidden patterns to `check-redesign-contract` |

## Verification

```
node --test tests/writeback-fences.test.mjs
npm run root:test                 # 516 pass
cd topmind-desktop && npm run typecheck && npm run check:i18n && npm run check:undeclared && npm run check:electron
cd topmind-desktop && npx tsx --test --test-force-exit tests/settings-close-paths.test.mjs
```
