# ADR: Re-evaluate Desktop AI engine (Pi @earendil-works 0.85) and three-column chrome

**Date:** 2026-09-07  
**Status:** Accepted  
**Kind:** analysis / decision; **shipped** hybrid `pi-agent-core` + AI workspace chrome (2026-09-07)  
**Surfaces:** Desktop AI · Skills pack · UTR (optional) · Obsidian (Pi-independent)  
**Supersedes:** 2026-07-21 **loop choice only** (no `pi-agent-core` this cycle). **Reaffirms** that ADR’s fence / writeback / portable Skills / no full `pi-coding-agent` kernel, and `2026-06-14-desktop-ai-runtime.md` (LLM bytes still AI SDK v7) after applying the re-open triggers to **current** Pi.  
**Related:** `2026-07-16-desktop-agent-harness-upgrade.md` · `2026-07-16-desktop-skill-first-agent.md` · `docs/ARCHITECTURE-RESET.md` · `PRODUCT-BOUNDARIES.md` · `topmind-desktop/DESIGN.md` · `docs/UIUX-AUDIT-2026-09-01.md`

Current-Pi research capture (npm + `gh api`; `pi.dev` HTTP blocked in the eval environment): see the session scratch `pi-current.md`. Facts needed to follow this ADR without that file are inlined below.

> **Vocabulary superseded (2026-09-14):** the PrimaryNav words recorded below (`动态 · 收件箱 · 写出来`) are now `动态 · Inbox · 交付`. Chrome layout, column model and the Pi verdict are unaffected — see [`2026-09-14-product-vocabulary-rename.md`](./2026-09-14-product-vocabulary-rename.md).

---

## Independently readable decisions

**PI verdict:** Switch the Desktop **embedded agent loop** to `@earendil-works/pi-agent-core` (not the full `pi-coding-agent` kernel); keep Kernel writeback as the only write gate; map Pi native `read`/`write`/`edit` through `electron/lib/pi-fenced-fs.mjs`; **bash stays off by default**.

**Layout (a):** **Move** AI 建议, AI todo, and Apps into the right **AI workspace** (panes 对话 / 建议 / 清单 / 应用) — that column is a peer of the center content canvas, not a chat-only sidebar.

**Layout (b):** **Move** the workspace switcher to the left-sidebar bottom (Outlook / ZCode); PrimaryNav and ⌘K live on the **center-column** chrome (not a spanning TitleBar).

**Layout (c):** Center-column chrome hosts view-switch + injected actions + AI-column toggle. 记一下 is the left header; 建议/清单/应用 are AI workspace panes (icons on TitleBar are not a fourth PrimaryNav). Columns are through-going; there is no spanning product command bar.

**Pi pin:** `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` are a **paired pin** (same version spec). They can be version-checked and bumped without bumping Electron / React / Vite / AI SDK majors. Official embed: in-process `Agent` + host-injected tools; not full `pi-coding-agent`.

---

## Context

The product goal is an AI-native personal workbench. A recurring claim is that switching the **embedded** Desktop AI engine to Pi (pi.dev) would avoid reinventing wheels and make capability more open, free, reliable, and complete.

July 2026 already decided against that (`2026-07-21`), against **then-current** `@mariozechner/pi-*@0.73.x`, with explicit re-open triggers — not a forever ban. Since then:

- npm namespace moved: live packages are **`@earendil-works/pi-*@0.85.1`** (2026-09-05). `@mariozechner/pi-coding-agent` is **frozen at 0.73.1** (2026-05-07). Evaluating 0.73.x would invalidate this verdict.
- Desktop **LLM bytes** still come from Vercel AI SDK v7 providers (`ai` ^7.0.37). The **agent loop** is `@earendil-works/pi-agent-core` (`electron/ai-pi-runtime.mjs`); `streamText` is the module-load fallback. Skill-first prompts (`electron/ai-prompts.mjs`) and 31 named tools in `electron/lib/ai-tool-names.mjs` still go `ai-tools.mjs` → WorkspaceService → Kernel `writeback-engine`.
- Harness already absorbed Pi-style **edit / windowed read / compact / steer** (`2026-07-16`); Pi-native names now **alias** those tools through `electron/lib/pi-fenced-fs.mjs`.

