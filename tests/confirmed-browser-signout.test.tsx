// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "../src/app/session";
import { apiRequest } from "../src/api/client";

vi.mock("../src/api/client", async load => ({ ...await load<typeof import("../src/api/client")>(), apiRequest: vi.fn() }));
const subjectId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const identity = { tenantId: "synthetic-workspace", username: "manager@example.test", subjectId, sessionId, generation: "manager-generation" };
const accessToken = `e30.${btoa(JSON.stringify({ sub: subjectId, sid: sessionId }))}.synthetic`;
let session: ReturnType<typeof useSession>;
let root: Root;
let query: QueryClient;
let host: HTMLDivElement;
function CaptureSession() { session = useSession(); return <p>{session.session ? "Signed in" : "Signed out"}</p>; }
async function render() {
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={query}><SessionProvider><CaptureSession /></SessionProvider></QueryClientProvider>));
  await act(async () => { await Promise.resolve(); });
  expect(session.session?.sessionId).toBe(sessionId);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify(identity));
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => {
    if (path === "/api/auth/browser/refresh") return { accessToken };
    if (path === "/api/auth/browser/sign-out") return undefined;
    throw new Error(`Unexpected synthetic endpoint: ${path}`);
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  query?.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("confirmed station-manager sign-out completion", () => {
  it("clears and publishes the acknowledged session locally without a second remote sign-out", async () => {
    await render(); query.setQueryData(["synthetic-private-data"], "private");
    await act(async () => {
      await session.request<void>("/api/auth/browser/sign-out", { method: "POST" });
      session.completeConfirmedBrowserSignOut(sessionId);
    });
    expect(session.session).toBeNull(); expect(localStorage.getItem("bunkfy.session.identity.v2")).toBeNull();
    expect(query.getQueryData(["synthetic-private-data"])).toBeUndefined();
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === "/api/auth/browser/sign-out")).toHaveLength(1);
    await act(async () => session.retrySessionRestore());
    expect(session.session).toBeNull();
  });

  it("does not clear a current session using an acknowledgement for a different session", async () => {
    await render();
    expect(() => session.completeConfirmedBrowserSignOut("33333333-3333-4333-8333-333333333333")).toThrow("browser session changed");
    expect(session.session?.sessionId).toBe(sessionId);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === "/api/auth/browser/sign-out")).toHaveLength(0);
  });

  it("leaves ordinary logout remote revocation unchanged", async () => {
    await render(); await act(async () => session.logout());
    expect(session.session).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === "/api/auth/browser/sign-out")).toHaveLength(1);
  });
});
