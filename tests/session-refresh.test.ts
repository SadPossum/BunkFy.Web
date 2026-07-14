import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSingleFlightRefresh,
  hasSessionBoundaryChanged,
  hasSessionIdentityChanged,
  runWithBrowserSessionLock,
  startBrowserSessionSignOut,
} from "../src/app/singleFlightRefresh";

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