This ADR applies the 2026-07-21 re-open triggers to **current** Pi and records fence, tool, prompt/UI/config/deps, and three-column chrome. **Shipped in the same cycle:** `ai.invoke` → `runPiAgent`; fenced `read`/`write`/`edit`/`grep`; bash off; right column = AI workspace (对话 / 建议 / 清单 / 应用); workspace switcher on the left-sidebar footer.

### Current Pi (post-Earendil) — facts used

| Item | Fact | Source |
|------|------|--------|
| Packages | `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai` all **0.85.1** | `npm view` 2026-09-07 |
| Frozen | `@mariozechner/pi-coding-agent@0.73.1` | `npm view` |
| Cadence | 0.74.0 (2026-05-07) → 0.85.1 (2026-09-05): **45 versions / ~4 months**, still 0.x | npm `time` |
| Default tools | `read` / `write` / `edit` / `bash`; optional `grep` / `find` / `ls` | coding-agent `docs/quickstart.md` via `gh api` |
| Sandbox | **None.** Tools + extensions run with **process** permissions | `docs/security.md` |
| Write-approval | **None built-in.** Philosophy: “No permission popups” | README Philosophy + security.md |
| Project trust | Loads `.pi/` extensions/settings; **does not** restrict tool FS/bash | security.md |
| Sessions | `~/.pi/agent/sessions/` (JSONL tree). Uninstall leaves `~/.pi/agent/` | quickstart.md |
| Embed A | `pi-agent-core`: `new Agent({ streamFn })` — host injects tools (no default bash) | `packages/agent/README.md` |
| Embed B | `pi-coding-agent` SDK `createAgentSession()` — default coding toolset; also RPC/TUI | `docs/sdk.md` |
| SDK extras | `session.steer()` / `session.followUp()`; `tools: ["read","bash"]` can subset | sdk.md |

`pi.dev` HTTP was SSRF-blocked here; versions and security quotes are from npm + `gh api repos/earendil-works/pi`.

### Current Desktop AI — facts used

- Runtime: `electron/ai-service.mjs` → `runPiAgent` (`electron/ai-pi-runtime.mjs`); fallback `runStream` / `electron/ai-stream.mjs` (`streamText`) only if the Pi module fails to load.
- Prompts: `electron/ai-prompts.mjs` — skill-first, “do not launch external processes”, workspace-relative paths, writeback-mode copy, output-language policy.
- Tools: `AI_TOOL_NAMES_READ` (15) + `AI_TOOL_NAMES_WRITE` (16) in `electron/lib/ai-tool-names.mjs`; builders in `electron/ai-tools.mjs`.
- Fence: Kernel `isPathInsideWorkspace` + `evaluateWritePermission` (`lib/model-core.mjs`, `lib/writeback-engine.mjs`); Desktop `sp()` → `assertPathWithin` (`electron/lib/workspace-helpers.mjs`, `path-safety.mjs`); `fetch_url` rejects non-`http(s)` (`workspace-fetch-ops.mjs`); no bash tool. Outside local reads: `evaluateOutsideRead` (authorized until explicit). Tests: `tests/workspace-containment.test.mjs`.
- Four-surface constraint: Skills pack + Obsidian + UTR stay Pi-independent. Obsidian chat is **not** this AI SDK stack. UTR remains optional (8 domains / 28 commands).

---

## Decision

