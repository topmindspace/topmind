# ADR: Desktop skill-first agent + bundled Skills runtime

**Date:** 2026-07-16  
**Status:** Accepted  

## Context

Desktop AI used a free-form system prompt with a short “skills playbook” summary and slash stubs. It did **not** load real `SKILL.md` packs, so behavior drifted from portable topmind Skills and from Agent Skills progressive disclosure.

Industry pattern (agentskills.io + AI SDK multi-step tools):

1. Discovery — name + description  
2. Activation — full skill body when matched  
3. Resources — shared/references on demand  
4. Execute via tools (WorkspaceService), multi-step loop  

## Decision

1. **Bundle** engine `skills/` with Desktop (`pack:prepare` already copies skills).  
2. **`electron/lib/skills-runtime.mjs`** — catalog / load body / load resource from engine root (asar-safe).  
3. **Default skill-first** (`settings.ai.skillsEnabled: true`):  
   - system prompt injects catalog + Route → Activate → Execute → Receipt protocol  
   - tools: `list_skills`, `load_skill`, `load_skill_resource`  
4. **Settings → Skills** — toggle skill-first; enable/disable individual skills.  
5. **Slash** (`/capture` …) seeds prompts that require `load_skill`.  
6. Skills Dock ActionSlots remain **UI shortcuts** (native WorkspaceService); semantic depth stays in pack + AI agent.

## Non-goals

- Not embedding a second skill host process  
- Not requiring UTR for skill execution  
- Not auto-chaining skills without user/router decision  

## Follow-ups (implemented)

- Session pin: `activeSkillId` in AiStore → invoke → system preloads Activation  
- UI pin select + “已激活” from `load_skill` tool results  
- External skills: `topmind_SKILLS_EXTRA` + `ai.extraSkillsRoots` + managed `skills-extra/`（安装回执）  
- maxAgentSteps default **12** (settings + stream aligned)  
- Settings shell larger (~1020×820) with sticky header per tab  

## Out of scope (still)

- Unifying Desktop extras with host `~/.claude/skills` automatically  
- Plugin marketplace (see `topmind-desktop/PLUGIN.md` maturity)  


## Consequences

- Agent quality depends on models calling `load_skill` (prompt + tools enforce; pin preloads body)  
- Pack updates ship with engine resources  
- Portable pack remains independently installable on Claude/Codex  
