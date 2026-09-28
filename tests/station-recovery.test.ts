import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConfirmedCheckIn, hasStationLockBarrier, parseStationAttempt, quarantineCheckIn, readQuarantinedCheckIn, readStationAttempt, saveStationAttempt, STATION_LOCK_KEY, type StationAttempt,
} from "../src/features/stations/stationRecovery";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const base = { operationId: id(1), browserSessionId: id(2), generation: 4 };
const attempts: StationAttempt[] = [
  { ...base, kind: "lock" },
  { ...base, kind: "unlock", staffMemberId: id(3) },
  { ...base, kind: "check-in", actorSessionId: id(4), reservationId: id(5), expectedVersion: 2 },
];
const keyFor = (kind: StationAttempt["kind"]) => kind === "lock" ? STATION_LOCK_KEY
  : kind === "unlock" ? "bunkfy.station.attempt.v1" : "bunkfy.station.check-in.v1";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
let local: ReturnType<typeof memoryStorage>;
let tab: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  local = memoryStorage(); tab = memoryStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", tab);
});
afterEach(() => vi.unstubAllGlobals());

describe("station concurrency-only recovery records", () => {
  it("quarantines an old actor's action without blocking or overwriting an unrelated current operation", () => {
    const old = attempts[2];
    const current = { ...old, operationId: id(70), reservationId: id(71), actorSessionId: id(72), generation: 6 };
    saveStationAttempt("check-in", old); quarantineCheckIn(old);
    expect(readStationAttempt("check-in")).toBeNull();
    expect(readQuarantinedCheckIn()).toEqual(old);
    saveStationAttempt("check-in", current);
    expect(() => quarantineCheckIn(current)).toThrow("An earlier check-in still needs review.");
    expect(readStationAttempt("check-in")).toEqual(current);
    expect(readQuarantinedCheckIn()).toEqual(old);
    clearConfirmedCheckIn(current.operationId);
    expect(readStationAttempt("check-in")).toBeNull();
    expect(readQuarantinedCheckIn()).toEqual(old);
  });

  it("clears only the exact confirmed action when an old response arrives late", () => {
    const old = attempts[2];
    saveStationAttempt("check-in", old); quarantineCheckIn(old);
    const current = { ...old, operationId: id(73), reservationId: id(74) };
    saveStationAttempt("check-in", current);
    clearConfirmedCheckIn(old.operationId);
    expect(readQuarantinedCheckIn()).toBeNull();
    expect(readStationAttempt("check-in")).toEqual(current);
  });

  it("does not lose the current action if persisting quarantine fails", () => {
    saveStationAttempt("check-in", attempts[2]);
    tab.setItem.mockImplementationOnce(() => { throw new Error("Storage denied"); });
    expect(() => quarantineCheckIn(attempts[2])).toThrow("Storage denied");
    expect(readStationAttempt("check-in")).toEqual(attempts[2]);
    expect(readQuarantinedCheckIn()).toBeNull();
  });
  it("holds the lock barrier for any stored marker or read failure, releasing it only on confirmed absence", () => {
    expect(hasStationLockBarrier()).toBe(false);
    for (const raw of [JSON.stringify(attempts[0]), JSON.stringify(attempts[1]), "{", "", "null"]) {
      local.values.set(STATION_LOCK_KEY, raw);
      expect(hasStationLockBarrier()).toBe(true);
    }
    local.getItem.mockImplementationOnce(() => { throw new Error("Storage denied"); });
    expect(hasStationLockBarrier()).toBe(true);
    local.values.delete(STATION_LOCK_KEY);
    expect(hasStationLockBarrier()).toBe(false);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(local.removeItem).not.toHaveBeenCalled();
    expect(tab.getItem).not.toHaveBeenCalled();
  });

  it("rejects a valid record of the wrong kind in every recovery slot", () => {
    for (const requested of attempts) {
      const storage = requested.kind === "lock" ? local : tab;
      for (const other of attempts.filter(item => item.kind !== requested.kind)) {
        storage.values.set(keyFor(requested.kind), JSON.stringify(other));
        expect(readStationAttempt(requested.kind)).toBeNull();
      }
    }
    expect(local.removeItem).not.toHaveBeenCalled();
    expect(tab.removeItem).not.toHaveBeenCalled();
  });

  it("rejects Guid.Empty in every required coordinate before saving an attempt", () => {
    for (const attempt of attempts) {
      for (const coordinate of Object.keys(attempt).filter(name => name.endsWith("Id"))) {
        const invalid = { ...attempt, [coordinate]: "00000000-0000-0000-0000-000000000000" };
        expect(parseStationAttempt(JSON.stringify(invalid))).toBeNull();
        expect(() => saveStationAttempt(attempt.kind, invalid)).toThrow("Invalid station recovery reference.");
      }
    }
    expect(local.setItem).not.toHaveBeenCalled();
    expect(tab.setItem).not.toHaveBeenCalled();
  });

  it.each(attempts)("projects exactly the $kind allowlist on parse and save", (attempt) => {
    const contaminated = { ...attempt, pin: "864209", csrfToken: "synthetic-csrf", accessToken: "synthetic-token",
      credential: "synthetic-cookie", setupGrantId: id(99), label: "Synthetic private label", guestName: "Synthetic Guest",
      tenantId: id(98), propertyId: id(97), authority: "not-authority" };

    expect(parseStationAttempt(JSON.stringify(contaminated))).toEqual(attempt);
    saveStationAttempt(attempt.kind, contaminated);

    const storage = attempt.kind === "lock" ? local : tab;
    const raw = storage.values.get(keyFor(attempt.kind))!;
    expect(JSON.parse(raw)).toEqual(attempt);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(Object.keys(attempt).sort());
    for (const forbidden of ["864209", "synthetic-csrf", "synthetic-token", "synthetic-cookie", id(99),
      "Synthetic private label", "Synthetic Guest", id(98), id(97)]) expect(raw).not.toContain(forbidden);
  });

  it.each(attempts)("keeps the same $kind operation and concurrency coordinates across repeated reads", (attempt) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    saveStationAttempt(attempt.kind, attempt);
    const storage = attempt.kind === "lock" ? local : tab;

    expect(readStationAttempt(attempt.kind)).toEqual(attempt);
    expect(readStationAttempt(attempt.kind)).toEqual(attempt);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shares only the local lock barrier between tabs while isolating unlock and job coordinates", () => {
    for (const attempt of attempts) saveStationAttempt(attempt.kind, attempt);
    expect([...local.values.keys()]).toEqual([STATION_LOCK_KEY]);
    expect([...tab.values.keys()].sort()).toEqual([keyFor("unlock"), keyFor("check-in")].sort());
    const firstTab = tab;
    const secondTab = memoryStorage();
    vi.stubGlobal("sessionStorage", secondTab);

    expect(readStationAttempt("lock")).toEqual(attempts[0]);
    expect(readStationAttempt("unlock")).toBeNull();
    expect(readStationAttempt("check-in")).toBeNull();
    const otherUnlock = { ...attempts[1], operationId: id(11) };
    saveStationAttempt("unlock", otherUnlock);
    expect(readStationAttempt("unlock")).toEqual(otherUnlock);

    vi.stubGlobal("sessionStorage", firstTab);
    expect(readStationAttempt("unlock")).toEqual(attempts[1]);
    expect(readStationAttempt("check-in")).toEqual(attempts[2]);
    expect(readStationAttempt("lock")).toEqual(attempts[0]);
  });

  it.each(attempts)("clears only the $kind slot without clearing the other recovery channels", (attempt) => {
    for (const item of attempts) saveStationAttempt(item.kind, item);
    saveStationAttempt(attempt.kind, null);
    expect(readStationAttempt(attempt.kind)).toBeNull();
    for (const other of attempts.filter(item => item.kind !== attempt.kind)) {
      expect(readStationAttempt(other.kind)).toEqual(other);
    }
  });

  it.each(attempts)("rejects saving another operation kind into the $kind slot without overwriting it", (attempt) => {
    saveStationAttempt(attempt.kind, attempt);
    const other = attempts.find(item => item.kind !== attempt.kind)!;
    expect(() => saveStationAttempt(attempt.kind, other)).toThrow("Invalid station recovery reference.");
    expect(readStationAttempt(attempt.kind)).toEqual(attempt);
  });

  it.each([
    { name: "absent", raw: null },
    { name: "invalid JSON", raw: "{" },
    { name: "null", raw: "null" },
    { name: "array", raw: "[]" },
    { name: "unknown kind", raw: JSON.stringify({ ...base, kind: "redeem-setup" }) },
    { name: "missing operation", raw: JSON.stringify({ ...base, operationId: undefined, kind: "lock" }) },
    { name: "malformed operation", raw: JSON.stringify({ ...base, operationId: "../other", kind: "lock" }) },
    { name: "missing browser", raw: JSON.stringify({ ...base, browserSessionId: undefined, kind: "lock" }) },
    { name: "malformed browser", raw: JSON.stringify({ ...base, browserSessionId: 5, kind: "lock" }) },
    { name: "zero generation", raw: JSON.stringify({ ...base, generation: 0, kind: "lock" }) },
    { name: "negative generation", raw: JSON.stringify({ ...base, generation: -1, kind: "lock" }) },
    { name: "fractional generation", raw: JSON.stringify({ ...base, generation: 1.5, kind: "lock" }) },
    { name: "unsafe generation", raw: JSON.stringify({ ...base, generation: Number.MAX_SAFE_INTEGER + 1, kind: "lock" }) },
    { name: "string generation", raw: JSON.stringify({ ...base, generation: "4", kind: "lock" }) },
    { name: "unlock missing staff", raw: JSON.stringify({ ...base, kind: "unlock" }) },
    { name: "unlock malformed staff", raw: JSON.stringify({ ...base, kind: "unlock", staffMemberId: "bad" }) },
    { name: "check-in missing actor", raw: JSON.stringify({ ...attempts[2], actorSessionId: undefined }) },
    { name: "check-in malformed reservation", raw: JSON.stringify({ ...attempts[2], reservationId: "bad" }) },
    { name: "check-in missing version", raw: JSON.stringify({ ...attempts[2], expectedVersion: undefined }) },
    { name: "check-in zero version", raw: JSON.stringify({ ...attempts[2], expectedVersion: 0 }) },
    { name: "check-in unsafe version", raw: JSON.stringify({ ...attempts[2], expectedVersion: Number.MAX_SAFE_INTEGER + 1 }) },
  ])("does not recover malformed $name coordinates", ({ raw }) => {
    expect(parseStationAttempt(raw)).toBeNull();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(tab.setItem).not.toHaveBeenCalled();
  });

  it.each(attempts)("does not erase a malformed $kind slot while reading it", (attempt) => {
    const storage = attempt.kind === "lock" ? local : tab;
    storage.values.set(keyFor(attempt.kind), "{");
    expect(readStationAttempt(attempt.kind)).toBeNull();
    expect(storage.values.get(keyFor(attempt.kind))).toBe("{");
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(attempts)("propagates a failed $kind write or clear so the caller cannot assume persistence", (attempt) => {
    const storage = attempt.kind === "lock" ? local : tab;
    const failure = new Error("Storage denied");
    storage.setItem.mockImplementationOnce(() => { throw failure; });
    expect(() => saveStationAttempt(attempt.kind, attempt)).toThrow(failure);
    storage.removeItem.mockImplementationOnce(() => { throw failure; });
    expect(() => saveStationAttempt(attempt.kind, null)).toThrow(failure);
  });
});