1. **Switch the embedded agent loop** to `@earendil-works/pi-agent-core` (named hybrid). Not the full `pi-coding-agent` CLI/TUI/default-bash kernel.  
2. **Keep** Kernel writeback + `isPathInsideWorkspace` as the only durable write gate. Pi native `read`/`write`/`edit` map through `electron/lib/pi-fenced-fs.mjs` onto Desktop `read_file` / `save_file` / `edit_file`.  
3. **bash stays off by default.** Unscoped shell would bypass the fence; compensating control is omit, not wrap.  
4. **Keep** domain tools (capture / topics / memory / todos / skills) as named Pi-registered tools — they must not become `bash`. UTR remains optional. Skills pack / Obsidian stay Pi-independent.  
5. **`~/.pi` sessions are not content truth.**  
6. **Chrome:** three through-going columns (left nav, center canvas, right AI workspace). Product commands live on column chrome — not a spanning TitleBar. Workspace switcher is the left-sidebar footer.  
7. **Pi pin** is independent of the rest of the Desktop stack: bump `pi-agent-core` + `pi-ai` together; do not couple that bump to Electron / React / Vite / AI SDK majors.

Chosen named option: **hybrid `pi-agent-core`** (not keep-SDK, not full coding-agent embed). **Shipped:** fenced FS mapper, AI workspace chrome, `ai.invoke` → `runPiAgent` (AI SDK StreamFn; providers unchanged), Pi `shouldCompact` + Desktop fold in `transformContext`, fenced `read`/`write`/`edit`/`grep` aliases, RuntimeBadge names the Pi loop. Fallback to `streamText` only if the Pi module fails to load. Bash remains off.

---

## Testing the claim (“Pi avoids reinventing wheels / more open, free, reliable, complete”)

July complexity split still holds and is **not** deleted by Earendil 0.85:

| Slice | Approx. | Survives a Pi swap? |
|-------|---------|---------------------|
| Domain model (categories / topics / stream / memory / contract) | ~40% | Yes — Kernel, not the agent loop |
| Domain tools (31 named) | ~20% | Yes — must stay; cannot become Pi `bash` |
| Portable skills protocol | ~15% | Yes — pack must run on Claude/Codex/etc., not `~/.pi` |
| Generic harness (loop, stream, compact, steer) | ~20% | This is what Pi sells — and Desktop **already absorbed** the useful bits |
| Electron/React copilot UI | rest | Pi TUI/SDK events are a **new** mapping, not a deletion |

**Avoid reinventing wheels — false as a swap reason.** Wheels worth copying (unique-span edit, windowed read, token compact, mid-turn steer, follow-up) are already on the AI SDK path (`edit_file`, `read_file` offset/limit/around/heading, `compactMessagesForModel`, `steerStream` / `prepareStep`). Remaining Pi wheels are bash, unscoped FS, TUI, session tree under `~/.pi`, and extension packages. Those conflict with writeback ethics. Swapping would **add** adapter wheels (event mapping, permission gate, fence wrapping, dual provider stack `pi-ai` vs `@ai-sdk/*`, 0.x pin).

**More open — the wrong kind of open.** Pi is MIT and extension-first. For a coding agent that is a feature. For this workbench, default bash + process-level FS is a **fence leak**. Portable Skills already open the workflow across hosts. Binding Desktop to Pi packages / `~/.pi/agent` would **narrow** host portability.

**More free — conflicts with “可靠”. ** Pi’s philosophy is “no permission popups”. Desktop’s product lock is confirm-gated high-impact writes, locked files AI cannot overwrite, and `writeback.mode: auto|confirm`. Unconstrained tool freedom is the opposite of Kernel writeback.

**More reliable — not at 0.85.1.** 45 releases in four months; no sandbox; write-approval is DIY extensions. Reliability here comes from `evaluateWritePermission` + `isPathInsideWorkspace` + receipts, which Pi does not ship. AI SDK v7 is a stable major with a patch-line policy already encoded in `check-dependency-policy.mjs`.

**More complete — domain completeness is already ours.** Pi core **omits** MCP, sub-agents, plan mode, permission popups, built-in todos. Desktop already has skills runtime, `memory/todo.md`, suggest-engine, profile lifecycle, pending writes, multi-provider settings. Completeness for an AI-native **workbench** is categories/topics/stream/memory/writeback — none of which Pi native tools implement.

