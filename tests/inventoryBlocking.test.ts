import { describe, expect, it } from "vitest";
import type { ManualBlock, RoomInventory } from "../src/api/types";
import { buildBlockTargetOptions, groupActiveBlocks } from "../src/features/inventory/inventoryBlocking";

describe("inventory blocking", () => {
  const rooms: RoomInventory[] = [
    room("room-101", "101", "Main", "1", "bed-101-a", "A"),
    room("room-102", "102", "Main", "1", "bed-102-a", "A"),
    room("room-201", "201", "Annex", "1", "bed-201-a", "A"),
  ];

  it("builds property, building, floor, room, and unit targets from sellable topology", () => {
    const options = buildBlockTargetOptions("Test Hostel", rooms);

    expect(options.filter((option) => option.kind === "property")).toHaveLength(1);
    expect(options.filter((option) => option.kind === "building")).toHaveLength(2);
    expect(options.filter((option) => option.kind === "floor")).toHaveLength(2);
    expect(options.filter((option) => option.kind === "room")).toHaveLength(3);
    expect(options.filter((option) => option.kind === "unit")).toHaveLength(3);

    const mainFloor = options.find((option) => option.id === "floor:main:1");
    expect(mainFloor?.unitIds).toEqual(["bed-101-a", "bed-102-a"]);
    expect(mainFloor?.target).toMatchObject({ kind: 3, buildingLabel: "Main", floorLabel: "1" });
  });

  it("collapses blocks from one operator action into a physical-scope row", () => {
    const options = buildBlockTargetOptions("Test Hostel", rooms);
    const blocks = [
      block("block-a", "group-floor", "bed-101-a"),
      block("block-b", "group-floor", "bed-102-a"),
    ];

    const grouped = groupActiveBlocks(blocks, options);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      blockGroupId: "group-floor",
      label: "Floor 1",
      reason: "Maintenance",
    });
    expect(grouped[0]?.blocks).toHaveLength(2);
  });
});

function room(
  roomId: string,
  roomName: string,
  buildingLabel: string,
  floorLabel: string,
  inventoryUnitId: string,
  label: string,
): RoomInventory {
  return {
    propertyId: "property-1",
    roomId,
    roomName,
    buildingLabel,
    floorLabel,
    salesMode: 3,
    version: 1,
    units: [{
      inventoryUnitId,
      propertyId: "property-1",
      roomId,
      bedId: inventoryUnitId,
      kind: 2,
      label,
      isSellable: true,
      isTopologyActive: true,
    }],
  };
}

function block(blockId: string, blockGroupId: string, inventoryUnitId: string): ManualBlock {
  return {
    blockId,
    blockGroupId,
    propertyId: "property-1",
    inventoryUnitId,
    arrival: "2026-08-01",
    departure: "2026-08-03",
    reason: "Maintenance",
    status: 1,
    version: 1,
    createdAtUtc: "2026-07-14T08:00:00Z",
    releasedAtUtc: null,
  };
}
