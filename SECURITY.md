# Security Policy

## Reporting

If you discover a vulnerability in topmind (Skills pack, Desktop, UTR, or browser extension), please report it via GitHub Security Advisories on this repository (preferred) or open a private channel with the maintainers.

Do **not** open a public issue with exploit details or live credentials.

## What belongs in git

| Allowed | Not allowed |
|---------|-------------|
| Placeholder API key formats (`sk-ant-...`, empty fields) | Real API keys, tokens, passwords |
| Public package metadata (org name, repo URL) | Private email addresses, machine paths (`/Users/<you>/…`) |
| Synthetic fixtures (`/tmp/…`, `/Users/me/…` in tests only) | Real home paths, personal workspace names, tokens in docs or source |
| Example Bearer / wrk- fixtures in **tests** | Production Clip Bridge tokens |
| Architecture docs | Local `.env`, keystores, `.pem` |

## Local secrets

- Desktop encrypts API keys via Electron `safeStorage` in the **user settings file** (outside the repo).
- Clip Bridge tokens live in Desktop settings (default: off). Never commit them.
- Copy tokens into the browser extension storage via the options page only.
- Root `.mcp.json` / `opencode.json` / `.env*` are **machine-local** (gitignored). Use `integrations/*/…example*` for shareable shapes.
- Private-repo skills install: use `GH_TOKEN` / `GITHUB_TOKEN` in the environment only — never bake tokens into skill files or install scripts.

## Workspace Security & Data Protection

- **Data Boundaries**: User data is separate from the `topmind` engine repository.
- **Machine State**: The `.topmind/` directory at the root of the workspace contains local machine state (index, derived, loop, receipts, logs). It is designed to be fully reproducible, must remain local, and should be gitignored if the workspace is under version control.
- **`topmind.yaml` Protection Levels**: Two-tier model (`open` | `locked`) governed by workspace `topmind.yaml` and the writeback engine.
  - `open` (default): User and AI may write under `writeback.mode` (`auto` | `confirm`).
  - `locked`: AI cannot write directly (user may still write; AI must fork/unlock first). File frontmatter overrides role defaults.
- Priority: **protection > writeback.mode**. The **writeback-engine** is the single gate for durable content writes.

## Clip Bridge

- Binds **127.0.0.1** only (never `0.0.0.0`).
- Requires `Authorization: Bearer <token>` for `/v1/clip` and `/v1/destinations`.
- Disabled by default; body size cap **2MB**.
- Extension may send `content_html` (article fragment); Desktop re-processes via shared markdown pipeline — no cloud hop.
- Optional image download writes under workspace only (local disk); remote fetch is user-initiated clip, not background crawl.
- Extension `host_permissions` include `http(s)://*/*` so **workspace-direct** image localization can fetch article CDNs (user-initiated clip only). Desktop Bridge uses Node `fetch` with page `Referer` and needs no extra extension hosts for Bridge path.
- See `docs/adr/2026-07-13-browser-clip-extension.md` · `browser-extension/README.md` · `docs/capture-clip-matrix.md` · `skills/shared/media-assets.md`.

## CI

- `npm run secrets:scan` / GitHub Actions CI fail on high-confidence secret patterns.
- Release signing credentials (if any) must use GitHub Actions **secrets**, never source files.
