import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

// Global styles + self-hosted fonts. Imported here rather than linked from
// index.html so Vite fingerprints and bundles them (D-9).
import "./styles/globals.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in index.html");
}

// React Query replaces Next's revalidatePath with per-resource invalidation
// (inventory §10, D-3).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
