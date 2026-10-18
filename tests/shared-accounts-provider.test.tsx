// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, setRememberedBrowserTransport } from "../src/api/client";
import { ProductCapabilitiesProvider } from "../src/app/productCapabilities";
import { useSession } from "../src/app/session";
import { SharedAccountRoot, useSharedAccounts } from "../src/features/account-switch/SharedAccountsProvider";
import { readAccountOperation, saveAccountOperation } from "../src/features/account-switch/accountSwitchRecovery";
import type { RememberedBrowser } from "../src/features/account-switch/accountSwitchTypes";

vi.mock("../src/api/client", async load => ({ ...await load<typeof import("../src/api/client")>(), apiRequest: vi.fn() }));
const memberA = "11111111-1111-4111-8111-111111111111";
const sidA = "22222222-2222-4222-8222-222222222222";
const memberB = "33333333-3333-4333-8333-333333333333";
const sidB = "44444444-4444-4444-8444-444444444444";
const proof = "55555555-5555-4555-8555-555555555555";
const token = (sub: string, sid: string) => `e30.${btoa(JSON.stringify({ sub, sid }))}.synthetic`;
const current = (state: RememberedBrowser["state"] = 2, generation = 4): RememberedBrowser => ({ state, generation, pinDigits: 6,
  accounts: [{ proofId: proof, username: "staff-b@example.test", label: "Person B", requiresSignIn: false, expiresAtUtc: "2099-01-01T00:00:00Z" }],
  active: state === 2 ? { memberId: memberA, sessionId: sidA, proofId: null, username: "owner-a@example.test", label: null } : null,
  idleExpiresAtUtc: null, absoluteExpiresAtUtc: null, csrfToken: "synthetic-csrf" });
