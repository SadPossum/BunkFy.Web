// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { accountPrivacyCovered, clearAccountOperation, clearAccountPrivacy, coverAccountPrivacy,
  readAccountOperation, safeAccountReturnPath, saveAccountOperation, supersedeRememberWithLock } from "../src/features/account-switch/accountSwitchRecovery";

const operation = { operationId: "11111111-1111-4111-8111-111111111111", expectedGeneration: 4, kind: "select" as const,
  proofId: "22222222-2222-4222-8222-222222222222" };
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
describe("account switch recovery coordinates", () => {
  it("retains only the original nonsecret operation, never PIN or token", () => {
    saveAccountOperation({ ...operation, pin: "synthetic-secret", accessToken: "synthetic-token" } as typeof operation);
    expect(readAccountOperation()).toEqual(operation);
    expect(sessionStorage.getItem("bunkfy.account-switch.pending.v1")).not.toMatch(/secret|token|pin|username/);
    expect(() => saveAccountOperation({ ...operation, operationId: "33333333-3333-4333-8333-333333333333" })).toThrow("previous account change");
    saveAccountOperation(operation);
  });
  it("clears only the acknowledged operation", () => {
    saveAccountOperation(operation);
    clearAccountOperation("33333333-3333-4333-8333-333333333333");
    expect(readAccountOperation()).toEqual(operation);
    clearAccountOperation(operation.operationId); expect(readAccountOperation()).toBeNull();
  });
  it("rejects malformed generation and strips unknown persisted fields", () => {
    sessionStorage.setItem("bunkfy.account-switch.pending.v1", JSON.stringify({ ...operation, expectedGeneration: -1 }));
    expect(readAccountOperation()).toBeNull();
    sessionStorage.setItem("bunkfy.account-switch.pending.v1", JSON.stringify({ ...operation, unknown: "private" }));
    expect(readAccountOperation()).toEqual(operation);
  });
  it("covers every tab without persisting identity", () => {
    expect(accountPrivacyCovered()).toBe(false); coverAccountPrivacy();
    expect(accountPrivacyCovered()).toBe(true);
    expect(localStorage.getItem("bunkfy.account-switch.cover.v1")).toBe("covered");
    clearAccountPrivacy(); expect(accountPrivacyCovered()).toBe(false);
  });

  it("does not treat a corrupt privacy marker as permission to show the old account", () => {
    localStorage.setItem("bunkfy.account-switch.cover.v1", "damaged-marker");
    expect(accountPrivacyCovered()).toBe(true);
  });
  it("never carries record queries, external destinations or unknown paths to another actor", () => {
    expect(safeAccountReturnPath("/calendar")).toBe("/calendar");
    expect(safeAccountReturnPath("/reservations?reservation=private")).toBe("/");
    expect(safeAccountReturnPath("https://other.test")).toBe("/");
    expect(safeAccountReturnPath("/unknown")).toBe("/");
  });

  it("atomically retains an unconfirmed setup reference in a deliberate same-generation lock", () => {
    const original = { operationId: operation.operationId, expectedGeneration: 4, kind: "remember" as const };
    saveAccountOperation(original);
    expect(() => supersedeRememberWithLock(original, "33333333-3333-4333-8333-333333333333", 5)).toThrow();
    expect(readAccountOperation()).toEqual(original);
    const lock = supersedeRememberWithLock(original, "33333333-3333-4333-8333-333333333333", 4);
    expect(readAccountOperation()).toEqual({ operationId: lock.operationId, kind: "lock", expectedGeneration: 4,
      supersededOperationId: original.operationId });
    expect(() => saveAccountOperation(original)).toThrow("previous account change");
    const successor = supersedeRememberWithLock(lock, "44444444-4444-4444-8444-444444444444", 6);
    expect(successor.supersededOperationId).toBe(original.operationId);
    clearAccountOperation(lock.operationId); expect(readAccountOperation()).toEqual(successor);
    clearAccountOperation(successor.operationId); expect(readAccountOperation()).toBeNull();
  });

  it("does not widen ordinary save collision protection or supersede a selection", () => {
    saveAccountOperation(operation);
    expect(() => supersedeRememberWithLock(operation, "33333333-3333-4333-8333-333333333333", 4)).toThrow();
    expect(readAccountOperation()).toEqual(operation);
  });
});
