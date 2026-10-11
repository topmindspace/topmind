# topmind Capture (v4)

> v4

Use when the user wants to save a link, excerpt, loose note, idea, or temporary thought.

Route through the `topmind` daily entry and prefer:

```text
capture -> auto route when confident -> inbox when unclear -> receipt
```

When UTR is available, use `workspace-write.capture-note` with the configured `writebackMode`. Otherwise use host file tools and preserve the same workspace contract.

Category routing: dynamic discovery (`{NN-Name}/` or `{NN Name}/`) + `topmind.yaml` schema v4 (`categories.extensions` / `categories.overrides` / roles). Prefer `list-categories` (UTR) or scan workspace; skip `hidden`. Roles: buffer / loose-stream / deep-work / fallback / reference / delivery / system — do not hardcode slot numbers.
