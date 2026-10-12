import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDownload, apiRequest, apiStream, setRememberedBrowserTransport } from "../src/api/client";
import { installRememberedContext, installRememberedOperationContext, prepareRememberedBrowserRefresh, readRememberedBrowser, readRememberedOperation,
  rememberedOperation, rememberedOutcomeMessage, resetRememberedBrowserTransport } from "../src/features/account-switch/rememberedBrowserApi";
import type { RememberedBrowser } from "../src/features/account-switch/accountSwitchTypes";

const locked = (): RememberedBrowser => ({ state: 1, generation: 5, pinDigits: 6, accounts: [], active: null,
  csrfToken: "synthetic-csrf", idleExpiresAtUtc: null, absoluteExpiresAtUtc: null });
const active = (): RememberedBrowser => ({ ...locked(), state: 2, active: {
  memberId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222",
  proofId: null, username: "owner@example.test", label: null,
} });
const reply = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(() => { resetRememberedBrowserTransport(); setRememberedBrowserTransport(null); vi.unstubAllGlobals(); });
describe("remembered browser owner transport", () => {
  it("uses the current owner generation and CSRF on ordinary reads, downloads and streams", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    setRememberedBrowserTransport({ generation: 7, csrfToken: "synthetic-owner-csrf" });
    await apiRequest("/synthetic", { headers: { "X-Gma-Remembered-Generation": "old" } });
    await apiDownload("/synthetic-download");
    await apiStream("/synthetic-stream", new AbortController().signal);
    for (const [, options] of fetcher.mock.calls) {
      const headers = new Headers(options.headers);
      expect(headers.get("X-Gma-Remembered-Generation")).toBe("7");
      expect(headers.get("X-Gma-Remembered-CSRF")).toBe("synthetic-owner-csrf");
      expect(options.credentials).toBe("include");
    }
    setRememberedBrowserTransport(null); await apiRequest("/ordinary-auth");
    const headers = new Headers(fetcher.mock.calls.at(-1)![1].headers);
    expect(headers.has("X-Gma-Remembered-Generation")).toBe(false);
    expect(headers.has("X-Gma-Remembered-CSRF")).toBe(false);
  });
  it("rejects malformed context rather than sending an inferred generation", () => {
    expect(() => setRememberedBrowserTransport({ generation: -1, csrfToken: "synthetic" })).toThrow();
    expect(() => setRememberedBrowserTransport({ generation: 1, csrfToken: "" })).toThrow();
  });

  it("requires a tagged authoritative Current before installing browser transport", () => {
    expect(() => installRememberedContext(locked())).toThrow("not read authoritatively");
  });

  it("accepts a randomized CSRF replacement at the same generation", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply({ ...locked(), csrfToken: "csrf-a" }))
      .mockResolvedValueOnce(reply({ ...locked(), csrfToken: "csrf-b" }))
      .mockResolvedValue(reply({}));
    vi.stubGlobal("fetch", fetcher);
    installRememberedContext(await readRememberedBrowser());
    installRememberedContext(await readRememberedBrowser());
    await apiRequest("/ordinary-auth");
    const headers = new Headers(fetcher.mock.calls.at(-1)![1].headers);
    expect(headers.get("X-Gma-Remembered-Generation")).toBe("5");
    expect(headers.get("X-Gma-Remembered-CSRF")).toBe("csrf-b");
  });

  it("rejects an out-of-order Current response without restoring stale headers", async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveSecond = resolve; }))
      .mockResolvedValue(reply({}));
    vi.stubGlobal("fetch", fetcher);
    const first = readRememberedBrowser();
    const second = readRememberedBrowser();
    resolveSecond(reply({ ...locked(), generation: 6, csrfToken: "csrf-new" }));
    installRememberedContext(await second);
    resolveFirst(reply({ ...locked(), generation: 5, csrfToken: "csrf-old" }));
    await expect(first.then(installRememberedContext)).rejects.toThrow("stale");
    await apiRequest("/ordinary-auth");
    const headers = new Headers(fetcher.mock.calls.at(-1)![1].headers);
    expect(headers.get("X-Gma-Remembered-Generation")).toBe("6");
    expect(headers.get("X-Gma-Remembered-CSRF")).toBe("csrf-new");
  });

  it("retries once when a status observer supersedes the refresh preflight Current", async () => {
    let resolvePreflight!: (response: Response) => void;
    let resolveObserver!: (response: Response) => void;
    const current = active();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolvePreflight = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveObserver = resolve; }))
      .mockResolvedValueOnce(reply(current))
      .mockResolvedValue(reply({}));
    vi.stubGlobal("fetch", fetcher);
    const identity = { tenantId: "global", username: "owner@example.test", subjectId: current.active!.memberId, sessionId: current.active!.sessionId, generation: "remembered-5" };
    const preflight = prepareRememberedBrowserRefresh(identity);
    const observer = readRememberedBrowser();
    resolveObserver(reply(current));
    installRememberedContext(await observer);
    resolvePreflight(reply(current));
    await preflight;
    expect(fetcher).toHaveBeenCalledTimes(3);
    await apiRequest("/ordinary-auth");
    const headers = new Headers(fetcher.mock.calls.at(-1)![1].headers);
    expect(headers.get("X-Gma-Remembered-Generation")).toBe("5");
    expect(headers.get("X-Gma-Remembered-CSRF")).toBe("synthetic-csrf");
  });

  it("only a fresh tagged Current Missing clears transport", async () => {
    const active = { ...locked(), generation: 5, csrfToken: "csrf-active" };
    const missing: RememberedBrowser = { ...locked(), state: 0, generation: 5, csrfToken: null };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(active))
      .mockResolvedValueOnce(reply(missing))
      .mockResolvedValueOnce(reply(missing))
      .mockResolvedValue(reply({}));
    vi.stubGlobal("fetch", fetcher);
    installRememberedContext(await readRememberedBrowser());
    installRememberedOperationContext(missing);
    await apiRequest("/ordinary-auth");
    let headers = new Headers(fetcher.mock.calls.at(-1)![1].headers);
    expect(headers.get("X-Gma-Remembered-CSRF")).toBe("csrf-active");
    installRememberedContext(await readRememberedBrowser());
    await apiRequest("/ordinary-auth");
    headers = new Headers(fetcher.mock.calls.at(-1)![1].headers);
    expect(headers.has("X-Gma-Remembered-CSRF")).toBe(false);
  });

  it.each([{ status: 200, outcome: 0 }, { status: 401, outcome: 2 }, { status: 401, outcome: 3 }, { status: 404, outcome: 7 }, { status: 409, outcome: 1 }, { status: 409, outcome: 5 },
    { status: 429, outcome: 4 }, { status: 503, outcome: 6 }])("validates the declared typed outcome at HTTP $status", async ({ status, outcome }) => {
      const current = { state: 1, generation: 5, pinDigits: 6, accounts: [], active: null,
        csrfToken: "synthetic-csrf", idleExpiresAtUtc: null, absoluteExpiresAtUtc: null };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ outcome, current }),
        { status, headers: { "Content-Type": "application/json" } })));
      await expect(rememberedOperation("select", { operationId: "synthetic", expectedGeneration: 5 })).resolves.toEqual({ outcome, current });
    });

  it("does not mistake a middleware problem, malformed DTO or empty outage for a PIN rejection", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ title: "Unauthorized", status: 401 }), { status: 401 }));
    await expect(rememberedOperation("select", {})).rejects.toThrow("could not be verified");
    fetcher.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(readRememberedOperation("synthetic")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ outcome: 3, current: { state: 1, generation: 5, accounts: [] } }), { status: 401 }));
    await expect(rememberedOperation("select", {})).rejects.toThrow("could not be verified");
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ title: "Unauthorized", status: 401 }), { status: 401 }));
    await expect(apiRequest("/ordinary-strict-request")).rejects.toMatchObject({ status: 401 });
  });

  it.each([{ status: 200, outcome: 3 }, { status: 401, outcome: 0 }, { status: 409, outcome: 4 }, { status: 429, outcome: 1 }, { status: 503, outcome: 7 }])("rejects mismatched HTTP $status and outcome $outcome", async ({ status, outcome }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ outcome, current: locked() }, status)));
    await expect(rememberedOperation("select", {})).rejects.toThrow("could not be verified");
  });

  it("retains Retry-After without treating a rate limit as successful selection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ outcome: 4, current: locked() }, 429, { "Retry-After": "45" })));
    const result = await rememberedOperation("select", {});
    expect(result.retryAfterMs).toBe(45_000);
    expect(rememberedOutcomeMessage(result.outcome, result.retryAfterMs)).toContain("45 seconds");
  });

  it.each([
    { ...locked(), state: 2 },
    { ...locked(), state: 1, active: { memberId: "malformed", sessionId: "malformed", username: "someone" } },
    { ...locked(), accounts: [{ proofId: "bad", username: "staff", requiresSignIn: false, expiresAtUtc: "2099-01-01" }] },
    { ...locked(), absoluteExpiresAtUtc: "not a date" },
    { ...locked(), accounts: [{ proofId: "11111111-1111-4111-8111-111111111111", username: "", requiresSignIn: false, expiresAtUtc: "2099-01-01" }] },
  ])("rejects malformed Current coordinates instead of installing them", async current => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(current)));
    await expect(readRememberedBrowser()).rejects.toThrow("could not be verified");
  });

  it("rejects bearer delivery on a failure, control operation, receipt read, or mismatched child", async () => {
    const memberId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const proofId = "33333333-3333-4333-8333-333333333333";
    const current = { ...locked(), state: 2, active: { memberId, sessionId, proofId, username: "staff@example.test", label: null } };
    const accessToken = `e30.${btoa(JSON.stringify({ sub: memberId, sid: sessionId }))}.synthetic`;
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    fetcher.mockResolvedValueOnce(reply({ outcome: 3, current, accessToken }, 401));
    await expect(rememberedOperation("select", {})).rejects.toThrow();
    fetcher.mockResolvedValueOnce(reply({ outcome: 0, current, accessToken }));
    await expect(rememberedOperation("lock", {})).rejects.toThrow();
    fetcher.mockResolvedValueOnce(reply({ outcome: 0, current, accessToken }));
    await expect(readRememberedOperation("synthetic")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(reply({ outcome: 0, current, accessToken: `e30.${btoa(JSON.stringify({ sub: memberId, sid: proofId }))}.synthetic` }));
    await expect(rememberedOperation("select", {})).rejects.toThrow();
    fetcher.mockResolvedValueOnce(reply({ outcome: 0, current, accessToken }));
    await expect(rememberedOperation("select", {})).resolves.toMatchObject({ outcome: 0, accessToken });
  });
});
