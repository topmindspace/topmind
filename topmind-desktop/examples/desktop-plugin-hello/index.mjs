/**
 * Minimal topmind external plugin.
 * Install: Settings → Plugins → 从文件夹 → pick this directory
 * Or copy into {desktopHome}/plugins/example-hello/
 */
export default {
  manifest: {
    id: "example-hello",
    name: "Hello Plugin",
    version: "0.1.0",
    description: "Adds a command palette action (demo)",
  },
  async activate(ctx) {
    ctx.register({
      kind: "action",
      id: "example-hello.ping",
      pluginId: ctx.pluginId,
      label: "Hello · Ping",
      group: "plugin",
      run: async () => {
        ctx.toast("Hello from external plugin");
      },
    });
  },
};