**Product choice (same date):** the arguments above still **reject full `pi-coding-agent`** (default bash, unscoped FS, `~/.pi` as truth, TUI). They do **not** reject named hybrid `pi-agent-core` with Desktop tools, fenced FS aliases, and bash omitted. After an AI-native workbench push, that hybrid **shipped**. This section remains the rationale for the fences.

---

## Re-open triggers (ADR 2026-07-21) applied

| # | Trigger | 2026-09-07 |
|---|---------|------------|
| 1 | AI SDK path has a **structural** defect cheaper to fix by adapting Pi core | **Unmet for full swap.** Providers + compact/steer/edit already worked. The loop was swapped for an AI-native workbench, not because `streamText` was broken. |
| 2 | Explicit product need for “自由智能体模式” **and** acceptance of an external process or dual UX | **Met as hybrid workbench, not as a thin coding-agent shell.** Polar star remains rich workbench + confirm-gated copilot (`ARCHITECTURE-RESET` Non-goals: 不内嵌通用 coding agent / 默认 shell). Shipped: in-process `pi-agent-core`, bash omitted, no dual TUI. |
| 3 | Maintenance budget to pin + adapter + regression on a quarterly cadence | **Accepted as the hybrid tax.** Pi 0.74→0.85 in four months is still a pin cost; compensating control is **not** taking full `pi-coding-agent`. |

Further re-open (full coding-agent kernel) still requires: first-class **external host docs** → never jump to default bash / `~/.pi` sessions as content truth.

---

## Workspace fence (per Pi option)

Existing controls (must be named; they are the current truth):

- `isPathInsideWorkspace` — `lib/model-core.mjs` (strictly inside root; rejects `..`, absolute, sibling-prefix).
- `evaluateWritePermission` — `lib/writeback-engine.mjs` (hard-denies outside root; locked + `actor !== "user"` denied).
- `evaluateOutsideRead` — `lib/model-core.mjs` (outside local read denied until `authorized: true`).
- Desktop `sp()` → `assertPathWithin` — `electron/lib/workspace-helpers.mjs` + `path-safety.mjs` (realpath / symlink).
- `fetch_url` — `workspace-fetch-ops.mjs`: `if (!/^https?:\/\//iu.test(url))` throw; **no `file://`**.
- **No default bash tool** in `AI_TOOL_NAMES_*`.
- Tests: `tests/workspace-containment.test.mjs`.

| Option | Writes cannot land outside workspace root? | Outside local reads need explicit auth? | bash / unscoped FS | Fence verdict |
|--------|--------------------------------------------|-----------------------------------------|--------------------|---------------|
| **Shipped hybrid: in-process `pi-agent-core`** | **Yes** — aliases go through `pi-fenced-fs.mjs` → Desktop `read_file`/`save_file`/`edit_file` → writeback + `sp()`/`assertPathWithin` | **Yes** — empty / `..` / sibling-prefix / absolute-outside denied on the fenced entry; `evaluateOutsideRead` still gates Kernel outside reads | **bash off**; `fetch_url` http(s) only; grep `scope` is fenced | **Holds** (chosen) |
| **Keep AI SDK `streamText` only** | **Yes** — writeback + `sp()`/`assertPathWithin` | **Yes** — `evaluateOutsideRead`; AI `read_file` workspace-relative | No bash; `fetch_url` http(s) only | Holds as **fallback** when the Pi module fails to load |
| **Switch embed to `pi-coding-agent`** (default tools) | **No** by default — `write`/`edit`/`bash` use process permissions; project trust is not a write gate | **No** by default — `read` is unscoped | Default `bash` can read/write anywhere the OS user can, **even if** write/edit were wrapped | **Reject** |
| **External-host-only** | Desktop path **unchanged** | Desktop path **unchanged** | External `pi` is the user’s OS user; product does not route those writes through writeback | Desktop fence holds. `~/.pi` sessions are not content truth. |

