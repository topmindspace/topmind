import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getContentSecurityPolicy } from "./config/content-security-policy.mjs";
import { getDevServerUrl, resolveDevServerHost } from "./config/dev-server.mjs";

/** Record which src modules the capture/main entry pulls statically vs lazily. */
function entryGraphPlugin() {
  return {
    name: "topmind-entry-graph",
    generateBundle(this: {
      getModuleIds: () => Iterable<string>;
      getModuleInfo: (id: string) => {
        importedIds: string[];
        dynamicallyImportedIds: string[];
      } | null;
      emitFile: (asset: { type: "asset"; fileName: string; source: string }) => void;
    }) {
      const staticIds = new Set<string>();
      const dynamicIds = new Set<string>();
      const seen = new Set<string>();
      const walk = (id: string, asDynamic: boolean) => {
        if (!id || seen.has(id) || id.includes("node_modules")) return;
        seen.add(id);
        const info = this.getModuleInfo(id);
        if (!info) return;
        if (asDynamic) dynamicIds.add(id);
        else staticIds.add(id);
        for (const dep of info.importedIds ?? []) walk(dep, asDynamic);
        for (const dep of info.dynamicallyImportedIds ?? []) {
          if (!dep.includes("node_modules")) dynamicIds.add(dep);
          walk(dep, true);
        }
      };
      let entry = "";
      for (const id of this.getModuleIds()) {
        const clean = id.split("?")[0] ?? id;
        if (clean.endsWith("/src/main.tsx") || clean.endsWith("\\src\\main.tsx")) entry = id;
      }
      if (entry) walk(entry, false);
      const rel = (id: string) =>
        path.relative(__dirname, id.split("?")[0] ?? id).split(path.sep).join("/");
      const keep = (id: string) => {
        const name = rel(id);
        return name.startsWith("src/") && !name.includes("node_modules");
      };
      this.emitFile({
        type: "asset",
        fileName: "entry-graph.json",
        source: JSON.stringify({
          entry: entry ? rel(entry) : "",
          static: [...staticIds].filter(keep).map(rel),
          dynamic: [...dynamicIds].filter(keep).map(rel),
        }),
      });
    },
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8")) as {
  version: string;
};
const appVersion = packageJson.version;

const devServerHost = resolveDevServerHost();
const useStrictPort = process.env.topmind_DESKTOP_DEV_SERVER_STRICT_PORT === "1";

export default defineConfig(() => ({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    tailwindcss(),
    react(),
    entryGraphPlugin(),
    {
      name: "topmind-csp",
      transformIndexHtml(html, context) {
        const activeDevServerUrl = context.server?.resolvedUrls?.local?.[0] ?? getDevServerUrl();
        return html.replace(
          "%topmind_CSP%",
          getContentSecurityPolicy({
            development: Boolean(context.server),
            devServerUrl: activeDevServerUrl,
          }),
        );
      },
    },
  ],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  server: {
    host: devServerHost,
    strictPort: useStrictPort,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: true,
    // Tiptap editor is intentionally large and code-split; raise warning only for surprises.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@radix-ui")) return "radix-vendor";
          if (id.includes("@tiptap") || id.includes("prosemirror") || id.includes("tiptap-markdown")) {
            return "tiptap-vendor";
          }
          if (id.includes("@dnd-kit")) return "dnd-vendor";
          if (id.includes("@remixicon")) return "icons-vendor";
          if (id.includes("zustand") || id.includes("clsx") || id.includes("class-variance-authority")) {
            return "ui-vendor";
          }
          if (id.includes("i18next") || id.includes("react-i18next")) {
            return "i18n-vendor";
          }
          if (id.includes("/react/") || id.includes("react-dom") || id.includes("scheduler")) {
            return "react-vendor";
          }
        },
      },
    },
  },
}));
