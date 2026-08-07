import { describe, expect, it } from "vitest";
import {
  resolvePropertyUpdateAttempt,
  type PropertyUpdatePayload,
} from "../src/features/properties/propertyUpdateAttempt";

const payload: PropertyUpdatePayload = {
  propertyId: "10000000-0000-0000-0000-000000000001",
  expectedVersion: 7,
  name: "Harbour House",
  code: "harbour-house",
  timeZoneId: "Europe/London",
};

describe("property update attempts", () => {
  it("keeps one operation id for a normalized retry", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolvePropertyUpdateAttempt(null, payload, allocate);
    const retry = resolvePropertyUpdateAttempt(
      first,
      {
        ...payload,
        name: "  Harbour House  ",
        code: " HARBOUR-HOUSE ",
        timeZoneId: " Europe/London ",
      },
      allocate,
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
    expect(allocations).toBe(1);
  });

  it("allocates a new operation for changed values or version", () => {
    let allocations = 0;
    const allocate = () => `operation-${++allocations}`;
    const first = resolvePropertyUpdateAttempt(null, payload, allocate);
    const changed = resolvePropertyUpdateAttempt(
      first,
      { ...payload, name: "Harbour Annex" },
      allocate,
    );
    const newerVersion = resolvePropertyUpdateAttempt(
      changed,
      { ...payload, name: "Harbour Annex", expectedVersion: 8 },
      allocate,
    );

    expect(changed.operationId).toBe("operation-2");
    expect(newerVersion.operationId).toBe("operation-3");
  });
});