Any Pi-native `bash` or unscoped path that bypasses writeback is **rejected** as a Desktop default. Compensating control is not “trust project trust” or a third-party pi-permissions package.

---

## Tools vs Pi native

Shipped names (do not reconstruct): `electron/lib/ai-tool-names.mjs`.

**Read (15):** `list_skills`, `load_skill`, `load_skill_resource`, `workspace_overview`, `list_categories`, `list_topics`, `list_topic_files`, `get_topic`, `read_file`, `search`, `list_inbox`, `list_outputs`, `fetch_url`, `workspace_health`, `list_todos`.

**Write (16):** `capture_to_inbox`, `save_note`, `save_file`, `edit_file`, `create_topic`, `append_topic_memory`, `append_core_memory`, `retire_core_memory`, `update_core_memory`, `reconcile_week`, `move_to_topic`, `publish_to_outputs`, `delete_path`, `rename_path`, `add_todo`, `toggle_todo`.

Classification: **keep** = stay Desktop/Kernel tools. **upgrade** = improve in place (not via Pi). **drop** = remove. **map-to-Pi-native** = replace with Pi `read`/`write`/`edit`/`bash`/`grep`/`find`/`ls`.

Domain tools (categories / topics / stream / memory / capture / todos / skills) **must not silently become Pi `bash`**. UTR is **not** replaced by Pi.

| Class | Tool | Classif. | Notes |
|-------|------|----------|-------|
| skills | `list_skills` | **keep** | Progressive disclosure; Pi Skills/packages are a different tree (`~/.pi`, pi packages). |
| skills | `load_skill` | **keep** | Portable pack (`skills/`) must stay host-agnostic. |
| skills | `load_skill_resource` | **keep** | |
| capture | `capture_to_inbox` | **keep** | Defaults to stream period; forceInbox / forceAtom. Not `write` to a cwd file. |
| capture | `fetch_url` | **keep** | http(s)+Readability; `render=true` SPA. **Not** bash `curl`. Already upgraded. |
| browse | `workspace_overview` | **keep** | One-shot categories+inbox+stream+outputs. |
| browse | `list_categories` | **keep** | Role-discovered `{NN-…}`, not a hardcoded whitelist. |
| browse | `list_topics` | **keep** | |
| browse | `list_topic_files` | **keep** | |
| browse | `get_topic` | **keep** | topic.md home. |
| browse | `list_inbox` | **keep** | |
| browse | `list_outputs` | **keep** | |
| read/search | `read_file` | **keep** (already upgraded) | Windowed numbered read (`offset`/`limit`/`around`/`heading`). Pi `read` is a **fenced alias** onto this tool (default window 2000 lines), not unscoped Pi native. |
| read/search | `search` | **keep** (already upgraded) | Controlled grep; skip Archive by default; **no shell**. Pi `grep` is a **fenced alias** onto `search` (query is not a file path; `scope` is fenced). |
| write/edit | `edit_file` | **keep** (already upgraded) | Unique-span via `applyUniqueSpan` → writeback. Pi `edit` is a **fenced alias** onto this tool. |
| write/edit | `save_file` | **keep** | Full overwrite; locked denied for AI. Pi `write` is a **fenced alias** onto this tool. |
| write/edit | `save_note` | **keep** | Topic-scoped create. |
| write/edit | `create_topic` | **keep** | `{类别}/{YYYY-主题}/` + `topic.md`. |
| write/edit | `move_to_topic` | **keep** | |
| write/edit | `publish_to_outputs` | **keep** | Delivery plane. |
| write/edit | `delete_path` | **keep** | Honest delete (trash only locked/core). |
| write/edit | `rename_path` | **keep** | |
| write/edit | `reconcile_week` | **keep** | Deterministic stream packing. |
| memory | `append_topic_memory` | **keep** | |
| memory | `append_core_memory` | **keep** | Profile append; confirm path. |
| memory | `retire_core_memory` | **keep** | Archive to `## 历史记录`, do not delete. |
| memory | `update_core_memory` | **keep** | In-place fact update. |
| todos | `list_todos` | **keep** | `memory/todo.md`. Pi has **no** built-in todos (README philosophy). |
| todos | `add_todo` | **keep** | |
| todos | `toggle_todo` | **keep** | |
| health | `workspace_health` | **keep** | loop/doctor-shaped JSON. |

