# ADR 2026-09-17c — Adversarial pass: fence holes, graded-confirm completion, honest copy

Status: accepted
Supersedes (completes): `2026-09-17b-writeback-authorization-model.md` copy migration
Related: `2026-09-17-adversarial-deep-review.md`

## Context

A second adversarial monorepo pass (Kernel · Desktop · docs/scripts) plus independent probes. The previous 2026-09-17/b work left graded confirm half-migrated and two Kernel fence holes untested.

Independently confirmed by probe:

| Probe | Before | After |
|-------|--------|-------|
| dangling symlink `ws/note.md → /outside/pwn.md` (target missing) | classified **inside**; `writeFileSync` materializes outside | fail-closed → outside (deny) |
| `evaluateLifecycleTarget(99-归档/backups)` | allowed | denied (safety leaf) |
| Capture Esc → cancel ConfirmDialog → Esc again | second Esc discarded draft (guard one-shot) | guard stays armed |
| UI「保存前问我 · 接受后才落盘」 | lied under graded confirm | renamed「删除/归档前问我」+ graded hint |
| Desktop test suite | 4 fail (old confirm model) | 1193 + 22 pass |

## Decisions

### D1 — `realpathBestEffort` resolves dangling symlinks

When `realpathSync` throws, `lstat` the leaf; if it is a symlink, recurse on `readlink` target. A dangling link whose target is outside is classified outside (fail closed). In-workspace dangling targets stay allowed.

### D2 — System-plane safety leaves are not archiveable

`evaluateLifecycleTarget` denies `backups` / `receipts` / `trash` / `stream-archive` / `archived-topics` (and paths under them) under the system plane. `executeArchive` also refuses when the destination resolves inside the source (self-copy → disk fill).

### D3 — Archive verification is fail-closed

`countFilesRecursive` throws on readdir failure (except ENOENT). Directory archive requires `origCount === archiveCount` before `rmSync`. Unreadable source never counts as empty.

### D4 — Locked snapshot ledger marks only after successful copy

`shouldSnapshotLockedWrite` is a pure check; `markTaskSnapshotTaken` runs after `copyFileSync` succeeds. A failed first backup no longer suppresses later snapshots in the same task.

### D5 — Memory path single truth

`model-memory.resolveMemoryPaths` no longer falls back to the stream category. Contract `memory.dir` || `"memory"` matches `memory-engine.resolveMemoryDir`. Empty/invalid `dir` cannot fork a twin profile under `10-动态/`.

### D6 — `resolvePeriodMemoryPath` sanitizes its stem

Unsafe period identifiers throw (same rules as write-path `isUnsafeMemoryIdentifier`). Public kernel API cannot build `memory/periodic/../../secret.md`.

### D7 — Profile fact match is one-directional

Containment is `existing.includes(key)` only. Long queries no longer match shorter facts they contain. Section titles reject `#`, newlines, `/`, `\`, length > 80.

### D8 — Overlay close guard re-arms on veto

`runOverlayCloseGuard` keeps the guard when it returns `false`. `navigate` / `sidebar-view` await the guard **before** mutating selection.

### D9 — Graded confirm copy is honest

User-visible setting renamed: **删除/归档前问我** / **Ask before delete/archive**.
Hints state: content create/update/edit land immediately; only delete/archive enter pending.
Stale “locked + AI auto = deny” living copy removed from PROJECT-MODEL · SKILL-ARCHITECTURE · skills router/write · Obsidian DESIGN/ARCHITECTURE · AGENTS Agent bullet · writeback-engine JSDoc · ai-tools error hint.

### D10 — writebackMode contract mirror failure is loud

`SystemService.updateSettings` rethrows when mirroring to `topmind.yaml` fails and rehydrates `writebackMode` from disk. Settings can no longer show confirm while Kernel still auto-writes.

### D11 — Misc truth fixes

- AGENTS UTR domain ids = registry (`workspace-read|write|transform|maintain` + `contract|memory|lifecycle|derived`).
- ADR index lists both 2026-09-17 ADRs.
- EN product term **My profile** (not “My situation”).
- Skills pack: MCP default 19 vs registry 28.
- ARCHITECTURE-RESET honesty table + last-updated.

## What stays open (deferred)

| ID | Finding | Status after 2026-09-17d follow-up |
|----|---------|-------------------------------------|
| X2 | `archiveStreamYear` still moves without writeback evidence | open |
| X3 | Period-note RMW without `expectedHash` | open |
| X4 | Capture/AI stream workspace-switch flush race | open |
| X5 | Locked-protection affordance missing in editor chrome | open |
| X6 | Search recents not partitioned by workspace | open |
| X7 | Clip workspace-direct write (intentional exception) | open |
| X8 | Living-doc vocabulary lint for skills | open |
| Y1 | Pending-writes queue is process-lifetime only | **fixed** — durable `.topmind/pending-writes.json` |
| Y2 | Cross-process RMW races on profile/todo/ledger (no CAS) | open |
| Y3 | Large class of Desktop structural tests remain text-assertions | open |

## Follow-up 2026-09-17d — suggestion lifecycle honesty

User report: 「周期本和动态并没有更新（处置后）仍然会提示要处置」.

Root causes confirmed:
1. Empty 建议 panel open used `force: true` → re-offered every already-written digest.
2. Force bypassed `hasUsablePeriodDigest`.
3. `appliedIds` was session-only; restart re-nagged rule cards.
4. Sibling cards (`digest-` / `ai-summary-` / `mem-periodic-` same period) survived one accept.
5. Digest apply never rewrites the period note (by design) but copy did not say so.

Fixes:
- `openSuggestSurface` empty open → soft refresh only.
- Force no longer bypasses content-truth for digests.
- New durable ledger `lib/suggest-applied.mjs` (`.topmind/suggest-applied.json`, 30-day TTL); apply marks siblings.
- Digest cards capped at 2 newest eligible.
- Promote extract prompt injects profile + recent applied history.
- Digest apply note: 「周期本原文未改写」.
- Desktop ActionStore drops sibling period cards on accept.

## Verification

```
npm run root:test                 # 523 pass
npm run skills:test               # 41 pass
npm run docs:guard
cd topmind-desktop && npm test    # 1193 + 22 pass
cd topmind-desktop && npm run typecheck && npm run check:i18n && npm run check:undeclared && npm run check:electron && npm run check:dead-code
node --test tests/writeback-fences.test.mjs
```
