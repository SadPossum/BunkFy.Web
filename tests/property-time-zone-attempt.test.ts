import { describe, expect, it } from "vitest";
import {
  resolvePropertyTimeZoneAttempt,
  type PropertyTimeZonePayload,
} from "../src/features/properties/propertyTimeZoneAttempt";

const payload: PropertyTimeZonePayload = {
  propertyId: "10000000-0000-0000-0000-000000000001",
  expectedVersion: 7,
  timeZoneId: "Europe/London",
};

describe("property time-zone attempts", () => {
  it("keeps one operation id for a normalized retry", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolvePropertyTimeZoneAttempt(null, payload, allocate);
    const retry = resolvePropertyTimeZoneAttempt(
      first,
      { ...payload, timeZoneId: " Europe/London " },
      allocate,
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
    expect(allocations).toBe(1);
  });

  it("allocates a new operation for changed values or version", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolvePropertyTimeZoneAttempt(null, payload, allocate);
    const changed = resolvePropertyTimeZoneAttempt(
      first,
      { ...payload, timeZoneId: "Europe/Paris" },
      allocate,
    );
    const newerVersion = resolvePropertyTimeZoneAttempt(
      changed,
      { ...payload, timeZoneId: "Europe/Paris", expectedVersion: 8 },
      allocate,
    );

    expect(changed.operationId).toBe("operation-2");
    expect(newerVersion.operationId).toBe("operation-3");
  });
});