**drop:** none of the 31.  
**map-to-Pi-native:** **none as replacements.** Pi-native names `read`/`write`/`edit`/`grep` are **aliases** onto the Desktop tools above via `pi-fenced-fs.mjs`; they must not become unscoped Pi native tools or `bash`.  
**upgrade (in place):** none blocking. Optional later: tighter `edit_file` diagnostics (already has no-match/ambiguous hints); search hit caps already honest.

Hypothetical new `bash` tool: **reject** as Desktop default (`ARCHITECTURE-RESET` Non-goal).

---

## Prompts, AI work UI, config, core framework deps

Shipped with the hybrid. Package pins are in `topmind-desktop/package.json`.

### System prompts (`electron/ai-prompts.mjs` + writeback-mode copy)

| | Item |
|--|------|
| **Keep** | Skill-first protocol (`load_skill` then tools); tools grouped by workflow stage matching the 31 names; “do not launch external processes / browsers / second windows”; workspace-relative paths; `describeWritebackModeForPrompt`; output-language policy; preloaded overview/profile/topic to cut discovery calls; `edit_file` preferred over full-file `save_file`. |
| **Change** | Optional later: one sentence in Habits that **absolute paths and shell are not available** (already implied by “no external processes”). Not required to keep the engine. First-class **external host** note belongs in Desktop README/help, not in the model prompt. |
| **Defer** | Dual-writing prompts as Pi `AGENTS.md` / prompt-templates / pi packages. Would fork the portable Skills pack. |

### AI work surface (rail / composer / pending-writes / suggest)

Shipped: right **AI workspace** = `AiWorkspace` panes 对话 / 建议 / 清单 / 应用; Composer pinned to the column; confirm list = **`SuggestPopover`** (embedded in 建议; floating only in focus mode); personal list = **清单 pane** (`TodoListBody`; `TodoPopover` only in focus mode); Apps = **`AppsLaunchList`**; background = `TaskPanel`. DESIGN.md: 勿与个人清单混称「待办」.

| | Item |
|--|------|
| **Keep** | Suggest as **global** confirm surface (not buried only in chat); pending-write stash/accept; slash skill seeds (`getSkillPrompts`); StatusBar honest multi-lane busy. |
| **Change** | Right column is a peer workspace, not a chat-only rail. StatusBar count / ⌘⇧T / ⌘K 应用 open matching panes. |
| **Defer** | Visual-language redo; a sixth user concept. |

### AI / workspace config

Shipped (`src/types.ts` `AppSettings.ai` + contract `writeback.mode`): `agentEnabled`, `skillsEnabled`, `enabledSkillIds`, `extraSkillsRoots`, `maxAgentSteps` (3–50), `autoPrepareSuggestions`, `autoMaintainTodos`, provider keys / `sourcePreference` / `defaultModel`; workspace `writebackMode`.

| | Item |
|--|------|
| **Keep** | All of the above. Writeback remains contract + Desktop overlay, not a Pi permission file. |
| **Change** | Docs-only later: “You may run an external coding agent (`pi`, Codex, …) **in this workspace folder**; those writes are not Kernel-gated; sessions under `~/.pi` are not topmind content.” No settings flag. |
| **Defer** | bash-enable setting; importing `~/.pi/agent` sessions; a user-facing runtime toggle (fallback is load-fail only). |

### Core Desktop frameworks (`topmind-desktop/package.json`)

Declared 2026-09-07 from `topmind-desktop/package.json`:

