import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPinChangeIntent, savePinChangeIntent, type PinChangeIntent } from "../src/features/stations/pinChangeRecovery";

const key = "bunkfy.pin-change.v1:synthetic-subject:synthetic-tenant:synthetic-property";
const otherKey = "bunkfy.pin-change.v1:other-subject:synthetic-tenant:synthetic-property";
const intent: PinChangeIntent = {
  operationId: "00000000-0000-4000-8000-000000000001",
  expectedRevision: 3,
  startedAt: Date.UTC(2026, 8, 28, 12),
};
const values = new Map<string, string>();
const storage = {
  getItem: vi.fn((name: string) => values.get(name) ?? null),
  setItem: vi.fn((name: string, value: string) => { values.set(name, value); }),
  removeItem: vi.fn((name: string) => { values.delete(name); }),
};
const localStorageRead = vi.fn();
const localStorageWrite = vi.fn();

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("localStorage", { getItem: localStorageRead, setItem: localStorageWrite });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("non-secret same-tab PIN change recovery", () => {
  it("writes only the three recovery coordinates, even when the caller object has secret extras", () => {
    const contaminated = { ...intent, pin: "864209", confirmPin: "864209", csrfToken: "synthetic-csrf",
      accessToken: "synthetic-primary-token", stationCookie: "synthetic-station-cookie", staffMemberId: "not-a-recovery-coordinate" };

    savePinChangeIntent(key, contaminated);

    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.setItem.mock.calls[0]?.[0]).toBe(key);
    const raw = values.get(key)!;
    expect(JSON.parse(raw)).toEqual(intent);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["expectedRevision", "operationId", "startedAt"]);
    for (const secret of [contaminated.pin, contaminated.csrfToken, contaminated.accessToken, contaminated.stationCookie]) {
      expect(raw).not.toContain(secret);
    }
    expect(localStorageRead).not.toHaveBeenCalled();
    expect(localStorageWrite).not.toHaveBeenCalled();
  });

  it("whitelists recovered fields and does not return secret or authority extras from old storage", () => {
    values.set(key, JSON.stringify({ ...intent, pin: "000001", csrfToken: "synthetic-csrf", credential: "synthetic-credential",
      accessToken: "synthetic-primary-token", tenantId: "other-tenant", propertyId: "other-property" }));

    const recovered = readPinChangeIntent(key);

    expect(recovered).toEqual(intent);
    expect(Object.keys(recovered!).sort()).toEqual(["expectedRevision", "operationId", "startedAt"]);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(localStorageRead).not.toHaveBeenCalled();
  });

  it("round-trips an intent without generating a new operation or dispatching any request", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    savePinChangeIntent(key, intent);

    expect(readPinChangeIntent(key)).toEqual(intent);
    expect(readPinChangeIntent(key)).toEqual(intent);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains an old unresolved coordinate and stale revision for receipt lookup instead of silently creating a new change", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 28));
    const old = { ...intent, expectedRevision: 0, startedAt: Date.UTC(2001, 0, 1) };
    values.set(key, JSON.stringify(old));

    expect(readPinChangeIntent(key)).toEqual(old);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    // Fresh server status/receipts decide the outcome; this storage reader cannot grant a retry.
  });

  it("isolates reads and cleanup to the caller's exact account/workspace/property key", () => {
    values.set(key, JSON.stringify(intent));
    values.set(otherKey, JSON.stringify({ ...intent, expectedRevision: 9 }));
    expect(readPinChangeIntent("unrelated-key")).toBeNull();

    savePinChangeIntent(key, null);

    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(key);
    expect(readPinChangeIntent(key)).toBeNull();
    expect(readPinChangeIntent(otherKey)).toEqual({ ...intent, expectedRevision: 9 });
  });

  it.each([0, Number.MAX_SAFE_INTEGER])("accepts safe nonnegative revision %s", (expectedRevision) => {
    values.set(key, JSON.stringify({ ...intent, expectedRevision }));
    expect(readPinChangeIntent(key)).toEqual({ ...intent, expectedRevision });
  });

  it.each([
    { name: "invalid JSON", raw: "{" },
    { name: "null", raw: "null" },
    { name: "array", raw: "[]" },
    { name: "number", raw: "1" },
    { name: "string", raw: '"not-an-intent"' },
    { name: "empty object", raw: "{}" },
    { name: "missing operation", raw: JSON.stringify({ expectedRevision: 3, startedAt: intent.startedAt }) },
    { name: "malformed operation", raw: JSON.stringify({ ...intent, operationId: "../other-operation" }) },
    { name: "non-string operation", raw: JSON.stringify({ ...intent, operationId: {} }) },
    { name: "missing revision", raw: JSON.stringify({ operationId: intent.operationId, startedAt: intent.startedAt }) },
    { name: "negative revision", raw: JSON.stringify({ ...intent, expectedRevision: -1 }) },
    { name: "fractional revision", raw: JSON.stringify({ ...intent, expectedRevision: 1.5 }) },
    { name: "unsafe revision", raw: JSON.stringify({ ...intent, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }) },
    { name: "string revision", raw: JSON.stringify({ ...intent, expectedRevision: "3" }) },
    { name: "missing timestamp", raw: JSON.stringify({ operationId: intent.operationId, expectedRevision: 3 }) },
    { name: "string timestamp", raw: JSON.stringify({ ...intent, startedAt: "2026-09-28" }) },
    { name: "null timestamp", raw: JSON.stringify({ ...intent, startedAt: null }) },
    { name: "non-finite timestamp", raw: `{"operationId":"${intent.operationId}","expectedRevision":3,"startedAt":1e400}` },
  ])("leaves malformed $name metadata inert", ({ raw }) => {
    values.set(key, raw);
    expect(readPinChangeIntent(key)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(values.get(key)).toBe(raw);
  });

  it("returns no intent when tab storage is absent or inaccessible", () => {
    expect(readPinChangeIntent(key)).toBeNull();
    storage.getItem.mockImplementationOnce(() => { throw new Error("Storage denied"); });
    expect(readPinChangeIntent(key)).toBeNull();
  });

  it.each(["write", "clear"] as const)("does not hide a failed recovery %s", (operation) => {
    const failure = new Error("Storage denied");
    if (operation === "write") storage.setItem.mockImplementationOnce(() => { throw failure; });
    else storage.removeItem.mockImplementationOnce(() => { throw failure; });

    expect(() => savePinChangeIntent(key, operation === "write" ? intent : null)).toThrow(failure);
  });
});
