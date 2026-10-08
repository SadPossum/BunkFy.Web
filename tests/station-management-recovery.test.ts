import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readManagementRecovery, saveManagementRecovery, readPairingContext, savePairingContext,
  type ManagementRecovery, type PairingContext,
} from "../src/features/stations/stationManagementRecovery";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const account = id(1), tenant = id(2), property = id(3);
const scopeKey = (subject = account, workspace = tenant, target = property) =>
  `bunkfy.station-manager.v1:${subject}:${workspace}:${target}`;
const key = scopeKey();
const pairing: PairingContext = { stationId: id(4), browserSessionId: id(5), originalIssuerSessionId: id(6) };
const commands: { name: string; recovery: ManagementRecovery }[] = [
  { name: "Register", recovery: { id: id(10), command: { kind: 1, expectedVersion: 0 } } },
  { name: "Reset", recovery: { id: id(11), command: { kind: 5, expectedVersion: 2, staffMemberId: id(7) } } },
  { name: "RevokeGrant", recovery: { id: id(12), command: { kind: 6, expectedVersion: 2, staffMemberId: id(7) } } },
  { name: "RevokeStation", recovery: { id: id(13), command: { kind: 7, expectedVersion: 2, stationId: id(4) } } },
  { name: "Pair", recovery: { id: id(14), command: { kind: 9, expectedVersion: 2, stationId: id(4) } } },
  { name: "RegisterStaff", recovery: { id: id(15), command: { kind: 10, expectedVersion: 0, staffMemberId: id(7) } } },
  { name: "UnregisterStaff", recovery: { id: id(16), command: { kind: 11, expectedVersion: 2, staffMemberId: id(7) } } },
  { name: "GrantCheckIn", recovery: { id: id(17), command: { kind: 12, expectedVersion: 0, staffMemberId: id(7) } } },
  { name: "IssueSetup", recovery: { id: id(18), command: { kind: 13, expectedVersion: 0, stationId: id(4), browserSessionId: id(5), staffMemberId: id(7) } } },
  { name: "CancelSetup", recovery: { id: id(19), command: { kind: 14, expectedVersion: 0 } } },
  { name: "GrantCheckOut", recovery: { id: id(20), command: { kind: 16, expectedVersion: 0, staffMemberId: id(7) } } },
  { name: "RevokeCheckOutGrant", recovery: { id: id(21), command: { kind: 17, expectedVersion: 2, staffMemberId: id(7) } } },
];
const values = new Map<string, string>();
const storage = {
  getItem: vi.fn((name: string) => values.get(name) ?? null),
  setItem: vi.fn((name: string, value: string) => { values.set(name, value); }),
  removeItem: vi.fn((name: string) => { values.delete(name); }),
};
const localRead = vi.fn();
const localWrite = vi.fn();

beforeEach(() => {
  values.clear(); vi.clearAllMocks();
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("localStorage", { getItem: localRead, setItem: localWrite });
});
afterEach(() => vi.unstubAllGlobals());