| Lib | Declared | Policy |
|-----|----------|--------|
| `ai` | ^7.0.37 | AI SDK patch-line; **major** needs ADR 2026-06-14 |
| `@ai-sdk/anthropic` | ^4.0.21 | same family |
| `@ai-sdk/google` | ^4.0.24 | same |
| `@ai-sdk/openai` | ^4.0.20 | same |
| `@ai-sdk/openai-compatible` | ^3.0.14 | same |
| `electron` | ^42.7.1 | `adrGatedMajors` |
| `react` / `react-dom` | ^18.3.1 | `adrGatedMajors` |
| `vite` | ^6.4.3 | `adrGatedMajors` |
| `@tiptap/*` | ^3.22.5 | peer-pinned suite |
| `tailwindcss` / `@tailwindcss/vite` | ^4.3.3 | `adrGatedMajors` |

| | Item |
|--|------|
| **Keep** | AI SDK v7 as the **provider** stack; Electron 42 / React 18 / Vite 6 / TipTap 3 / Tailwind 4. Continue patch-line only via `check-dependency-policy.mjs`. |
| **Change** | Add `@earendil-works/pi-agent-core` / `pi-ai` + `typebox` as production deps for the agent **loop**. Do **not** add `pi-coding-agent`. |
| **Defer** | React 19, Vite 7, Electron 43+, TipTap 4, AI SDK v8. Each is a focused ADR + design review, not a piggyback on this Pi evaluation. |

---

## Pi-style capabilities already absorbed vs gaps that do **not** need an engine swap

Per ADR 2026-07-16 and current code (providers stay AI SDK; the loop is Pi-core):

| Already absorbed on AI SDK | Where |
|----------------------------|--------|
| Unique-span file edit | `edit_file` → `pathOps.editPath` → `applyUniqueSpan` → writeback |
| Windowed / located read | `read_file` offset/limit/around/heading |
| Controlled grep (no shell) | `search` |
| Token-aware compact + tool gist | `compactMessagesForModel` in `ai-session-compact.mjs` |
| Mid-turn steer after current tool | `steerStream` + `prepareStep` in `ai-stream.mjs` |
| Follow-up chain after turn | stream registry `followUps` |
| Skill progressive disclosure | `list_skills` / `load_skill` + catalog in prompt |

| Remaining gap | Needs engine swap? |
|---------------|-------------------|
| Default bash / unscoped FS | **No** — product Non-goal. Reject. |
| Permission popups | **No** — we have confirm writeback + locked, which Pi refuses to bake in. |
| Session tree / fork under `~/.pi` | **No** — Desktop chat is not content truth; do not import Pi transcripts. |
| Pi packages / TypeScript extensions | **No** — portable Skills pack is the extension surface. |
| Extra native `grep`/`find`/`ls` | **No** — `search` + `list_*` + `workspace_overview`. |
| Auto model catalog refresh | **No** — settings + `@ai-sdk/*` providers + Kernel `aiProvider`. |
| RPC sibling process | **No** — would be dual-UX (trigger 2). External `pi` already does this for users who want it. |

---

## Three-column chrome (against the **already-shipped** shell)

Shipped anatomy (`topmind-desktop/DESIGN.md` §2 + `src/components/shell/{Shell,TitleBar,Sidebar,StatusBar}.tsx` + `docs/UIUX-AUDIT-2026-09-01.md`):

```
Three through-going columns (no spanning product bar)
  left Sidebar: Profile → 搜索⌘K → 记一下; ViewSwitcher; footer WorkspaceSwitcher
  center TitleBar: toggle · view-switch (动态 · 收件箱 · 写出来) · crumbs · injected actions · AI toggle
  right AiWorkspace: 对话 / 建议 / 清单 / 应用; composer pinned
StatusBar: health · full path · AI pill · busy chips · suggest count (count>0)
SuggestPopover: confirm list (embedded in 建议; floating only in focus mode)
Search is not PrimaryNav: ⌘K command palette · ⌘P note search
```

