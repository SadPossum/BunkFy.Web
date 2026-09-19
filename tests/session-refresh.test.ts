import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSingleFlightRefresh,
  hasSessionActorGenerationChanged,
  hasSessionBoundaryChanged,
  hasSessionIdentityChanged,
  runWithBrowserSessionLock,
  startBrowserSessionSignOut,
  type SessionIdentity,
} from "../src/app/singleFlightRefresh";
import {
  readAccessTokenIdentity,
  resolveRefreshedSessionIdentity,
  SessionIdentityMismatchError,
} from "../src/app/sessionTokenIdentity";

const identity = { tenantId: "tenant-a", username: "member@example.com" };

afterEach(() => vi.unstubAllGlobals());

describe("browser session refresh", () => {
  it("identifies user and workspace changes as query-cache boundaries", () => {
    expect(hasSessionBoundaryChanged(null, identity)).toBe(true);
    expect(hasSessionBoundaryChanged(identity, null)).toBe(true);
    expect(hasSessionBoundaryChanged(identity, identity)).toBe(false);
    expect(hasSessionBoundaryChanged(identity, { ...identity, tenantId: "tenant-b" })).toBe(true);
    expect(hasSessionBoundaryChanged(identity, { ...identity, username: "other@example.com" })).toBe(true);
    expect(hasSessionBoundaryChanged(identity, { ...identity, username: "MEMBER@EXAMPLE.COM" })).toBe(false);
    expect(hasSessionIdentityChanged(identity, { ...identity, tenantId: "tenant-b" })).toBe(false);
    expect(hasSessionIdentityChanged(identity, { ...identity, username: "other@example.com" })).toBe(true);
    expect(hasSessionActorGenerationChanged(
      { ...identity, generation: "first" },
      { ...identity, generation: "second" },
    )).toBe(true);
  });

  it("coalesces concurrent refresh attempts and resets after completion", async () => {
    let resolveFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const refreshOperation = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce("access-token-2");
    const refresh = createSingleFlightRefresh(refreshOperation);

    const requestA = refresh(identity);
    const requestB = refresh(identity);

    expect(requestB).toBe(requestA);
    expect(refreshOperation).toHaveBeenCalledOnce();

    resolveFirst("access-token-1");
    await expect(Promise.all([requestA, requestB])).resolves.toEqual(["access-token-1", "access-token-1"]);

    await expect(refresh(identity)).resolves.toBe("access-token-2");
    expect(refreshOperation).toHaveBeenCalledTimes(2);
  });

  it("allows a clean retry after a failed refresh", async () => {
    const refreshOperation = vi.fn()
      .mockRejectedValueOnce(new Error("expired"))
      .mockResolvedValueOnce("access-token");
    const refresh = createSingleFlightRefresh(refreshOperation);

    await expect(refresh(identity)).rejects.toThrow("expired");
    await expect(refresh(identity)).resolves.toBe("access-token");
    expect(refreshOperation).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce refreshes across different actor generations", async () => {
    const refreshOperation = vi.fn(async (value: SessionIdentity) => value.username);
    const refresh = createSingleFlightRefresh<string>(refreshOperation);

    const first = refresh({ ...identity, generation: "first" });
    const second = refresh({ ...identity, username: "other@example.com", generation: "second" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      "member@example.com",
      "other@example.com",
    ]);
    expect(refreshOperation).toHaveBeenCalledTimes(2);
  });

  it("binds refresh results to the token subject and current browser generation", () => {
    const subjectId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "22222222-2222-4222-8222-222222222222";
    const token = jwt({ sub: subjectId, sid: sessionId });

    expect(readAccessTokenIdentity(token)).toEqual({ subjectId, sessionId });
    expect(resolveRefreshedSessionIdentity(
      { ...identity, subjectId, sessionId, generation: "current" },
      null,
      { subjectId, sessionId },
    )).toMatchObject({ generation: "current", subjectId, sessionId });
  });

  it("uses a newly published browser identity instead of merging another actor's token", () => {
    const oldSubjectId = "11111111-1111-4111-8111-111111111111";
    const newSubjectId = "33333333-3333-4333-8333-333333333333";
    const newSessionId = "44444444-4444-4444-8444-444444444444";

    expect(resolveRefreshedSessionIdentity(
      { ...identity, subjectId: oldSubjectId, sessionId: "22222222-2222-4222-8222-222222222222" },
      { tenantId: "global", username: "new@example.com", subjectId: newSubjectId, sessionId: newSessionId, generation: "new" },
      { subjectId: newSubjectId, sessionId: newSessionId },
    )).toMatchObject({ username: "new@example.com", generation: "new" });

    expect(() => resolveRefreshedSessionIdentity(
      { ...identity, subjectId: oldSubjectId },
      null,
      { subjectId: newSubjectId, sessionId: newSessionId },
    )).toThrow(SessionIdentityMismatchError);
  });

  it("serializes shared browser-cookie mutations across tabs when Web Locks are available", async () => {
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      operation: () => Promise<string>,
    ) => operation());
    vi.stubGlobal("navigator", { locks: { request } });

    await expect(runWithBrowserSessionLock(async () => "access-token")).resolves.toBe("access-token");

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe("bunkfy.browser-session.cookies");
    expect(request.mock.calls[0]?.[1]).toEqual({ mode: "exclusive" });
  });

  it("uses the in-process operation when Web Locks are unavailable", async () => {
    vi.stubGlobal("navigator", {});
    const operation = vi.fn().mockResolvedValue("access-token");

    await expect(runWithBrowserSessionLock(operation)).resolves.toBe("access-token");

    expect(operation).toHaveBeenCalledOnce();
  });

  it("clears local state before a contended browser-session lock becomes available", async () => {
    const request = vi.fn(() => new Promise<never>(() => {}));
    vi.stubGlobal("navigator", { locks: { request } });
    const clearLocalSession = vi.fn();
    const revokeRemoteSession = vi.fn().mockResolvedValue(undefined);

    startBrowserSessionSignOut(clearLocalSession, revokeRemoteSession);

    expect(clearLocalSession).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(revokeRemoteSession).not.toHaveBeenCalled();
  });

  it("keeps local sign-out successful when remote revocation fails", async () => {
    vi.stubGlobal("navigator", {});
    const clearLocalSession = vi.fn();
    const revokeRemoteSession = vi.fn().mockRejectedValue(new Error("offline"));

    startBrowserSessionSignOut(clearLocalSession, revokeRemoteSession);
    await vi.waitFor(() => expect(revokeRemoteSession).toHaveBeenCalledOnce());

    expect(clearLocalSession).toHaveBeenCalledOnce();
  });
});

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value))
    .toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.`;
}
