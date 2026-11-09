// Static single-file build: `bun run build:spa` → dist-spa/spa.html (no server, in-memory routing).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const src = fileURLToPath(new URL("./src", import.meta.url));

// __root.tsx links styles.css by URL for SSR; here the stylesheet is imported by spa.tsx instead.
const noCssUrl = {
  name: "docqc:no-css-url",
  enforce: "pre" as const,
  resolveId: (id: string) => (id.endsWith("styles.css?url") ? "\0css-url" : null),
  load: (id: string) => (id === "\0css-url" ? "export default ''" : null),
};

export default defineConfig({
  plugins: [noCssUrl, react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: [
      { find: "@/lib/pdf-worker", replacement: `${src}/lib/pdf-worker.inline.ts` },
      { find: "@", replacement: src },
    ],
  },
  build: {
    outDir: "dist-spa",
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL("./spa.html", import.meta.url)) },
  },
});
