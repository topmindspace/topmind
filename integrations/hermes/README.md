# topmind · Hermes Integration

[Root README](../../README.md) · [English](../../README.en.md) · [Skills install](../../skills/INSTALL.md)

Hermes consumes topmind as a portable skill pack, not a second workspace model.

## Recommended route

1. Install or symlink the skills declared in `skills/topmind-pack.json`.  
2. **Expose only `topmind`** as the daily entry; sub-skills route internally.  
3. **UTR is optional** — use CLI/MCP when available; otherwise host file tools with the same filesystem contract.  
4. Keep user data under `topmind-workspace/categories-and-topics`. Hermes-specific state must not become topmind content truth.

## Portable contract

- Content truth is `topmind-workspace/categories-and-topics`.  
- Daily entry is `topmind`; no parallel daily entrypoints.  
- **Desktop is not required** for the skill pack.  
- Naming and frontmatter follow `PROJECT-MODEL.md` / `TOOLS.md`.  
