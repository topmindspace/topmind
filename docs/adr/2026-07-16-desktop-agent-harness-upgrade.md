# ADR: Desktop AI agent harness upgrade (edit / compact / steer)

**Date:** 2026-07-16  
**Status:** Accepted  

## Context

Desktop AI already uses Vercel AI SDK multi-step tools + skill-first protocol mapped to WorkspaceService. Evaluation against Pi Agent (pi.dev) concluded: **do not replace AI SDK** with a coding-agent harness; instead absorb Pi-style file-edit and mid-turn control patterns while keeping domain tools and writeback boundaries.

Gaps before this change:

- Writes were mostly full-file `save_file` (fragile for long notes)
- `read_file` dumped whole files into context
- Session compact was char-count only, dropped tool path gist
- No mid-turn steer / follow-up queue while streaming

## Decision

1. **Keep** `streamText` + WorkspaceService tools (no UTR hard-dep, no bash, no second process).
2. **Add** `edit_file` → `pathOps.editPath` (exact oldText→newText, unique/replaceAll). **No Archive checkpoint** for local patches — full-file save / delete / rename still backup.
3. **Add** windowed `read_file` → `pathOps.readPathWindow` (offset/limit lines, default ~400).
4. **Controlled grep**: `grepWorkspace` behind `search` (scope, skip Archive by default, line hits; no shell).
5. **Normalize** write tool results via `ai-tool-evidence.mjs` (targetPath / backupPath / affectedFiles).
6. **Steer / follow-up**: stream registry queues; `prepareStep` injects steers between agent steps; follow-ups auto-chain after turn; soft step-budget nudge.
7. **Compaction**: token-aware estimate + tool timeline + initial-goal line in middle summary.
8. **UX (low cognition)**: ambient open-file auto-included per turn; plain-language empty prompts; slash labels in Chinese; no extra task UI.

## Non-goals

- Not embedding `pi-coding-agent` or default `bash` tools  
- Not replacing skill-first progressive disclosure  
- Not making AI session state a content truth store  

## Consequences

- Local rewrites are safer and cheaper in tokens  
- Long notes require multi-read; prompts document pagination  
- Steer only applies between steps (not mid-tool-execution) — same class as Pi “after current tool”  
- Follow-up chain can start a second turn automatically when the first succeeds  
