# topmind · OpenCode Integration

[English](../../README.md) · [简体中文](../../README.zh-CN.md) · [Skills install](../../skills/INSTALL.md)

topmind should not fork OpenCode by default. Prefer a thin adapter layer.

## Recommended route

1. Install the portable skill pack (`skills/topmind-pack.json` / pack-aware installer).  
2. **Expose only `topmind`** as the daily user-facing entry — sub-skills are internal.  
3. Expose UTR through MCP when available; **UTR is optional** otherwise use host file tools.  
4. Optional OpenCode commands for common capture and doctor flows (`commands/`).  
5. Keep content truth in `topmind-workspace/categories-and-topics`. OpenCode state must not become topmind content truth.

## Config shape

`opencode.example.json` mirrors the observed OpenCode shape:

- `skills.paths.paths`
- `mcp.{server}.type` / `command`
- `plugin`

Use the host’s discovered config root. Do not hardcode machine-specific paths.  
Repo root `opencode.json` is machine-local (gitignored); share shapes via this example.

**Desktop is not required** for the skill pack.

## Must not

- Change content truth or add parallel daily entrypoints  
- Introduce naming/command surfaces outside `PROJECT-MODEL.md` / `TOOLS.md`  
- Treat `topmind-loop` as a `topmind-maintain` sub-action (loop is independent)  
- Treat OpenCode state as workspace content truth  