DESIGN lock: user concepts ≤5; PrimaryNav = 动态 · 收件箱 · 写出来; Apps not PrimaryNav; 建议入口 = 状态栏计数 (count>0) 打开同一右列 pane.

### (a) Fold AI 建议, AI todo, plugins/Apps into the right sidebar?

**Shipped:** the right column is an **AI workspace**, peer to the center canvas — not a chat-only rail. 建议 / 清单 / 应用 are panes **beside** 对话, not a sixth PrimaryNav concept and not a second list on the stream canvas. Ledger/Apps still must not become a PrimaryNav peer. Composer stays pinned to the column so switching panes does not lose the chat door.

### (b) Move header workspace switcher to left-sidebar bottom (Outlook-style) and relocate PrimaryNav + command palette?

**Shipped (partial):** workspace switcher sits on the **left-sidebar footer**. PrimaryNav and ⌘K **stay in the TitleBar** (destinations must remain visible when the sidebar is collapsed). Command palette remains an overlay.

### (c) Where do remaining header icons/actions go?

**Shipped (aligned to DESIGN §0.0.4):** remaining commands live on column chrome, not TitleBar L2/L3:

| Home | Control | Stays |
|------|---------|-------|
| Left header | 记一下 (⌘N) — ordinary chrome button + capture accent | Sidebar `SidebarHeaderActions` |
| Center L1 | AI workspace toggle (`.v4-titlebar-btn-ai`) | TitleBar trailing |
| Right panes | 建议 / 清单 / 应用 | AI workspace; ⌘⇧T 清单; ⌘K 应用 opens the column even if unmounted |
| Sidebar footer | 设置 (⌘,) · 主题 · locale | WorkspaceSwitcher (Shell-hosted when sidebar collapsed) |
| StatusBar | AI pill · suggest count chip (count>0) · todo/suggest busy | StatusBar |
| Not in header | Task panel | ⌘⇧J / command palette |
| Not a fourth anchor | 归档 | ⌘⇧A / sidebar / ⌘K |

Do **not** invent a sixth user concept or a fourth equal PrimaryNav item.

---

## Follow-up (explicitly out of this goal)

A later **code-change** goal may:

- Write the short external-host help paragraph (Pi/Codex in the workspace folder).
- Independent UI polish from the 2026-09-01 audit (breadcrumb, period picker, TitleBar grouping).

A later code-change goal must **not** treat this ADR as permission to: embed `pi-coding-agent`, add bash, import `~/.pi` sessions as content truth, or add a sixth user concept / fourth PrimaryNav peer.

---

## Consequences

- Desktop agent **loop** is `pi-agent-core`; LLM providers stay AI SDK v7; Kernel writeback stays the only write gate.
- `2026-07-21` remains Accepted for **rejecting full coding-agent**; this ADR covers the 0.85.1 hybrid.
- Four surfaces stay Pi-independent (Skills pack / UTR / Obsidian).
- Three-column IA is the DESIGN.md lock: right column = AI workspace; switcher on the left-sidebar footer.

## Sources (durable)

- npm: `@earendil-works/pi-coding-agent@0.85.1`, `pi-agent-core@0.85.1`, `pi-ai@0.85.1`; `@mariozechner/pi-coding-agent@0.73.1`
- `gh api` `earendil-works/pi`: `packages/coding-agent/docs/{security,quickstart,sdk}.md`, `packages/coding-agent/README.md`, `packages/agent/README.md`
- In-repo: `topmind-desktop/electron/{ai-tools,ai-prompts,ai-service,ai-stream}.mjs`, `electron/lib/ai-tool-names.mjs`, `lib/{model-core,writeback-engine}.mjs`, `tests/workspace-containment.test.mjs`, `topmind-desktop/DESIGN.md` §2, `src/components/shell/{Shell,TitleBar,Sidebar,StatusBar}.tsx`, `docs/UIUX-AUDIT-2026-09-01.md`, `topmind-desktop/package.json`, `scripts/check-dependency-policy.mjs`
