import { describe, expect, it } from "vitest";
import type { Bed, Room, RoomInventory } from "../src/api/types";
import {
  buildSpacesRooms,
  buildSpacesUnits,
  resolveSpacesRoomSelection,
  resolveSpacesUnitSelection,
} from "../src/features/spaces/spacesLayout";

const propertyId = "property-a";

describe("Spaces layout composition", () => {
  it("joins physical identity and Inventory sellability only by stable ids", () => {
    const result = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      inventoryRooms: [inventoryRoom("room-1", "Stale label", [
        inventoryUnit("unit-a", "room-1", "bed-a", "101-A", true),
        inventoryUnit("unit-b", "room-1", "bed-b", "101-B", false),
      ])],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    });

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0]).toMatchObject({
      roomId: "room-1",
      name: "Dorm 101",
      physicalState: "present",
      inventoryState: "present",
      salesMode: "bedLevel",
      sellableUnitCount: 1,
      totalUnitCount: 2,
    });
  });

  it("qualifies a missing optional source as unknown instead of a false zero", () => {
    const result = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      physicalEvidence: "current",
      inventoryEvidence: "restricted",
    });

    expect(result.rooms[0]).toMatchObject({
      inventoryState: "unknown",
      salesMode: null,
      sellableUnitCount: null,
      totalUnitCount: null,
    });
  });

  it("does not turn an unknown generated sales mode into a configuration claim", () => {
    const result = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      inventoryRooms: [{ ...inventoryRoom("room-1", "Dorm 101", []), salesMode: 0 }],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    });

    expect(result.rooms[0].salesMode).toBeNull();
  });

  it("does not overwrite a physical room's missing location with an Inventory copy", () => {
    const physical = {
      ...physicalRoom("room-1", "Dorm 101"),
      buildingLabel: null,
      floorLabel: null,
    };
    const result = buildSpacesRooms({
      propertyId,
      physicalRooms: [physical],
      inventoryRooms: [inventoryRoom("room-1", "Dorm 101", [])],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    });

    expect(result.rooms[0].location).toBe("Location not labelled");
  });

  it("fails malformed, cross-property, and duplicate records closed", () => {
    const result = buildSpacesRooms({
      propertyId,
      physicalRooms: [
        physicalRoom("room-duplicate", "One"),
        physicalRoom("room-duplicate", "Two"),
        { ...physicalRoom("room-cross", "Cross"), propertyId: "property-b" },
      ],
      inventoryRooms: [inventoryRoom("room-safe", "Safe", [
        { ...inventoryUnit("unit-cross", "room-safe", "bed-a", "Cross", true), propertyId: "property-b" },
        inventoryUnit("unit-duplicate", "room-safe", "bed-b", "Duplicate A", true),
        inventoryUnit("unit-duplicate", "room-safe", "bed-c", "Duplicate B", true),
      ])],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    });

    expect(result.rooms.map((room) => room.roomId)).toEqual(["room-safe"]);
    expect(result.rooms[0].inventoryUnits).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "duplicate-room",
      "cross-property-room",
      "cross-property-unit",
      "duplicate-unit",
    ]));
  });

  it("sorts active rooms by natural label and stable id", () => {
    const result = buildSpacesRooms({
      propertyId,
      physicalRooms: [
        physicalRoom("room-10", "Dorm 10"),
        physicalRoom("room-2b", "Dorm 2"),
        physicalRoom("room-2a", "Dorm 2"),
        { ...physicalRoom("retired", "Dorm 1"), status: "retired" },
      ],
      physicalEvidence: "current",
      inventoryEvidence: "restricted",
    });

    expect(result.rooms.map((room) => room.roomId)).toEqual([
      "room-2a",
      "room-2b",
      "room-10",
      "retired",
    ]);
  });

  it("never substitutes the first room for an invalid explicit target", () => {
    const rooms = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      physicalEvidence: "current",
      inventoryEvidence: "restricted",
    }).rooms;

    expect(resolveSpacesRoomSelection(rooms, "missing", null, null, {
      physical: "current",
      inventory: "restricted",
    })).toEqual({
      status: "unavailable",
      targetKind: "room",
      targetId: "missing",
    });
    expect(resolveSpacesRoomSelection(rooms, null, null, null, {
      physical: "current",
      inventory: "restricted",
    })).toEqual({
      status: "unselected",
    });
  });

  it("does not call an empty or not-yet-confirmed target absent", () => {
    const rooms = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      physicalEvidence: "stale",
      inventoryEvidence: "restricted",
    }).rooms;

    expect(resolveSpacesRoomSelection(rooms, "", null, null, {
      physical: "stale",
      inventory: "restricted",
    })).toEqual({
      status: "unconfirmed",
      targetKind: "room",
      reason: "delayed",
    });
    expect(resolveSpacesRoomSelection(rooms, "missing", null, null, {
      physical: "stale",
      inventory: "restricted",
    })).toEqual({
      status: "unconfirmed",
      targetKind: "room",
      reason: "delayed",
    });
  });

  it("can infer a room from an exact Inventory unit but rejects an unscoped bed", () => {
    const rooms = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      inventoryRooms: [inventoryRoom("room-1", "Dorm 101", [
        inventoryUnit("unit-a", "room-1", "bed-a", "101-A", true),
      ])],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    }).rooms;

    expect(resolveSpacesRoomSelection(rooms, null, null, "unit-a", {
      physical: "current",
      inventory: "current",
    })).toMatchObject({
      status: "selected",
      explicit: true,
      room: { roomId: "room-1" },
    });
    expect(resolveSpacesRoomSelection(rooms, null, "bed-a", null, {
      physical: "current",
      inventory: "current",
    })).toEqual({
      status: "unavailable",
      targetKind: "bed",
      targetId: "bed-a",
    });
  });

  it("joins selected-room beds lazily and keeps missing counterparts explicit", () => {
    const room = buildSpacesRooms({
      propertyId,
      physicalRooms: [physicalRoom("room-1", "Dorm 101")],
      inventoryRooms: [inventoryRoom("room-1", "Dorm 101", [
        inventoryUnit("unit-a", "room-1", "bed-a", "Inventory A", true),
        inventoryUnit("unit-c", "room-1", "bed-c", "Inventory C", true),
      ])],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    }).rooms[0];
    const result = buildSpacesUnits({
      propertyId,
      room,
      physicalBeds: [bed("bed-a", "room-1", "101-A"), bed("bed-b", "room-1", "101-B")],
      physicalEvidence: "current",
      inventoryEvidence: "current",
    });

    expect(result.units).toEqual([
      expect.objectContaining({ label: "101-A", physicalState: "present", inventoryState: "present" }),
      expect.objectContaining({ label: "101-B", physicalState: "present", inventoryState: "missing" }),
      expect.objectContaining({ label: "Inventory C", physicalState: "missing", inventoryState: "present" }),
    ]);
    expect(resolveSpacesUnitSelection(result.units, "bed-a", "unit-a", {
      physical: "current",
      inventory: "current",
    })).toMatchObject({
      status: "selected",
      unit: { label: "101-A" },
    });
    expect(resolveSpacesUnitSelection(result.units, "bed-a", "unit-c", {
      physical: "current",
      inventory: "current",
    })).toEqual({
      status: "unavailable",
      targetKind: "bed-and-unit",
    });
  });

  it("waits for every source needed to disprove an exact unit target", () => {
    expect(resolveSpacesUnitSelection([], "bed-a", "unit-a", {
      physical: "stale",
      inventory: "current",
    })).toEqual({
      status: "unconfirmed",
      targetKind: "bed-and-unit",
      reason: "delayed",
    });
    expect(resolveSpacesUnitSelection([], null, "unit-a", {
      physical: "current",
      inventory: "restricted",
    })).toEqual({
      status: "unconfirmed",
      targetKind: "unit",
      reason: "restricted",
    });
  });
});

function physicalRoom(roomId: string, name: string): Room {
  return {
    propertyId,
    roomId,
    name,
    buildingLabel: "Main House",
    floorLabel: "1",
    status: "active",
    version: 1,
  };
}

function inventoryRoom(
  roomId: string,
  roomName: string,
  units: RoomInventory["units"],
): RoomInventory {
  return {
    propertyId,
    roomId,
    roomName,
    buildingLabel: "Main House",
    floorLabel: "1",
    salesMode: "bedLevel",
    version: 1,
    units,
  };
}

function inventoryUnit(
  inventoryUnitId: string,
  roomId: string,
  bedId: string | null,
  label: string,
  isSellable: boolean,
): RoomInventory["units"][number] {
  return {
    propertyId,
    roomId,
    inventoryUnitId,
    bedId,
    kind: bedId ? "bed" : "room",
    label,
    isSellable,
    isTopologyActive: true,
  };
}

function bed(bedId: string, roomId: string, label: string): Bed {
  return {
    propertyId,
    roomId,
    bedId,
    label,
    status: "active",
    version: 1,
    roomVersion: 1,
  };
}