describe("manager same-operation recovery", () => {
  it("rejects Guid.Empty for operation and all retained command coordinates", () => {
    const empty = "00000000-0000-0000-0000-000000000000";
    const recovery = commands[8].recovery;
    values.set(`${key}:operation`, JSON.stringify({ ...recovery, id: empty }));
    expect(readManagementRecovery(key)).toBeNull();
    for (const coordinate of ["stationId", "browserSessionId", "staffMemberId"]) {
      values.set(`${key}:operation`, JSON.stringify({ ...recovery, command: { ...recovery.command, [coordinate]: empty } }));
      expect(readManagementRecovery(key)).toBeNull();
    }
  });

  it.each(commands)("keeps only the sparse $name coordinates and original operation ID", ({ recovery }) => {
    const contaminated = { ...recovery, pin: "864209", command: { ...recovery.command,
      operationId: id(99), label: "Synthetic private label", setupGrantId: id(98), pin: "864209",
      csrfToken: "synthetic-csrf", accessToken: "synthetic-token", credential: "synthetic-cookie",
      tenantId: id(97), propertyId: id(96) } };
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);

    saveManagementRecovery(key, contaminated);

    const expected = recovery.command.kind === 1 ? { ...recovery, command: { ...recovery.command, label: "Synthetic private label" } } : recovery;
    const raw = values.get(`${key}:operation`)!;
    expect(JSON.parse(raw)).toEqual({ ...expected, startedAt: expect.any(Number) });
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["command", "id", "startedAt"]);
    expect(Object.keys(JSON.parse(raw).command).sort()).toEqual(Object.keys(expected.command).sort());
    for (const secret of ["864209", id(98), "synthetic-csrf", "synthetic-token", "synthetic-cookie", id(99), id(97), id(96)]) {
      expect(raw).not.toContain(secret);
    }
    expect(readManagementRecovery(key)).toEqual(expected);
    expect(readManagementRecovery(key)).toEqual(expected);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(localRead).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // CancelSetup has no grant in storage and is outcome-only; it is not exposed by the manager UI.
  });

  it("also strips non-allowlisted fields from an already stored management record", () => {
    const recovery = commands[8].recovery;
    values.set(`${key}:operation`, JSON.stringify({ ...recovery, issuerSubjectId: account,
      command: { ...recovery.command, pin: "864209", setupGrantId: id(98), label: "Synthetic label", csrfToken: "synthetic-csrf" } }));
    expect(readManagementRecovery(key)).toEqual(recovery);
    expect(JSON.parse(values.get(`${key}:operation`)!)).toEqual(recovery);
  });

  it("expires only the station display label after two hours, never the unresolved operation", () => {
    const recovery = { ...commands[0].recovery, command: { ...commands[0].recovery.command, label: "Reception" } };
    values.set(`${key}:operation`, JSON.stringify({ ...recovery, startedAt: Date.now() - 2 * 60 * 60 * 1000 }));
    expect(readManagementRecovery(key)).toEqual(commands[0].recovery);
    expect(values.get(`${key}:operation`)).not.toContain("Reception");
    expect(readManagementRecovery(key)?.id).toBe(recovery.id);
  });

  it("does not drop an unresolved operation if expired-label cleanup fails", () => {
    values.set(`${key}:operation`, JSON.stringify({ ...commands[0].recovery, startedAt: 0,
      command: { ...commands[0].recovery.command, label: "Reception" } }));
    storage.setItem.mockImplementationOnce(() => { throw new Error("Storage denied"); });
    expect(readManagementRecovery(key)).toEqual(commands[0].recovery);
  });

  it.each([
    { name: "account", other: scopeKey(id(21), tenant, property) },
    { name: "workspace", other: scopeKey(account, id(22), property) },
    { name: "property", other: scopeKey(account, tenant, id(23)) },
  ])("isolates operation and pairing records by the exact $name key", ({ other }) => {
    saveManagementRecovery(key, commands[0].recovery);
    savePairingContext(key, pairing);
    expect(readManagementRecovery(other)).toBeNull();
    expect(readPairingContext(other)).toBeNull();
    saveManagementRecovery(other, commands[1].recovery);
    const otherPairing = { ...pairing, originalIssuerSessionId: id(24) };
    savePairingContext(other, otherPairing);
    saveManagementRecovery(key, null);
    savePairingContext(key, null);
    expect(readManagementRecovery(key)).toBeNull();
    expect(readPairingContext(key)).toBeNull();
    expect(readManagementRecovery(other)).toEqual(commands[1].recovery);
    expect(readPairingContext(other)).toEqual(otherPairing);
  });

  it.each([
    { name: "operation", clear: () => saveManagementRecovery(key, null) },
    { name: "pairing", clear: () => savePairingContext(key, null) },
  ])("clears only the $name phase under one manager key", ({ name, clear }) => {
    saveManagementRecovery(key, commands[0].recovery); savePairingContext(key, pairing);
    clear();
    expect(readManagementRecovery(key)).toEqual(name === "operation" ? null : commands[0].recovery);
    expect(readPairingContext(key)).toEqual(name === "pairing" ? null : pairing);
  });

  it.each([
    { name: "broken JSON", raw: "{" },
    { name: "null", raw: "null" },
    { name: "array", raw: "[]" },
    { name: "missing operation", raw: JSON.stringify({ command: { kind: 1, expectedVersion: 0 } }) },
    { name: "invalid operation", raw: JSON.stringify({ id: "../other", command: { kind: 1, expectedVersion: 0 } }) },
    { name: "missing command", raw: JSON.stringify({ id: id(10) }) },
    { name: "string command", raw: JSON.stringify({ id: id(10), command: "bad" }) },
    { name: "unknown kind", raw: JSON.stringify({ id: id(10), command: { kind: 99, expectedVersion: 0 } }) },
    { name: "runtime kind", raw: JSON.stringify({ id: id(10), command: { kind: 3, expectedVersion: 0 } }) },
    { name: "own PIN kind", raw: JSON.stringify({ id: id(10), command: { kind: 15, expectedVersion: 0 } }) },
    { name: "string kind", raw: JSON.stringify({ id: id(10), command: { kind: "1", expectedVersion: 0 } }) },
    { name: "missing version", raw: JSON.stringify({ id: id(10), command: { kind: 1 } }) },
    { name: "negative version", raw: JSON.stringify({ id: id(10), command: { kind: 1, expectedVersion: -1 } }) },
    { name: "fractional version", raw: JSON.stringify({ id: id(10), command: { kind: 1, expectedVersion: 0.5 } }) },
    { name: "unsafe version", raw: JSON.stringify({ id: id(10), command: { kind: 1, expectedVersion: Number.MAX_SAFE_INTEGER + 1 } }) },
    { name: "string version", raw: JSON.stringify({ id: id(10), command: { kind: 1, expectedVersion: "0" } }) },
    { name: "malformed station", raw: JSON.stringify({ id: id(10), command: { kind: 9, expectedVersion: 1, stationId: "bad" } }) },
    { name: "malformed browser", raw: JSON.stringify({ id: id(10), command: { kind: 13, expectedVersion: 0, browserSessionId: [] } }) },
    { name: "malformed staff", raw: JSON.stringify({ id: id(10), command: { kind: 10, expectedVersion: 0, staffMemberId: 5 } }) },
  ])("keeps malformed $name management coordinates inert without deleting them", ({ raw }) => {
    values.set(`${key}:operation`, raw);
    expect(readManagementRecovery(key)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(values.get(`${key}:operation`)).toBe(raw);
  });
});

