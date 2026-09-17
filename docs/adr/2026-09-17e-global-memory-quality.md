# ADR 2026-09-17e — Global memory as a curated fact set (not an append log)

Status: accepted
Related: `2026-08-16-memory-consolidation.md`, `2026-09-17c-adversarial-pass-fences-and-honesty.md`

## Context

Product intent: 「全局记忆是非常宝贵的，不仅是简单 append」. The 2026-08-16 triad (append / update / retire) landed, but the profile remained a bare bullet list: no inventory, no health signal, no restore, no ranked prompt injection, and every surface hand-rolled a raw 2–3k char slice (history sometimes re-entering as current truth).

## Decisions

### D1 — Kernel quality API (Markdown stays sole content truth)

| API | Role |
|-----|------|
| `listProfileFacts` | Structured inventory: section · role · history flag · date · text |
| `analyzeProfileHealth` | Exact/near-dupe pairs, empty sections, oversized active, large history |
| `factSimilarity` | 0–1 score: equality · containment (≥4 CJK) · CJK bigram Jaccard |
| `restoreProfileEntry` | Inverse of retire; strips 归档 marker; refuses dest duplicate |
| `formatProfileForPrompt` | **Only** prompt entry: ranks goals/preferences/people > inProgress; whole bullets; history omitted with honest count |

### D2 — Append normalizes to a bullet

Bare prose from callers becomes `- …` so inventory / retire / update line math stays consistent.

### D3 — Ranked prompt injection everywhere

`loadProfileForPrompt` (memory_organize) · `loadProfileContext` (period analysis) · promote extract all use `formatProfileForPrompt`. Retired facts never re-enter as live bullets. No mid-bullet truncation.

### D4 — memory_organize section routing + degraded honesty

- JSON schema: `profile: [{ text, section: preferences|goals|people|inProgress }]`
- Soft-parse salvage is **degraded**: summary states 「本轮仅识别到新增候选，未能解析归档/更新意图」; state records `degradedParse`.
- Stable preferences no longer default into 进行中的事.

### D5 — Explicit non-goals (unchanged)

No embeddings · no auto-forgetting · no persisted numeric scores · no JSON fact store. Ranking and staleness are derived at read/prompt time.

## Deferred (next memory pass)

| ID | Finding | Status |
|----|---------|--------|
| M1 | Fact ids (`<!-- fid -->`) + provenance comments + match-by-fid | **done** |
| M2 | Conflict cards (new candidate vs live fact) | **done** (organize ≥0.92 → update card) |
| M3 | `reviewStaleProfileEntries` + history search | **done** (`searchProfile` + browse filter) |
| M4 | Cross-process CAS / profile journal | **journal done**; cross-process CAS still open |
| M5 | Locale-aware date markers on English profiles | **done** |
| M6 | Desktop browse: search · per-row 恢复 · health chip | **done** |

### Follow-up 2026-09-17e-2

- Bullet shape: `- （YYYY-MM-DD）正文 <!-- fid:xxxxxxxx src:path reason:x -->`
- `updateProfileEntry` archives superseded wording to history (`sup:newFid`) — audit trail
- `appendMemoryJournal` → `.topmind/memory-journal.jsonl` (system plane)
- Desktop RPC: `listProfileFacts` · `profileHealth` · `searchProfile` · `restoreProfileFact`

## Verification

```
node --test tests/memory-quality.test.mjs tests/memory-consolidation.test.mjs
npm run root:test
```