let root: Root | undefined;
let query: QueryClient;
let host: HTMLDivElement;
let shared: ReturnType<typeof useSharedAccounts>;
let normalSession: ReturnType<typeof useSession>;
function NormalProduct() {
  shared = useSharedAccounts();
  normalSession = useSession();
  const { session } = normalSession;
  return <div data-normal>{session ? `Private product for ${session.username}` : "Ordinary password sign-in"}</div>;
}
async function mount(enabled = true) {
  query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<ProductCapabilitiesProvider capabilities={{ emailVerificationEnabled: false, sharedAccountSwitchEnabled: enabled }}>
    <QueryClientProvider client={query}><MemoryRouter><SharedAccountRoot><NormalProduct /></SharedAccountRoot></MemoryRouter></QueryClientProvider>
  </ProductCapabilitiesProvider>));
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(text));
  expect(button, text).toBeDefined(); await act(async () => button!.click());
}
async function submitPin() {
  const form = host.querySelector("form")!;
  form.querySelector<HTMLInputElement>("input")!.value = "654321";
  await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); sessionStorage.clear();
  setRememberedBrowserTransport(null);
  localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify({ tenantId: "workspace-a", username: "owner-a@example.test", subjectId: memberA, sessionId: sidA, generation: "normal-1" }));
  vi.mocked(apiRequest).mockReset().mockImplementation(async path => {
    if (path.endsWith("/remembered/current")) return current();
    if (path === "/api/auth/browser/refresh") return { accessToken: token(memberA, sidA) };
    throw new Error(`Unexpected synthetic path ${path}`);
  });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined;
  query?.clear(); document.body.replaceChildren(); setRememberedBrowserTransport(null); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe("normal-account PIN boundary", () => {
  it("checks Current once after ordinary logout and shows the server-confirmed locked chooser without selecting anyone", async () => {
    await mount(); vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path.endsWith("/remembered/current")) return current(1, 5);
      if (path.endsWith("/browser/sign-out")) return undefined;
      throw new Error(`Unexpected synthetic path ${path}`);
    });
    await act(async () => normalSession.logout());
    expect(host.textContent).toContain("Choose your account");
    expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path)).toEqual([
      "/api/auth/browser/sign-out", "/api/auth/browser/remembered/current",
    ]);
    await act(async () => { await Promise.resolve(); });
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(2);
  });

  it("does not claim sign-out or expose content if Current still reports an active session", async () => {
    await mount(); vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path.endsWith("/remembered/current")) return current();
      if (path.endsWith("/browser/sign-out")) return undefined;
      throw new Error(`Unexpected synthetic path ${path}`);
    });
    await act(async () => normalSession.logout());
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(host.textContent).toContain("Retry lock");
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(2);
  });

  it.each([{ memberId: memberB, sessionId: sidB }, { memberId: memberA, sessionId: sidB }])("conceals the real session and caches on authoritative Active mismatch $memberId/$sessionId without adopting it", async active => {
    await mount(); query.setQueryData(["old-guest"], "private"); vi.mocked(apiRequest).mockClear();
    vi.mocked(apiRequest).mockResolvedValue({ ...current(2, 5), active: { ...active, proofId: proof, username: "other@example.test", label: null } });
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "bunkfy.account-switch.cover.v1", newValue: null })));
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(localStorage.getItem("bunkfy.session.identity.v2")).toBeNull();
    expect(query.getQueryData(["old-guest"])).toBeUndefined();
    expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path)).toEqual(["/api/auth/browser/remembered/current"]);
  });

  it("leaves ordinary logout unchanged when fast switching is disabled", async () => {
    await mount(false); vi.mocked(apiRequest).mockClear(); vi.mocked(apiRequest).mockResolvedValue(undefined);
    await act(async () => normalSession.logout());
    expect(host.textContent).toContain("Ordinary password sign-in");
    expect(vi.mocked(apiRequest).mock.calls.map(([path]) => path)).toEqual(["/api/auth/browser/sign-out"]);
  });

  it("never refreshes an old local identity when the server says this browser is locked", async () => {
    vi.mocked(apiRequest).mockResolvedValue(current(1, 5));
    await mount();
    expect(host.textContent).toContain("Choose your account");
    expect(vi.mocked(apiRequest).mock.calls.map(([p]) => p)).toEqual(["/api/auth/browser/remembered/current"]);
    expect(host.querySelector("[data-normal]")).toBeNull();
  });

  it("keeps guest data hidden if device status is unavailable, without guessing at ordinary refresh", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new TypeError("Synthetic offline status"));
    await mount();
    expect(host.textContent).toContain("lock status could not be checked");
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
  });
  it("opens ordinary sign-in for a first-run browser with no remembered workspace account", async () => {
    localStorage.removeItem("bunkfy.session.identity.v2");
    vi.mocked(apiRequest).mockResolvedValue({ ...current(0, 4), accounts: [], active: null });
    await mount();
    expect(host.querySelector("[data-normal]")).not.toBeNull();
    expect(host.textContent).toContain("Ordinary password sign-in");
  });
  it("leaves ordinary auth unchanged and calls no remembered endpoint when disabled", async () => {
    await mount(false);
    expect(host.textContent).toContain("Private product for owner-a");
    expect(shared).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls.map(([p]) => p)).toEqual(["/api/auth/browser/refresh"]);
  });
  it("keeps a global-only identity on ordinary authentication even when switching is enabled", async () => {
    localStorage.setItem("bunkfy.session.identity.v2", JSON.stringify({ tenantId: "global", username: "owner-a@example.test", subjectId: memberA, sessionId: sidA, generation: "normal-1" }));
    await mount();
    expect(host.textContent).toContain("Private product for owner-a");
    expect(vi.mocked(apiRequest).mock.calls.map(([p]) => p)).toEqual(["/api/auth/browser/refresh"]);
  });
  it("checks the server boundary before restoring or exposing any remembered identity", async () => {
    let resolve!: (value: RememberedBrowser) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await mount();
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
    await act(async () => resolve(current()));
    expect(host.textContent).toContain("Private product for owner-a");
  });
  it("does not refresh a local identity after the locked refresh read names another active member", async () => {
    let currentReads = 0;
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path.endsWith("/remembered/current")) {
        currentReads += 1;
        return currentReads === 1 ? current() : {
          ...current(), generation: 5,
          active: { memberId: memberB, sessionId: sidB, proofId: proof, username: "other@example.test", label: null },
        };
      }
      if (path === "/api/auth/browser/refresh") throw new Error("Refresh must be fenced");
      throw new Error(`Unexpected synthetic path ${path}`);
    });
    await mount();
    expect(currentReads).toBe(2);
    expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === "/api/auth/browser/refresh")).toBe(false);
    expect(host.textContent).not.toContain("Private product for owner-a");
  });
  it("hides the old product synchronously and uses the confirmed real member/sid to restore the same interface", async () => {
    await mount(); query.setQueryData(["old-guest"], "private");
    let resolve!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    let lock!: Promise<void>;
    await act(async () => { lock = shared!.switchAccount(); });
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(host.textContent).toContain("Securing this browser");
    expect(query.getQueryData(["old-guest"])).toBeUndefined();
    await act(async () => { resolve({ outcome: 0, current: current(1, 5) }); await lock; });
    expect(host.textContent).toContain("Choose your account");
    await click("Person B");
    expect(document.activeElement?.getAttribute("name")).toBe("devicePin");
    const next = { ...current(2, 6), active: { memberId: memberB, sessionId: sidB, proofId: proof, username: "staff-b@example.test", label: "Person B" } };
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path.endsWith("/select")) return { outcome: 0, current: next, accessToken: token(memberB, sidB) };
      if (path.endsWith("/current")) return next;
      throw new Error("Unexpected synthetic path");
    });
    await submitPin();
    expect(host.textContent).toContain("Private product for staff-b");
    expect(readAccountOperation()).toBeNull();
    expect(sessionStorage.getItem("bunkfy.account-switch.pending.v1")).toBeNull();
    expect(localStorage.getItem("bunkfy.account-switch.cover.v1")).toBeNull();
  });
  it("keeps a lost lock covered and retries only the original operation", async () => {
    await mount();
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Synthetic lost reply"));
    await act(async () => shared!.switchAccount());
    const original = readAccountOperation(); expect(original?.kind).toBe("lock");
    expect(host.querySelector("[data-normal]")).toBeNull();
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
    await click("Retry lock");
    const sent = vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/lock"));
    expect(sent).toHaveLength(2);
    expect(JSON.parse(String(sent[0][1]?.body))).toEqual(JSON.parse(String(sent[1][1]?.body)));
    expect(readAccountOperation()).toBeNull();
  });

  it("keeps ordinary authentication when the workspace identity has been lost", async () => {
    localStorage.removeItem("bunkfy.session.identity.v2");
    await mount();
    expect(host.textContent).toContain("Ordinary password sign-in");
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(0);
  });

  it.each([{ outcome: 3, message: "PIN was not accepted" }, { outcome: 4, message: "Too many attempts" }])(
    "reports a definitive PIN outcome $outcome without adopting or background retrying", async ({ outcome, message }) => {
      await mount(); vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
      await act(async () => shared!.switchAccount()); await click("Person B");
      vi.mocked(apiRequest).mockResolvedValueOnce({ outcome, current: current(1, 5) });
      await submitPin();
      expect(host.textContent).toContain(message); expect(readAccountOperation()).toBeNull();
      expect(host.querySelector("[data-normal]")).toBeNull();
      expect(vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/select"))).toHaveLength(1);
      expect(host.querySelector<HTMLInputElement>('input[name="devicePin"]')?.value).toBe("");
    },
  );

  it("recovers a lost selection using the original operation and same confirmed child", async () => {
    await mount(); vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
    await act(async () => shared!.switchAccount()); await click("Person B");
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Synthetic lost select reply"));
    await submitPin(); const original = readAccountOperation();
    expect(original?.kind).toBe("select");
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
    const next = { ...current(2, 6), active: { memberId: memberB, sessionId: sidB, proofId: proof, username: "staff-b@example.test", label: null } };
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path.endsWith("/recover")) {
        const body = JSON.parse(String(options?.body));
        expect(body.operationId).toBe(original!.operationId); expect(body.expectedGeneration).toBe(5);
        return { outcome: 0, current: next, accessToken: token(memberB, sidB) };
      }
      if (path.endsWith("/current")) return next;
      throw new Error("Unexpected synthetic recovery path");
    });
    await submitPin();
    expect(host.textContent).toContain("Private product for staff-b");
    expect(readAccountOperation()).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/select"))).toHaveLength(1);
  });

  it("retries an uncommitted selection only with its original coordinates after unchanged locked status", async () => {
    await mount(); vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
    await act(async () => shared!.switchAccount()); await click("Person B");
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Synthetic request uncertainty"));
    await submitPin(); const original = readAccountOperation();
    const next = { ...current(2, 6), active: { memberId: memberB, sessionId: sidB, proofId: proof, username: "staff-b@example.test", label: null } };
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path.endsWith("/recover")) return { outcome: 7, current: current(1, 5) };
      if (path.endsWith("/select")) return { outcome: 0, current: next, accessToken: token(memberB, sidB) };
      if (path.endsWith("/current")) return next;
      throw new Error("Unexpected synthetic recovery path");
    });
    await submitPin();
    const selections = vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/select"));
    expect(selections).toHaveLength(2);
    for (const [, options] of selections) expect(JSON.parse(String(options?.body))).toEqual({ operationId: original!.operationId,
      expectedGeneration: 5, proofId: proof, pin: "654321" });
    expect(host.textContent).toContain("Private product for staff-b");
  });

  it("does not replay an uncommitted selection after another tab changed the generation", async () => {
    await mount(); vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
    await act(async () => shared!.switchAccount()); await click("Person B");
    vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Synthetic request uncertainty")); await submitPin();
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 7, current: current(1, 9) });
    await submitPin();
    expect(host.querySelector("[data-normal]")).toBeNull(); expect(readAccountOperation()?.kind).toBe("select");
    expect(vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/select"))).toHaveLength(1);
  });

  it("hides an account immediately when another tab publishes the privacy cover", async () => {
    await mount();
    localStorage.setItem("bunkfy.account-switch.cover.v1", "covered");
    vi.mocked(apiRequest).mockResolvedValueOnce(current(1, 5));
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "bunkfy.account-switch.cover.v1", newValue: "covered" })));
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(localStorage.getItem("bunkfy.session.identity.v2")).toBeNull();
    expect(host.textContent).toContain("Choose your account");
  });

  it("does not count background reads or synthetic key events as foreground activity", async () => {
    await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/activity"))).toHaveLength(0);
  });

  it("requires an explicit distinct browser-forget confirmation, never a null account ID", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(current(1, 5)); await mount();
    await click("Forget all accounts");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Forget all accounts on this browser?");
    expect(vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/forget-device"))).toHaveLength(0);
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: { ...current(4, 6), accounts: [], csrfToken: null } });
    await click("Forget this browser");
    const calls = vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/forget-device"));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ operationId: expect.any(String), expectedGeneration: 5 });
    expect(host.querySelector("[data-normal]")).toBeNull();
    await click("Sign in with another account");
    expect(host.textContent).toContain("Ordinary password sign-in");
  });
  it("rejects a token for a different member rather than adopting a frontend identity", async () => {
    await mount(); vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
    await act(async () => shared!.switchAccount()); await click("Person B");
    const next = { ...current(2, 6), active: { memberId: memberB, sessionId: sidB, proofId: proof, username: "staff-b@example.test", label: null } };
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: next, accessToken: token(memberA, sidA) });
    await submitPin();
    expect(host.querySelector("[data-normal]")).toBeNull();
    expect(readAccountOperation()?.kind).toBe("select");
    expect(host.textContent).toContain("result is not confirmed");
    expect(localStorage.getItem("bunkfy.session.identity.v2")).toBeNull();
  });

  it("offers a finite explicit cancellation only after NotFound plus fresh unchanged generation", async () => {
    const original = { operationId: "66666666-6666-4666-8666-666666666666", expectedGeneration: 4, kind: "remember" as const };
    saveAccountOperation(original); await mount();
    expect(host.textContent).toContain("Checking account change");
    expect(host.textContent).not.toContain("Cancel unconfirmed setup");
    vi.mocked(apiRequest).mockImplementation(async path => {
      if (path.includes("/operations/")) return { outcome: 7, current: current() };
      if (path.endsWith("/current")) return current();
      if (path.endsWith("/lock")) {
        expect(readAccountOperation()?.supersededOperationId).toBe(original.operationId);
        return { outcome: 0, current: current(1, 5) };
      }
      throw new Error("Unexpected synthetic cancellation path");
    });
    await click("Check result");
    expect(host.textContent).toContain("Cancel unconfirmed setup");
    await click("Cancel unconfirmed setup");
    expect(host.textContent).toContain("Choose your account");
    expect(readAccountOperation()).toBeNull();
    expect(vi.mocked(apiRequest).mock.calls.some(([p]) => p.endsWith("/remember") || p.endsWith("/recover"))).toBe(false);
  });

  it("keeps both coordinates when Remember wins, then requires an explicit new-generation lock", async () => {
    const original = { operationId: "66666666-6666-4666-8666-666666666666", expectedGeneration: 4, kind: "remember" as const };
    saveAccountOperation(original); await mount();
    vi.mocked(apiRequest).mockImplementation(async path => path.includes("/operations/") ? { outcome: 7, current: current() } : current());
    await click("Check result");
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 1, current: current(2, 5) });
    await click("Cancel unconfirmed setup");
    const firstLock = readAccountOperation();
    expect(firstLock?.kind).toBe("lock"); expect(firstLock?.supersededOperationId).toBe(original.operationId);
    expect(host.querySelector("[data-normal]")).toBeNull();
    vi.mocked(apiRequest).mockImplementation(async path => path.includes("/operations/") ? { outcome: 1, current: current(2, 5) } : current(2, 5));
    await click("Retry lock");
    expect(readAccountOperation()).toEqual(firstLock);
    expect(host.textContent).toContain("Another account change won first");
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 6) });
    await click("Cancel unconfirmed setup");
    const locks = vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/lock"));
    expect(locks).toHaveLength(2);
    expect(JSON.parse(String(locks[1][1]?.body)).expectedGeneration).toBe(5);
    expect(readAccountOperation()).toBeNull();
    expect(host.textContent).toContain("Choose your account");
  });

  it("checks the exact lost cancellation lock before clearing the preserved setup reference", async () => {
    const original = { operationId: "66666666-6666-4666-8666-666666666666", expectedGeneration: 4, kind: "remember" as const };
    saveAccountOperation(original); await mount();
    vi.mocked(apiRequest).mockImplementation(async path => path.includes("/operations/") ? { outcome: 7, current: current() } : current());
    await click("Check result"); vi.mocked(apiRequest).mockRejectedValueOnce(new TypeError("Synthetic lost cancellation reply"));
    await click("Cancel unconfirmed setup"); const lock = readAccountOperation();
    expect(lock?.supersededOperationId).toBe(original.operationId);
    vi.mocked(apiRequest).mockResolvedValueOnce({ outcome: 0, current: current(1, 5) });
    await click("Retry lock");
    expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain(`/operations/${lock!.operationId}`);
    expect(vi.mocked(apiRequest).mock.calls.filter(([p]) => p.endsWith("/lock"))).toHaveLength(1);
    expect(readAccountOperation()).toBeNull();
  });

  it("does not offer cancellation after the fresh generation changed or discard the original setup", async () => {
    const original = { operationId: "66666666-6666-4666-8666-666666666666", expectedGeneration: 4, kind: "remember" as const };
    saveAccountOperation(original); await mount();
    vi.mocked(apiRequest).mockImplementation(async path => path.includes("/operations/") ? { outcome: 7, current: current() } : current(2, 5));
    await click("Check result");
    expect(host.textContent).not.toContain("Cancel unconfirmed setup");
    expect(readAccountOperation()).toEqual(original);
    expect(host.querySelector("[data-normal]")).toBeNull();
  });
});
