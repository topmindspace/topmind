import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getContentSecurityPolicy } from "./config/content-security-policy.mjs";
import { getDevServerUrl, resolveDevServerHost } from "./config/dev-server.mjs";

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
          if (id.includes("lucide-react")) return "icons-vendor";
          if (id.includes("zustand") || id.includes("clsx") || id.includes("class-variance-authority")) {
            return "ui-vendor";
          }
          if (id.includes("js-yaml") || id.includes("linkedom") || id.includes("@mozilla/readability")) {
            return "parse-vendor";
          }
          if (id.includes("/react/") || id.includes("react-dom") || id.includes("scheduler")) {
            return "react-vendor";
          }
        },
      },
    },
  },
}));
