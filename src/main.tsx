import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
import {
  ApplicationRenderFailure,
  RenderErrorBoundary,
} from "./app/RenderErrorBoundary";
import {
  loadProductCapabilities,
  ProductCapabilitiesProvider,
} from "./app/productCapabilities";
import { SessionProvider } from "./app/session";
import { StationPage } from "./features/stations/StationPage";
import { isStationPath } from "./features/stations/stationTypes";
import { installStationHandoff } from "./features/stations/stationHandoff";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { networkMode: "always", retry: 0 },
  },
});

async function bootstrap() {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("BunkFy app root was not found.");

  const capabilities = await loadProductCapabilities();
  const appRoot = createRoot(root);
  installStationHandoff(async setupGrantId => {
    await queryClient.cancelQueries();
    queryClient.clear();
    window.history.replaceState(null, "", "/station");
    appRoot.render(<StrictMode><RenderErrorBoundary fallback={<ApplicationRenderFailure />}>
      <StationPage setupGrantId={setupGrantId} />
    </RenderErrorBoundary></StrictMode>);
  });
  if (isStationPath(window.location.pathname)) {
    appRoot.render(<StrictMode><RenderErrorBoundary fallback={<ApplicationRenderFailure />}>
      {capabilities.staffPinEnabled ? <StationPage /> : <main className="mx-auto max-w-xl p-6">
        <h1 className="text-xl font-semibold">Shared stations are not enabled</h1>
        <p className="my-4">Ask your manager to check the station setup.</p><a className="btn btn-outline" href="/">Back to BunkFy</a>
      </main>}
    </RenderErrorBoundary></StrictMode>);
    return;
  }
  appRoot.render(
    <StrictMode>
      <RenderErrorBoundary fallback={<ApplicationRenderFailure />}>
        <ProductCapabilitiesProvider capabilities={capabilities}>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </SessionProvider>
          </QueryClientProvider>
        </ProductCapabilitiesProvider>
      </RenderErrorBoundary>
    </StrictMode>,
  );
}

void bootstrap();
