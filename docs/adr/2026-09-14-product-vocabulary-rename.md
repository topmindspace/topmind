# ADR: Product vocabulary rename — Inbox / 交付 / Delivery

**Date:** 2026-09-14  
**Status:** Accepted  
**Kind:** naming / UX vocabulary; **shipped** across all four surfaces in one cycle, in two waves (wave 1 = display copy + template seeds; wave 2 = kernel copy, fallback names, contract metadata — see below)  
**Surfaces:** Desktop · Obsidian plugin · Clip extension · Skills pack · Kernel templates · UTR (docs only)  
**Supersedes:** the PrimaryNav wording recorded in `2026-09-07-pi-engine-and-three-column-reevaluation.md` (chrome layout still holds; only the words change)  
**Related:** `DESIGN.md` · `PROJECT-MODEL.md` · `PRODUCT-BOUNDARIES.md` · `SKILL-ARCHITECTURE.md` · `topmind-desktop/DESIGN.md` · `docs/ARCHITECTURE-RESET.md`

---

## Independently readable decisions

**D1 — One name per concept, in both locales.** The two user-facing anchors are now **Inbox** (was 收件箱) and **交付 / Delivery** (was 写出来 / Ship it). `交付` and `Delivery` are treated as one term in two scripts; `Inbox` is used verbatim in the Chinese UI (like the `topmind` brand), so the Chinese nav reads `动态 · Inbox · 交付`.

**D2 — The five-concept lock is unchanged in size.** `记一下 · 动态 · 专题 · 我的情况 · 交付`. This is a rename of the fifth concept, not a sixth concept.

**D3 — Default template category names change; the role system does not.** `templates/stream.json` (and balanced / research / periodic) now seed `00: Inbox` and `88: 交付`; the `-en-US` overlays seed `88: Delivery` (was `Outputs`). Role resolution stays role-based (`buffer` / `delivery` / `system`) and is **not** name-based, so nothing in the engine keys off these strings.

**D4 — Existing workspaces are not migrated.** A workspace that already owns `00-收件箱` / `88-输出` keeps those directories. Live directory names are the contract; the engine resolves by role and by on-disk name. Renaming a category remains an explicit user action (`renameCategory`, frontmatter + contract synced).

**D5 — ADRs and dated audits are historical records and are not rewritten.** `docs/adr/**` and `docs/UIUX-AUDIT-2026-09-01.md` (stamped `**NON-LIVING**`) keep their original wording. This ADR is the forward pointer.

---

## Context

The 2026-09 chrome work left the PrimaryNav half-renamed: `primaryNav.inbox` became `Inbox` and `primaryNav.outputs` became `交付`, while ~60 other display strings still said 收件箱 / 写出来, and the English surface used three different words for one idea (`Ship it` / `Outputs` / `Deliverables`). One product concept, three vocabularies — the exact "single truth" break the vocabulary lock exists to prevent.

Two facts forced an explicit scope decision rather than a copy-only sweep:

1. **Sidebar section labels come from disk, not from locale.** `bufferCat.name` (parsed from `00-收件箱`) and `path.basename(outputsRoot)` (from `88-输出`) feed the tree; `common:category.*` is only a fallback for workspaces that have no such role. Copy-only renames would therefore have produced `Inbox` in the nav and `收件箱` in the tree, on the same screen.
2. **Templates are locale-forked.** `templates/*.json` carry Chinese category names and `templates/*.en-US.json` carry English ones, so the zh default directory name is decided by the base template file.

Because topmind is local-first — the folder name *is* the UI in Finder and in an Obsidian vault — showing `Inbox` while the folder says `00-收件箱` would trade one inconsistency for another. The default template names therefore move with the vocabulary, while existing directories stay put.

---

## Decision

**Rename the display vocabulary and the default template category names; keep role-based discovery and existing directories untouched.**

| Layer | Before | After |
|-------|--------|-------|
| zh display copy | 收件箱 / 写出来 | Inbox / 交付 |
| en display copy | Ship it / Outputs | Delivery |
| zh template seed | `00: 收件箱` / `88: 输出` | `00: Inbox` / `88: 交付` |
| en template seed | `88: Outputs` | `88: Delivery` |
| Existing workspace dirs | — | **unchanged** (no migration) |
| Role resolution | buffer / delivery / system | **unchanged** |

Touched surfaces: Desktop `src/locales/**` + `electron/**` copy and prompts, Obsidian `i18n/locales/*`, Clip `_locales/zh_CN` + `popup.html`, `skills/**`, the living docs listed above, `scripts/check-redesign-contract.mjs`, and the wording assertions in `tests/product-vocab-i18n.test.mjs` / `tests/living-doc-numbers.test.mjs`.

---