describe("exact-original-session pairing recovery", () => {
  it("rejects Guid.Empty for all three pairing coordinates", () => {
    for (const coordinate of Object.keys(pairing)) {
      values.set(`${key}:securing`, JSON.stringify({ ...pairing, [coordinate]: "00000000-0000-0000-0000-000000000000" }));
      expect(readPairingContext(key)).toBeNull();
    }
  });

  it("stores and reads only station/browser/original-session coordinates, never a cookie or grant", () => {
    const contaminated = { ...pairing, pin: "864209", label: "Synthetic private label", setupGrantId: id(98),
      credential: "synthetic-cookie", csrfToken: "synthetic-csrf", accessToken: "synthetic-token", issuerSubjectId: account };
    savePairingContext(key, contaminated);
    const raw = values.get(`${key}:securing`)!;
    expect(JSON.parse(raw)).toEqual(pairing);
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["browserSessionId", "originalIssuerSessionId", "stationId"]);
    expect(readPairingContext(key)).toEqual(pairing);
    values.set(`${key}:securing`, JSON.stringify(contaminated));
    expect(readPairingContext(key)).toEqual(pairing);
    expect(localWrite).not.toHaveBeenCalled();
  });

  it.each([
    { name: "broken JSON", raw: "{" },
    { name: "null", raw: "null" },
    { name: "missing station", raw: JSON.stringify({ ...pairing, stationId: undefined }) },
    { name: "malformed station", raw: JSON.stringify({ ...pairing, stationId: "bad" }) },
    { name: "missing browser", raw: JSON.stringify({ ...pairing, browserSessionId: undefined }) },
    { name: "malformed browser", raw: JSON.stringify({ ...pairing, browserSessionId: 2 }) },
    { name: "missing original session", raw: JSON.stringify({ ...pairing, originalIssuerSessionId: undefined }) },
    { name: "malformed original session", raw: JSON.stringify({ ...pairing, originalIssuerSessionId: "bad" }) },
  ])("does not recover $name pairing coordinates", ({ raw }) => {
    values.set(`${key}:securing`, raw);
    expect(readPairingContext(key)).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("does not replace the original issuer session on reload", () => {
    savePairingContext(key, pairing);
    expect(readPairingContext(key)?.originalIssuerSessionId).toBe(pairing.originalIssuerSessionId);
    expect(readPairingContext(key)?.originalIssuerSessionId).toBe(pairing.originalIssuerSessionId);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "operation write", action: () => saveManagementRecovery(key, commands[0].recovery), method: "setItem" as const },
    { name: "operation clear", action: () => saveManagementRecovery(key, null), method: "removeItem" as const },
    { name: "pairing write", action: () => savePairingContext(key, pairing), method: "setItem" as const },
    { name: "pairing clear", action: () => savePairingContext(key, null), method: "removeItem" as const },
  ])("does not hide a failed $name", ({ action, method }) => {
    const failure = new Error("Storage denied");
    storage[method].mockImplementationOnce(() => { throw failure; });
    expect(action).toThrow(failure);
  });
});
