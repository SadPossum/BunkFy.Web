import { describe, expect, it } from "vitest";
import { resolveBedMutationAttempt } from "../src/features/properties/bedMutationAttempt";

describe("bed mutation attempts", () => {
  it("keeps the operation and original room version for a normalized retry", () => {
    const first = resolveBedMutationAttempt(
      null,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedRoomVersion: 4,
        labels: [" 1 ", " 2 "],
      },
      () => "operation-a",
    );

    const retry = resolveBedMutationAttempt(
      first,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedRoomVersion: 6,
        labels: ["1", "2"],
      },
      () => "operation-b",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-a");
    expect(retry.expectedRoomVersion).toBe(4);
  });

  it("starts a new operation when the ordered labels change", () => {
    const first = resolveBedMutationAttempt(
      null,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedRoomVersion: 4,
        labels: ["1", "2"],
      },
      () => "operation-a",
    );

    const reordered = resolveBedMutationAttempt(
      first,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedRoomVersion: 4,
        labels: ["2", "1"],
      },
      () => "operation-b",
    );

    expect(reordered.operationId).toBe("operation-b");
  });

  it("isolates batch additions from bed updates and their targets", () => {
    const batch = resolveBedMutationAttempt(
      null,
      {
        propertyId: "property-a",
        roomId: "room-a",
        expectedRoomVersion: 4,
        labels: ["1"],
      },
      () => "operation-a",
    );
    const update = resolveBedMutationAttempt(
      batch,
      {
        propertyId: "property-a",
        roomId: "room-a",
        bedId: "bed-a",
        expectedRoomVersion: 4,
        labels: ["1"],
      },
      () => "operation-b",
    );
    const otherBed = resolveBedMutationAttempt(
      update,
      {
        propertyId: "property-a",
        roomId: "room-a",
        bedId: "bed-b",
        expectedRoomVersion: 4,
        labels: ["1"],
      },
      () => "operation-c",
    );

    expect(update.operationId).toBe("operation-b");
    expect(otherBed.operationId).toBe("operation-c");
  });
});
