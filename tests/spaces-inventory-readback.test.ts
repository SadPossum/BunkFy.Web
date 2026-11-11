import { describe, expect, it } from "vitest";
import type { Bed, Room, RoomInventory } from "../src/api/types";
import { inventoryTopologyNeedsRefresh } from "../src/features/spaces/useSpacesInventoryReadback";

const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const room: Room = { propertyId: id(1), roomId: id(2), name: "Courtyard dorm", buildingLabel: null, floorLabel: "2", status: "active", version: 8 };
const bed: Bed = { propertyId: room.propertyId, roomId: room.roomId, bedId: id(3), label: "Window", status: "active", version: 3, roomVersion: 8 };
const inventory: RoomInventory = { propertyId: room.propertyId, roomId: room.roomId, roomName: room.name, buildingLabel: "", floorLabel: room.floorLabel,
  salesMode: "unconfigured", version: 2, units: [
    { propertyId: room.propertyId, roomId: room.roomId, bedId: null, inventoryUnitId: id(4), kind: "room", label: room.name, isSellable: false, isTopologyActive: true },
    { propertyId: room.propertyId, roomId: room.roomId, bedId: bed.bedId, inventoryUnitId: id(5), kind: "bed", label: bed.label, isSellable: false, isTopologyActive: true },
  ] };
const missing = (value: RoomInventory[], physical = room, beds = [bed]) => inventoryTopologyNeedsRefresh(room.propertyId, physical, beds, value);

describe("physical and Inventory counterpart evidence", () => {
  it("accepts matching copied facts with independent revision counters and unsellable units", () => {
    expect(missing([inventory])).toBe(false);
    expect(inventory.version).not.toBe(room.version);
  });
  it("does not let another room stand in for the requested one", () => {
    expect(missing([{ ...inventory, roomId: id(99) }])).toBe(true);
  });
  it("does not infer bed identity from an equal unit count", () => {
    const substituted = { ...inventory, units: inventory.units.map(unit => unit.bedId ? { ...unit, bedId: id(99) } : unit) };
    expect(substituted.units.length).toBe(inventory.units.length);
    expect(missing([substituted])).toBe(true);
  });
  it("rejects matching child IDs carried under another property or room", () => {
    for (const patch of [{ propertyId: id(99) }, { roomId: id(99) }]) {
      expect(missing([{ ...inventory, units: inventory.units.map(unit => unit.bedId ? { ...unit, ...patch } : unit) }])).toBe(true);
    }
  });
  it("waits for renamed facts even when the same IDs are already present", () => {
    expect(missing([inventory], { ...room, name: "Renamed courtyard dorm", version: 9 })).toBe(true);
    expect(missing([inventory], room, [{ ...bed, label: "Door", version: 4 }])).toBe(true);
  });
  it("does not treat retired physical records as pending creations", () => {
    expect(missing([], { ...room, status: "retired" })).toBe(false);
    expect(missing([{ ...inventory, units: [inventory.units[0]] }], room, [{ ...bed, status: "retired" }])).toBe(false);
  });
});
