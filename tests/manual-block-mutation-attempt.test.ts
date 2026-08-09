import { describe, expect, it } from "vitest";
import type { InventoryBlockTarget } from "../src/api/types";
import {
  resolveManualBlockCreateAttempt,
  resolveManualBlockGroupReleaseAttempt,
} from "../src/features/inventory/manualBlockMutationAttempt";

const roomTarget: InventoryBlockTarget = {
  kind: 4,
  buildingLabel: null,
  floorLabel: null,
  roomId: "ROOM-A",
  inventoryUnitId: null,
};

describe("manual block mutation attempts", () => {
  it("keeps one create operation id for a normalized exact retry", () => {
    const first = resolveManualBlockCreateAttempt(
      null,
      {
        propertyId: "PROPERTY-A",
        target: roomTarget,
        arrival: "2026-08-10",
        departure: "2026-08-12",
        reason: "  Deep clean  ",
      },
      () => "operation-1",
    );
    const retry = resolveManualBlockCreateAttempt(
      first,
      {
        propertyId: "property-a",
        target: { ...roomTarget, roomId: "room-a", buildingLabel: "ignored" },
        arrival: "2026-08-10",
        departure: "2026-08-12",
        reason: "Deep clean",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("rotates create identity when the intended mutation changes", () => {
    const first = resolveManualBlockCreateAttempt(
      null,
      {
        propertyId: "property-a",
        target: roomTarget,
        arrival: "2026-08-10",
        departure: "2026-08-12",
        reason: "Deep clean",
      },
      () => "operation-1",
    );

    const changedRange = resolveManualBlockCreateAttempt(
      first,
      {
        propertyId: "property-a",
        target: roomTarget,
        arrival: "2026-08-10",
        departure: "2026-08-13",
        reason: "Deep clean",
      },
      () => "operation-2",
    );
    const changedReason = resolveManualBlockCreateAttempt(
      first,
      {
        propertyId: "property-a",
        target: roomTarget,
        arrival: "2026-08-10",
        departure: "2026-08-12",
        reason: "Private use",
      },
      () => "operation-3",
    );

    expect(changedRange.operationId).toBe("operation-2");
    expect(changedReason.operationId).toBe("operation-3");
  });

  it("reuses exact release retries and separates different groups", () => {
    const first = resolveManualBlockGroupReleaseAttempt(
      null,
      "PROPERTY-A",
      "GROUP-A",
      () => "operation-1",
    );
    const retry = resolveManualBlockGroupReleaseAttempt(
      first,
      "property-a",
      "group-a",
      () => "operation-2",
    );
    const anotherGroup = resolveManualBlockGroupReleaseAttempt(
      first,
      "property-a",
      "group-b",
      () => "operation-3",
    );

    expect(retry).toBe(first);
    expect(anotherGroup.operationId).toBe("operation-3");
  });
});
