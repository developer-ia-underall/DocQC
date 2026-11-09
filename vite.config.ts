// @lovable.dev/vite-tanstack-config already includes TanStack Start, React, Tailwind, tsconfig paths,
// nitro (build-only, cloudflare target by default), VITE_* env injection and the @ alias.
// Do NOT add those plugins manually. Never set ssr.external / resolve.external.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
});
