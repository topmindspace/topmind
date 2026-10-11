# topmind · Codex Integration

[简体中文](../../README.md) · [English](../../README.en.md) · [Skills install](https://github.com/topmindspace/topmind-skills/blob/main/INSTALL.md)

Codex consumes topmind through the same portable skill pack as other hosts.

## Recommended route

1. Install or symlink the skills declared in topmind-skills `topmind-pack.json`.  
2. **Expose only `topmind`** as the daily user-facing entry; sub-skills are internal.  
3. Use `topmind-cli` or MCP when available; **UTR is optional** — otherwise host file tools with the same filesystem contract.  
4. Keep all user data under `topmind-workspace`. Codex session state must not become topmind content truth.

## Portable contract

- Content truth is `topmind-workspace`.  
- Daily entry is `topmind`; no parallel daily entrypoints.  
- **Desktop is not required** for the skill pack.  
- Naming and frontmatter follow `PROJECT-MODEL.md` / `TOOLS.md`.  
- Bulk structure fixes may use `workspace-transform.migrate-v4` (UTR advanced).  
