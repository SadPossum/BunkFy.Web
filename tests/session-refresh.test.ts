import { afterEach, describe, expect, it, vi } from "vitest";
import { createSingleFlightRefresh, runWithBrowserSessionLock } from "../src/app/singleFlightRefresh";

const identity = { tenantId: "tenant-a", username: "member@example.com" };

afterEach(() => vi.unstubAllGlobals());

describe("browser session refresh", () => {
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
});
