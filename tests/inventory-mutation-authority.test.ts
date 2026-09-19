import { describe, expect, it } from "vitest";
import type { InventoryBlockTarget, RoomInventory, RoomInventoryChangeImpact } from "../src/api/types";
import { buildBlockTargetOptions, type ActiveBlockGroup } from "../src/features/inventory/inventoryBlocking";
import {
  activeBlockGroupIsCurrent,
  blockTargetIsCurrent,
  inventoryMutationAllowed,
  roomImpactMatches,
  roomInventoryRecordIsCurrent,
} from "../src/features/inventory/inventoryMutationAuthority";

describe("inventory mutation authority", () => {
  const room = inventoryRoom();

  it("requires every source that owns the decision to be current", () => {
    const base = {
      permissionsCurrent: true,
      propertyCurrent: true,
      inventoryCurrent: true,
      blocksCurrent: true,
      impactCurrent: true,
      targetCurrent: true,
    };

    expect(inventoryMutationAllowed("change-sales-mode", base)).toBe(true);
    expect(inventoryMutationAllowed("create-block", base)).toBe(true);
    expect(inventoryMutationAllowed("release-block", { ...base, blocksCurrent: false })).toBe(false);
    expect(inventoryMutationAllowed("change-sales-mode", { ...base, inventoryCurrent: false })).toBe(false);
  });

  it("rejects stale room and mismatched impact snapshots", () => {
    expect(roomInventoryRecordIsCurrent([room], room)).toBe(true);
    expect(roomInventoryRecordIsCurrent([{ ...room, version: 3 }], room)).toBe(false);

    const impact = {
      propertyId: room.propertyId,
      roomId: room.roomId,
    } as RoomInventoryChangeImpact;
    expect(roomImpactMatches(impact, room)).toBe(true);
    expect(roomImpactMatches({ ...impact, roomId: "another-room" }, room)).toBe(false);
  });

  it("accepts only targets and active groups present in current inventory evidence", () => {
    const options = buildBlockTargetOptions("Hostel", [room]);
    const currentTarget = options.find((option) => option.kind === "room")!.target;
    const retiredTarget: InventoryBlockTarget = { ...currentTarget, roomId: "retired-room" };
    const groups = [{
      blockGroupId: "group-a",
      label: "Room 101",
      detail: "1 sellable unit",
      arrival: "2026-08-27",
      departure: "2026-08-29",
      reason: "Maintenance",
      blocks: [{ status: "active" }],
    }] as ActiveBlockGroup[];

    expect(blockTargetIsCurrent(options, currentTarget)).toBe(true);
    expect(blockTargetIsCurrent(options, retiredTarget)).toBe(false);
    expect(activeBlockGroupIsCurrent(groups, "group-a")).toBe(true);
    expect(activeBlockGroupIsCurrent(groups, "group-b")).toBe(false);
  });
});

function inventoryRoom(): RoomInventory {
  return {
    propertyId: "property-a",
    roomId: "room-a",
    roomName: "101",
    buildingLabel: "Main",
    floorLabel: "1",
    salesMode: "bedLevel",
    version: 2,
    units: [{
      inventoryUnitId: "unit-a",
      propertyId: "property-a",
      roomId: "room-a",
      bedId: "bed-a",
      kind: "bed",
      label: "1",
      isSellable: true,
      isTopologyActive: true,
    }],
  };
}
