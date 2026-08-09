import { describe, expect, it } from "vitest";
import { resolveSalesModeMutationAttempt } from "../src/features/inventory/salesModeMutationAttempt";

describe("resolveSalesModeMutationAttempt", () => {
  it("keeps operation identity and the original version for an exact retry", () => {
    const first = resolveSalesModeMutationAttempt(
      null,
      {
        propertyId: "PROPERTY-A",
        roomId: "ROOM-A",
        salesMode: "bedLevel",
        expectedVersion: 4,
      },
      () => "operation-1",
    );
    const retry = resolveSalesModeMutationAttempt(
      first,
      {
        propertyId: "property-a",
        roomId: "room-a",
        salesMode: "bedLevel",
        expectedVersion: 5,
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
    expect(retry.expectedVersion).toBe(4);
  });

  it("creates a new attempt when the target or requested mode changes", () => {
    const first = resolveSalesModeMutationAttempt(
      null,
      {
        propertyId: "property-a",
        roomId: "room-a",
        salesMode: "bedLevel",
        expectedVersion: 4,
      },
      () => "operation-1",
    );
    const changedMode = resolveSalesModeMutationAttempt(
      first,
      {
        propertyId: "property-a",
        roomId: "room-a",
        salesMode: "roomLevel",
        expectedVersion: 5,
      },
      () => "operation-2",
    );
    const changedRoom = resolveSalesModeMutationAttempt(
      changedMode,
      {
        propertyId: "property-a",
        roomId: "room-b",
        salesMode: "roomLevel",
        expectedVersion: 1,
      },
      () => "operation-3",
    );

    expect(changedMode.operationId).toBe("operation-2");
    expect(changedMode.expectedVersion).toBe(5);
    expect(changedRoom.operationId).toBe("operation-3");
  });
});
