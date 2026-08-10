import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
import {
  loadProductCapabilities,
  ProductCapabilitiesProvider,
} from "./app/productCapabilities";
import { SessionProvider } from "./app/session";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
  },
});

async function bootstrap() {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("BunkFy app root was not found.");

  const capabilities = await loadProductCapabilities();
  createRoot(root).render(
    <StrictMode>
      <ProductCapabilitiesProvider capabilities={capabilities}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SessionProvider>
        </QueryClientProvider>
      </ProductCapabilitiesProvider>
    </StrictMode>,
  );
}

void bootstrap();
