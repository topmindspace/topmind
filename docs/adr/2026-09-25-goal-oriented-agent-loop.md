# ADR 2026-09-25 — Goal-oriented agent loop (plan → execute → verify → continue)

Status: accepted
Related: `2026-09-07-pi-engine-and-three-column-reevaluation.md`, `2026-09-17e-global-memory-quality.md`, `2026-08-16-memory-consolidation.md`

## Context

Multi-step Desktop/Obsidian agent work (including multi-stage creative / drawing-like deliverables) died halfway for structural reasons, not model quality:

1. **No planning / acceptance criteria** — the model self-decided “done”; the only gate was a regex on the last 200 chars (`ai-service.mjs`).
2. **Pi step budget was a no-op** — `shouldStopAfterTurn` is gone in `@earendil-works/pi-agent-core@0.87`; the Agent constructor silently ignored it, so `stepLimitHit` never fired on the default runtime.
3. **Context overflow was terminal** — `result.error` broke the auto-continue loop before any compact-retry.
4. **Compaction dropped path receipts** older than 6 tool pairs, while continue prompts claimed to resume “from path receipts”.
5. **Obsidian** used a fixed 240K char compact (ignored `contextLimit`), capped auto-continue at 2, and labeled half-done work as “Finished workspace operations … step budget exhausted”.

## Decisions

### D1 — Shared goal protocol (`lib/agent-goal-protocol.mjs`)

Pure helpers used by Desktop Pi/SDK loops and Obsidian chat (vendored under `topmind-obsidian/lib/`):

| Piece | Role |
|-------|------|
| `[PLAN] … done-when: … [/PLAN]` | One-shot plan block with acceptance criteria (also covers multi-stage creative / illustration / diagram work: brief → draft → final file → spec check) |
| `GoalState` | goal · plan · criteria · pathReceipts · status |
| `assessGoalCompletion` | Heuristic done-verdict (`[DONE]` / `[INCOMPLETE]` / open criteria / step-limit). **Never claims success** — only drives continue decisions |
| `decideAutoContinue` + `resolveMaxAutoContinues` | Incomplete goals with open criteria get up to **4** continues (base 2) |
| `buildContinuePrompt` / `buildTaskLedger` | Continuation + sticky ledger (goal/plan/receipts) that compaction must re-inject |

### D2 — Pi runtime uses `finishTurn`

`shouldStopAfterTurn` is deleted. `finishTurn` counts turns, folds assistant/tool text into `GoalState`, and returns `{ action: "end" }` at the step cap with `stepLimitHit`. Outer `ai-service` auto-continues with a fresh budget + task ledger.

### D3 — Goal-aware auto-continue + overflow compact-retry

- Step limit always offers a continue; otherwise `assessGoalCompletion` decides.
- Context-length errors compact **half budget**, prepend the task ledger, and retry **once**.
- Compact re-injection always keeps the sticky `[TASK-LEDGER]` message.

### D4 — Prompts carry the protocol

`buildSystemPrompt` (Desktop) and `buildObsidianChatToolGuide` (Obsidian) embed `buildGoalProtocolPrompt`. Memory tool copy forbids spraying process logs into 我的情况.

### D5 — Obsidian honesty + budget

- Mid-turn conversation compact across auto-continues.
- Incomplete closes say **Task incomplete / 任务未完成** + ledger + open criteria — never “Finished … step budget exhausted” as success copy.
- Type budget still uses the shipped default compact (model `contextLimit` wiring remains follow-up).

### D6 — Memory hygiene (paired pass)

- Desktop agent profile injection uses `formatProfileForPrompt` (ranked, whole bullets) instead of a mid-bullet 2000-char slice.
- `append_core_memory` provenance is `<!-- src -->` meta — **not** glued into fact text.
- `memory_organize` receives `analyzeProfileHealth` pairs + `reviewStaleProfileEntries` rows + an importance rubric (durable facts only; no process spray). Stale age alone never auto-retires.

### D7 — Profile CAS (follow-up same day)

- `executeWrite` accepts `expectedHash` (CRLF-normalized) and returns `reason: "cas-mismatch"` instead of clobbering a concurrent writer.
- Profile mutations run under `.topmind/profile.cas.lock` (stale >10s broken) and retry via `retryProfileCas` (3 attempts).
- `toSurfaceEvidence` now passes `reason` through so callers can see CAS conflicts.

### D8 — UTR memory triad parity (follow-up same day)

Portable skills were append-only. Registry now exposes `memory.retire-profile` · `memory.update-profile` · `memory.compact-history` · `memory.restore-profile` (**8 域 / 32 命令**, MCP primary+danger **23**), matching Desktop ADD / UPDATE / RETIRE / RESTORE + history compact.

### D9 — Pi-native capabilities (follow-up same day)

Use Pi’s own wheels instead of parallel ones (root exports only — no deep imports):

| Need | Pi API | topmind wire |
|------|--------|--------------|
| Smart compaction | `prepareCompaction` + `compact` + `Models.completeSimple` | `electron/ai-pi-runtime.mjs` (`createSummaryModels` / `compactPiMessagesLlm`) — AI SDK `generateText` adapter; customInstructions keep goal/plan/receipts; fallback `maybeCompactPiMessages` |
| In-run continue | `getFollowUpMessages` | `createGoalFollowUps` — one follow-up when `doneCriteria` still open, before spending an outer auto-continue |
| Sticky context | `prepareRequest` | `createLedgerPrepareRequest` — re-inject `[TASK-LEDGER]` if compaction dropped it |
| Step gate + verify | `finishTurn` | Step cap `{action:"end"}`; **verification-before-done**: tools ran + `[DONE]` without path receipts → `incomplete` |

