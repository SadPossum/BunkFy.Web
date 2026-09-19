import { describe, expect, it } from "vitest";
import type { ManualBlock, RoomInventory } from "../src/api/types";
import {
  buildSpacesBlockGroups,
  resolveSpacesBlockTarget,
} from "../src/features/spaces/spacesBlocks";

describe("Spaces block model", () => {
  const rooms: RoomInventory[] = [{
    propertyId: "property-a",
    roomId: "room-a",
    roomName: "Garden Dorm",
    buildingLabel: "Main House",
    floorLabel: "First floor",
    salesMode: "bedLevel",
    version: 1,
    units: [unit("unit-a", "A"), unit("unit-b", "B")],
  }];

  it("derives group status from every child and preserves exact interval and reason", () => {
    const { groups } = buildSpacesBlockGroups("Canal Hostel", "property-a", rooms, [
      block("block-a", "group-a", "unit-a", "active"),
      block("block-b", "group-a", "unit-b", "released"),
    ], true);

    expect(groups[0]).toMatchObject({
      blockGroupId: "group-a",
      label: "Garden Dorm",
      targetResolved: true,
      status: "mixed",
      blockCount: 2,
      intervals: [{ arrival: "2026-09-02", departure: "2026-09-04" }],
      reasons: ["Plumbing repair"],
    });
  });

  it("calls a target unresolved when current topology cannot prove it", () => {
    const { groups } = buildSpacesBlockGroups("Canal Hostel", "property-a", rooms, [
      block("block-x", "group-x", "unit-x", "active"),
    ], true);
    expect(groups[0]).toMatchObject({ targetResolved: false, status: "active" });
    expect(groups[0]?.label).toContain("unresolved");
  });

  it("keeps an absent exact group unconfirmed until the source is current", () => {
    expect(resolveSpacesBlockTarget([], "group-x", false)).toBe("unconfirmed");
    expect(resolveSpacesBlockTarget([], "group-x", true)).toBe("unavailable");
  });

  it("does not accept a block group paired with a different unit", () => {
    const { groups } = buildSpacesBlockGroups("Canal Hostel", "property-a", rooms, [
      block("block-a", "group-a", "unit-a", "active"),
    ], true);
    expect(resolveSpacesBlockTarget(groups, "group-a", true, "unit-b")).toBe("unavailable");
  });

  it("labels last-loaded topology as unconfirmed rather than unresolved", () => {
    const { groups } = buildSpacesBlockGroups("Canal Hostel", "property-a", rooms, [
      block("block-a", "group-a", "unit-a", "active"),
    ], false);
    expect(groups[0]).toMatchObject({
      label: "A",
      targetEvidence: "unconfirmed",
      targetResolved: false,
    });
  });

  it("rejects cross-property block evidence without exposing it", () => {
    const foreign = block("block-a", "group-a", "unit-a", "active");
    foreign.propertyId = "property-other";
    expect(buildSpacesBlockGroups(
      "Canal Hostel",
      "property-a",
      rooms,
      [foreign],
      true,
    )).toEqual({ groups: [], contextMismatch: true });
  });
});

function unit(inventoryUnitId: string, label: string) {
  return {
    inventoryUnitId,
    propertyId: "property-a",
    roomId: "room-a",
    bedId: inventoryUnitId,
    kind: "bed" as const,
    label,
    isSellable: true,
    isTopologyActive: true,
  };
}

function block(
  blockId: string,
  blockGroupId: string,
  inventoryUnitId: string,
  status: "active" | "released",
): ManualBlock {
  return {
    blockId,
    blockGroupId,
    propertyId: "property-a",
    inventoryUnitId,
    arrival: "2026-09-02",
    departure: "2026-09-04",
    reason: "Plumbing repair",
    status,
    version: 1,
    createdAtUtc: "2026-09-01T10:00:00Z",
    releasedAtUtc: status === "released" ? "2026-09-01T12:00:00Z" : null,
  };
}
