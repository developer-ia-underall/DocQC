/**
 * Client-only entry for the static single-file build (vite.spa.config.ts).
 * The regular app still runs through TanStack Start; this entry renders the same routes
 * with in-memory history so it can be hosted as one HTML file.
 */
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { Route as RootRoute } from "./routes/__root";

// The <html> shell belongs to SSR; here we mount inside an existing page.
delete (RootRoute.options as { shellComponent?: unknown }).shellComponent;

const html = document.documentElement;
const forced = html.getAttribute("data-theme");
let saved: string | null = null;
try {
  saved = localStorage.getItem("docqc-theme");
} catch {
  /* storage blocked */
}
const dark =
  saved === "dark" ||
  (!saved &&
    (forced === "dark" || (!forced && matchMedia("(prefers-color-scheme: dark)").matches)));
html.classList.toggle("dark", dark);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } });
const router = createRouter({
  routeTree,
  context: { queryClient },
  history: createMemoryHistory({ initialEntries: ["/"] }),
  defaultPreloadStaleTime: 0,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
