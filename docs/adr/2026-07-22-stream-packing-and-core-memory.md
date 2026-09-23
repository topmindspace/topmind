# ADR: Stream packing + Core memory（动态周期本 · 我的情况）

**Date:** 2026-07-22  
**Status:** Accepted（stream packing **Done**；Memory 产品面 **Done** — 侧栏「我的情况」+ 建议条 apply；见 `docs/ARCHITECTURE-RESET.md` §2.2。正文历史仍可能写 `.topmind-config.json` / `我的情况.md` 旧形状；现行契约为 `topmind.yaml` v4 + `memory/profile.md`）  
**Context:** Daily captures as many atom cards scatter the “what happened this week” narrative; core user facts had no first-class home; product language (沉淀/涌现) overloaded users.

## Decision

1. **User vocabulary (surface)**  
   - 记一下 · 整理本周 · 我的情况 · 专题 · 输出  
   - Do not teach 沉淀 / 涌现 / Core Layer in UI.

2. **Three places (semantics, not `@` roots)**  
   - **动态** — loose-stream / flat-default category; period packing  
   - **专题** — deep-work topics `{YYYY-主题}/`  
   - **我的情况** — core profile file under configurable memory dir  

3. **Stream packing** (`.topmind-config.json` → `stream`)  
   - `packing`: `atom` | `daily` | `weekly` | `monthly`  
   - **Default: `weekly`**  
   - Capture into current period note with append; day headings inside weekly/monthly notes  
   - Escape hatch: force atom / topic / inbox  

4. **Core memory** (`.topmind-config.json` → `memory`)  
   - `dir`: relative category or folder (default: first loose-stream category)  
   - `profileFile`: default `我的情况.md`  
   - Future multi-file memory lives in the same directory  
   - Markdown sections, not JSON as truth  

5. **Default template**  
   - `simple`：收件箱 · 动态 · 专题 · 输出 · 归档  
   - Prior templates remain advanced options  

6. **整理本周**  
   - Primary job: reconcile period stream in place (status merge)  
   - Optional candidates for 我的情况 / 专题  
   - Default writeback: **auto** (with archive backup on structural replace)  

7. **UTR**  
   - `capture-note` period append  
   - `append-core-memory`  
   - Surface: **22** commands; MCP primary **15**  

## Consequences

- Code: `lib/stream-period.mjs`（packing + reconcile + completion heuristics）  
- `lib/workspace-model.mjs` resolvers（stream/memory）  
- Desktop：`ingest` stream 默认 · `reconcileStreamPeriod` · `appendCoreMemory` · `getStreamContext`  
- UI：侧栏/工作台钉本周动态与我的情况；设置「动态记录方式」+ 记忆目录/多文件
- AI tools：`append_core_memory` · `reconcile_week` · capture 默认周期本  
- Skills pack 1.1.0；UTR 22 命令 / MCP 15  

## Non-goals

- Physical `@core/@timeline/@knowledge` roots  
- JSON core memory as primary truth  
- Built-in cloud authority sync  
- Auto-write 我的情况 without user intent  
- 强制用户学习「沉淀 / 涌现」jargon