### D10 — Memory evaluation (keep the current split)

Industry check (Letta/mem0/Zep/Generative Agents) vs topmind:

- **Keep** `memory/profile.md` as long-term truth + session compaction as ephemeral. Always-on memory-extraction tools would add write amplification and a second truth store (violates PRODUCT-BOUNDARIES).
- **Keep** triad (append/update/retire) + health/stale review + ranked inject — already mem0-equivalent, confirm-gated.
- **Optional later**: after `agent_end`, distill from Pi `CompactionDetails.readFiles/modifiedFiles` into `memory_organize` candidates (not this pass).

### D11 — Goal layer in the UI

Renderer previously never saw the goal protocol. Now:

- Desktop `ai-store`: `streamGoal` / `streamAutoContinues` from `goal-status` events; `GoalStatusChip` (plan N/M · open criteria · continue ×N · incomplete/done · receipts).
- Obsidian: incomplete badge (`[INCOMPLETE` / 任务未完成) and `Goal met` chip on the tool footer — incomplete no longer looks like success.

### D12 — Skills + distill + budgets (follow-up)

- **Skills discovery** uses Pi `formatSkillsForSystemPrompt` (`<available_skills>` with absolute `location`) plus the compact topmind routing line; activation still `load_skill` (progressive disclosure). `toPiSkills` maps catalog → Pi `Skill`.
- **Memory distill hint**: Pi `CompactionDetails.readFiles/modifiedFiles` + path receipts → `memoryDistillHint` on invoke result → optional `distillHint` in `memory_organize` prompt (confirm-gated; never auto-writes).
- **Obsidian compact budget** scales with `contextLimit` via `resolveChatCompactBudget` (Desktop `resolveCompactBudget` parity).
- **UTR** `memory.restore-profile` completes the triad inverse (**8 域 / 32 命令**, MCP primary+danger **23**).

### D13 — Cross-surface audit pass (2026-09-25 evening)

- **Skills pack** (`topmind-skills`) now matches the live registry: `command_count: 32`, `mcp_default_count: 23`, memory vocabulary includes retire/update/compact/restore.
- **Capture name**: Obsidian accepts `capture` and Desktop `capture_to_inbox` (alias; logs as `capture`).
- **Memory fence**: Obsidian honors contract `memory.dir` (not only hardcoded `memory/`); Desktop memory triad chat tools vs Obsidian Suggest-only is documented in AGENTS.md.
- **Footprint**: merged `pi-native-compact.mjs` → `ai-pi-runtime.mjs`, `clip-dest-modes.mjs` → `fs-utils.mjs`; deleted unused exports (`listSkillCatalogAsync`, `kernelEnsureContract`, `describeWritebackModeBrief`, `peekNotesIndex`, `resetWorkspaceModelLibCache`).
- **Goal chip ownership**: `AiMessage.goal` is stamped at invoke end; live `streamGoal` is cleared afterward so history rows do not all show the same chip.
- **Distill loop closed**: `rememberDistillHint` / `consumeDistillHint` feed `memory_organize` with the last run’s file ops (single-use).
- **UI race hardening**: stream `gen` guards every message patch + delta flush; follow-up chain uses `followUpChainAborted` (not the invoke gen); `cancelStream` always clears spinner (`try/finally`) and stamps incomplete goal onto the last assistant; `load_skill` tracking moved into the live `tool-result` branch; ChatMessage hooks run before the system early-return; `runActivityOps` reports `ok/errors` so task toasts stop saying success when every op failed.

### D14 — AI UI/UX industry parity (2026-09-25 night)

Align Desktop + Obsidian chat with common agent-UI practice (Claude Code / Cursor / Copilot) without new wheels:

- **Stop**: Esc while streaming cancels on both surfaces (plus existing stop button).
- **Tool timeline**: failed tools show the error icon (not a green check); Obsidian tool chips with a workspace path are clickable and open the file.
- **Goal receipts**: `pathReceipts` are clickable path chips (not a bare count); semantic alpha ramps (`bg-error/10`) replaced with `bg-surface-muted` + token text colors (AGENTS color discipline).
- **a11y**: `aria-live="polite"` on Desktop stream status and Obsidian thinking row.
- **One vocabulary**: ChatInput placeholder uses `streamStatusLabel` only (no parallel `statusHint` fork); duplicated Obsidian `.tm-chat-tool-chip` CSS removed.

## Non-goals

- No image-generation tool in the workspace toolset (creative work is planned as checkable **files**). Host-level image tools stay outside Kernel.
- No auto-forgetting / embeddings (unchanged from 2026-08-16 / 2026-09-17e).
- No transactional multi-file rollback — path receipts + honest incomplete status remain the recovery model.

## Verification

```
node --test tests/agent-goal-protocol.test.mjs tests/memory-quality.test.mjs tests/memory-consolidation.test.mjs
cd topmind-desktop && npx tsx --test --test-force-exit tests/ai-autocontinue-hash.test.mjs tests/pi-agent-runtime.test.mjs
cd topmind-obsidian && npm test
```
