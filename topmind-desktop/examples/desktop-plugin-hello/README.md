# example-hello — minimal Desktop plugin

Official minimal third-party scaffold (permissions: `slot:action` only).

## Install in Desktop

1. Settings → **Plugins** → **从文件夹**  
2. Choose this directory (`examples/desktop-plugin-hello`)  
3. Review risk (should be **low**) → confirm install  
4. **重新加载** → command palette: **Hello · Ping**

Or: Plugins → **生成示例** (writes the same layout under `{desktopHome}/plugins/example-hello/`).

## Trust model

Plugins share the app renderer (**trusted-by-install**). Only install code you trust. See `PLUGIN.md`.
