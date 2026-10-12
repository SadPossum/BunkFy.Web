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
const nextSubjectId = "33333333-3333-4333-8333-333333333333";
const nextSessionId = "44444444-4444-4444-8444-444444444444";
const nextIdentity = { tenantId: "synthetic-workspace", username: "staff-b@example.test", subjectId: nextSubjectId, sessionId: nextSessionId, generation: "staff-b-generation" };
const nextAccessToken = `e30.${btoa(JSON.stringify({ sub: nextSubjectId, sid: nextSessionId }))}.synthetic`;

class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public readonly name: string) { FakeChannel.instances.push(this); }
  postMessage(value: unknown) {
    for (const channel of FakeChannel.instances) {
      if (channel !== this && channel.name === this.name) {
        queueMicrotask(() => channel.onmessage?.({ data: value } as MessageEvent));
      }
    }
  }
  close() { FakeChannel.instances = FakeChannel.instances.filter(channel => channel !== this); }
}

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
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  localStorage.clear(); sessionStorage.clear();
  FakeChannel.instances = [];
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
  it("supersedes a pending old refresh when another tab publishes a new actor", async () => {
    let resolveOldRefresh!: (value: unknown) => void;
    let refreshCalls = 0;
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path !== "/api/auth/browser/refresh") throw new Error(`Unexpected synthetic endpoint: ${path}`);
      refreshCalls += 1;
      if (refreshCalls === 1) return await new Promise(resolve => { resolveOldRefresh = resolve; });
      return { accessToken: nextAccessToken };
    });

    query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root.render(<QueryClientProvider client={query}><SessionProvider><CaptureSession /></SessionProvider></QueryClientProvider>));
    await act(async () => { await Promise.resolve(); });
    expect(refreshCalls).toBe(1);
    expect(FakeChannel.instances).toHaveLength(1);
    query.setQueryData(["synthetic-private-data"], "old-actor-data");

    const otherTab = new BroadcastChannel("bunkfy.browser-session.boundary.v1");
    await act(async () => { otherTab.postMessage(nextIdentity); await Promise.resolve(); });
    expect(session.session).toMatchObject({ subjectId: nextSubjectId, sessionId: nextSessionId });
    expect(host.textContent).toBe("Signed in");
    expect(query.getQueryData(["synthetic-private-data"])).toBeUndefined();

    await act(async () => { resolveOldRefresh({ accessToken }); await Promise.resolve(); });
    expect(session.session).toMatchObject({ subjectId: nextSubjectId, sessionId: nextSessionId });
    expect(session.session?.subjectId).not.toBe(subjectId);
    otherTab.close();
  });

  it("conceals the old actor and invalidates a late response without pretending remote revocation", async () => {
    await render(); query.setQueryData(["synthetic-private-data"], "private");
    let resolve: (value: unknown) => void = () => undefined;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const late = session.request("/synthetic-old-actor-read").catch(e => e);
    await act(async () => session.concealForAccountTransition());
    expect(session.session).toBeNull(); expect(query.getQueryData(["synthetic-private-data"])).toBeUndefined();
    resolve({ oldActorData: true });
    expect(await late).toMatchObject({ name: "SessionBoundarySupersededError" });
    expect(vi.mocked(apiRequest).mock.calls.some(([p]) => p === "/api/auth/browser/sign-out")).toBe(false);
  });

  it("adopts only a confirmed account matching the returned token identity", async () => {
    await render();
    await act(async () => session.concealForAccountTransition());
    expect(() => session.adoptBrowserAccount({ accessToken, username: "other", tenantId: "global",
      subjectId: "33333333-3333-4333-8333-333333333333", sessionId })).toThrow("browser session changed");
    expect(session.session).toBeNull();
    await act(async () => session.adoptBrowserAccount({ accessToken, username: "confirmed@example.test", tenantId: "global",
      subjectId, sessionId, generation: "server-generation-4" }));
    expect(session.session?.subjectId).toBe(subjectId);
    expect(session.session?.generation).toBe("server-generation-4");
  });

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