## Wave 2 — the layers below the copy

Wave 1 stopped at display copy and template seeds. A post-gate audit found four more places where the *same* names are either shown or decided, none of them reachable by a locale sweep. All four moved in the same cycle.

**W1 — Kernel suggestion copy is a surface.** `lib/suggest-engine.mjs` carries its own zh/en bundle (`inboxReviewTitle`, `inboxOrganizeTitle`, `inboxOrganizeSummary`) plus the inbox-routing AI prompt. It is user-visible and locale-independent, so it kept saying 收件箱 after the Desktop locales were clean. Now `Inbox 待整理` / `Inbox 智能整理` / `请分析以下 Inbox 中的文件…`.

**W2 — Fallback names decide brand-new workspaces.** These decide the directory name when no template is available, and all of them still produced the old names:

- `lib/workspace-model.mjs` — the locale fallback map (`zh-CN: { buffer, delivery }`) and the no-config category list
- `topmind-desktop/electron/lib/path-model.mjs` — `inboxRoot` / `outputsRoot` invented defaults
- `topmind-desktop/electron/lib/workspace-home.mjs` — the no-template seed and the engine-missing last resort
- `utr/core/workspace-context.mjs` — `fallbackHyphen` / `fallbackSpace` for buffer and delivery

All now seed the new names. Every *detection* list keeps the legacy names and simply puts the current name first, so resolution order is unchanged in practice (two alias directories coexisting does not happen) and a legacy workspace is still found on disk before any fallback runs.

**W3 — Acknowledgement lists must learn the new names.** Renaming a directory is only half the job; the code that *recognises* it has to know the name too. `88-交付` / `88-Delivery` were added to `ROLE_DIR_ALIASES`, to the `lib/model-core.mjs` role fallbacks, and to `utr/core/safety-receipt-paths.mjs` `OUTPUTS_ROOT_NAMES`. The receipt-path entry is the one with a real failure mode: without it, receipts issued against a new `88-交付` delivery directory would not have been parsed. Legacy `.Outputs` / `输出` spellings stay in every list.

**W4 — UTR `reads` / `writes` globs are load-bearing.** `writes` is not decorative metadata: `utr/core/tool-executor.mjs` resolves those patterns and snapshots the affected files *before* a `risk_level: "high"` write. A pattern naming only `88-输出/**` therefore means a silently ineffective safety net on a new workspace. The globs, command labels and descriptions now declare the new names **alongside** the legacy ones — declaring both is the only honest option, because the files actually on disk depend on when the workspace was created. Command labels/descriptions (`列出收件箱` → `列出 Inbox`, `读取 00 收件箱 文件…`) moved outright.

Also moved: `scripts/create-demo-video.mjs` scene titles (`00-Inbox · 缓冲与整理`, `88-交付 · 交付成品沉淀`) and the `scripts/seed-testws-fixtures.mjs` demo seed, so the demo recording matches what a new workspace looks like.

### Deliberately not changed

- Legacy alias **detection** lists (`00-收件箱`, `88-Outputs`, `88-输出` …) — required for old workspaces.
- Separator normalization pairs in `workspace-home.mjs` — those map `-` ↔ space, not vocabulary; adding a vocabulary mapping there would be a migration, which D4 forbids.
- Test fixtures that create Chinese-named directories on purpose — they exist to prove role resolution is name-agnostic.
- `docs/adr/**` and dated audits, per D5.

---

## Consequences

- **New workspaces** created from a Chinese template own `00-Inbox` / `88-交付`; from an English template, `00-Inbox` / `88-Delivery`.
- **Existing workspaces** keep their names and keep working by role. A user who wants the new names renames the category themselves; nothing is moved under them.
- **Mixed-vocabulary workspaces are legal and expected**: `00-收件箱` next to a `Inbox` nav label is a legitimate state, because the tree shows the disk name on purpose.
- Localized-name support stays documented (`PROJECT-MODEL.md` §命名): `00-Capture`, `00-收件箱`, `99-Archive` remain valid, and the engine still refuses to invent a directory name that the template does not contain.

## Verification

```bash
node scripts/check-redesign-contract.mjs     # doc guard follows the new words
npm run desktop:quality                       # deps → typecheck → electron → dead-code → i18n → test → build → pack:verify
npm run validate                              # root: kernel / skills / utr suites
```

`check:i18n` enforces zh-CN ↔ en-US key parity. `tests/product-vocab-i18n.test.mjs` pins both waves so a partial rename fails the gate instead of shipping: *retired vocabulary … gone from shipped locales* (wave 1) and *new-workspace fallback names and Kernel suggestion copy follow the rename* (wave 2 — fallback names, Kernel suggestion copy, legacy names still resolvable, UTR contract metadata).
