import { describe, expect, it } from "vitest";
import type {
  InventoryAvailabilityResponse,
  InventoryUnitAvailability,
  RoomInventory,
} from "../src/api/types";
import {
  buildSpacesAvailability,
  resolveSpacesAvailabilityTarget,
} from "../src/features/spaces/spacesAvailability";

describe("Spaces availability model", () => {
  const rooms: RoomInventory[] = [{
    propertyId: "property-a",
    roomId: "room-a",
    roomName: "Garden Dorm",
    buildingLabel: "Main House",
    floorLabel: "First floor",
    salesMode: "bedLevel",
    version: 1,
    units: [unit("unit-a", "bed-a", "Bed A")],
  }];

  it("uses stable IDs for full identity and reconciles totals to every response row", () => {
    const response = availabilityResponse([
      availability(unit("unit-a", "bed-a", "Bed A"), true),
      availability(unit("unit-missing", "bed-missing", "Do not trust this label"), false),
    ]);
    const model = buildSpacesAvailability(rooms, response, "current");

    expect(model).toMatchObject({ total: 2, reportedAvailable: 1, reportedUnavailable: 1, unresolvedTargets: 1 });
    expect(model.rows[0]).toMatchObject({
      roomLabel: "Garden Dorm",
      roomDetail: "Main House / First floor",
      unitLabel: "Bed A",
      state: "available",
      targetResolved: true,
    });
    expect(model.rows[1]).toMatchObject({
      roomLabel: "Unresolved room",
      state: "unconfirmed",
      targetResolved: false,
    });
  });

  it("never labels stale or refreshing evidence simply available", () => {
    const model = buildSpacesAvailability(
      rooms,
      availabilityResponse([availability(unit("unit-a", "bed-a", "Bed A"), true)]),
      "unconfirmed",
    );
    expect(model.rows[0]?.state).toBe("unconfirmed");
    expect(model.rows[0]?.lastReportedState).toBe("available");
  });

  it("does not substitute an unavailable exact target", () => {
    const model = buildSpacesAvailability(
      rooms,
      availabilityResponse([availability(unit("unit-a", "bed-a", "Bed A"), true)]),
      "current",
    );
    expect(resolveSpacesAvailabilityTarget(model.rows, "unit-other", false)).toBe("unconfirmed");
    expect(resolveSpacesAvailabilityTarget(model.rows, "unit-other", true)).toBe("unavailable");
    expect(resolveSpacesAvailabilityTarget(model.rows, "unit-a", true, "room-other", "bed-a")).toBe("unavailable");
  });

  it("rejects a response that does not match the requested property or range", () => {
    const response = availabilityResponse([
      availability(unit("unit-a", "bed-a", "Bed A"), true),
    ]);
    response.propertyId = "property-other";

    expect(buildSpacesAvailability(rooms, response, "current", {
      propertyId: "property-a",
      arrival: "2026-09-02",
      departure: "2026-09-04",
    })).toEqual({
      rows: [],
      total: 0,
      reportedAvailable: 0,
      reportedUnavailable: 0,
      unresolvedTargets: 0,
      contextMismatch: true,
    });
  });

  it("does not trust an inventory unit whose own property or room identity differs", () => {
    const mismatchedRooms = structuredClone(rooms);
    mismatchedRooms[0]!.units[0]!.propertyId = "property-other";
    const model = buildSpacesAvailability(
      mismatchedRooms,
      availabilityResponse([availability(unit("unit-a", "bed-a", "Bed A"), true)]),
      "current",
      { propertyId: "property-a", arrival: "2026-09-02", departure: "2026-09-04" },
    );
    expect(model.contextMismatch).toBe(true);
    expect(model.rows).toEqual([]);
  });
});

function unit(inventoryUnitId: string, bedId: string, label: string) {
  return {
    inventoryUnitId,
    propertyId: "property-a",
    roomId: "room-a",
    bedId,
    kind: "bed" as const,
    label,
    isSellable: true,
    isTopologyActive: true,
  };
}

function availability(
  inventoryUnit: ReturnType<typeof unit>,
  isAvailable: boolean,
): InventoryUnitAvailability {
  return {
    unit: inventoryUnit,
    isAvailable,
    activeBlockIds: [],
    activeAllocationIds: [],
  };
}

function availabilityResponse(units: InventoryUnitAvailability[]): InventoryAvailabilityResponse {
  return {
    propertyId: "property-a",
    arrival: "2026-09-02",
    departure: "2026-09-04",
    units,
  };
}
