import { describe, expect, it } from "vitest";
import type { ManualBlockListResponse, RoomInventoryListResponse } from "../src/api/types";
import {
  inventoryAvailabilityMatchesContext,
  loadAllManualInventoryBlocks,
  loadAllRoomInventory,
  loadInventoryAvailability,
  manualBlockListMatchesProperty,
  roomInventoryMatchesProperty,
} from "../src/features/inventory/inventoryApi";

describe("inventory API pagination", () => {
  it("loads room pages only while the server reports more", async () => {
    const paths: string[] = [];
    const responses = [
      { rooms: [room("A")], page: 1, pageSize: 100, hasMore: true },
      { rooms: [room("B")], page: 2, pageSize: 100, hasMore: false },
    ] satisfies RoomInventoryListResponse[];
    const request = async <T>(path: string): Promise<T> => {
      paths.push(path);
      return responses.shift() as T;
    };

    const result = await loadAllRoomInventory(request, "property-a");

    expect(result.rooms.map((item) => item.roomName)).toEqual(["A", "B"]);
    expect(paths).toHaveLength(2);
    expect(paths[1]).toContain("page=2");
  });

  it("does not probe an empty terminal block page", async () => {
    const paths: string[] = [];
    const responses = [
      { blocks: [], page: 1, pageSize: 100, hasMore: false },
    ] satisfies ManualBlockListResponse[];
    const request = async <T>(path: string): Promise<T> => {
      paths.push(path);
      return responses.shift() as T;
    };

    await loadAllManualInventoryBlocks(request, "property-a", true);

    expect(paths).toEqual([
      "/api/inventory/properties/property-a/blocks?includeReleased=true&page=1&pageSize=100",
    ]);
  });

  it("bounds block traversal to the requested schedule window", async () => {
    const paths: string[] = [];
    const request = async <T>(path: string): Promise<T> => {
      paths.push(path);
      return { blocks: [], page: 1, pageSize: 100, hasMore: false } as T;
    };

    await loadAllManualInventoryBlocks(
      request,
      "property-a",
      false,
      undefined,
      { from: "2026-08-03", to: "2026-08-10" },
    );

    expect(paths[0]).toContain("overlapsFrom=2026-08-03");
    expect(paths[0]).toContain("overlapsTo=2026-08-10");
  });

  it("loads a half-open availability range with the caller abort signal", async () => {
    const controller = new AbortController();
    let observedPath = "";
    let observedSignal: AbortSignal | null | undefined;
    await loadInventoryAvailability(async <T>(path: string, options?: RequestInit): Promise<T> => {
      observedPath = path;
      observedSignal = options?.signal;
      return { propertyId: "property-a", arrival: "2026-09-02", departure: "2026-09-04", units: [] } as T;
    }, "property-a", "2026-09-02", "2026-09-04", controller.signal);

    expect(observedPath).toBe("/api/inventory/properties/property-a/availability?arrival=2026-09-02&departure=2026-09-04");
    expect(observedSignal).toBe(controller.signal);
  });

  it("rejects property and range drift in inventory owner responses", () => {
    const rooms = [room("A")];
    expect(roomInventoryMatchesProperty(rooms, "property-a")).toBe(true);
    rooms[0]!.propertyId = "property-b";
    expect(roomInventoryMatchesProperty(rooms, "property-a")).toBe(false);

    const availability = {
      propertyId: "property-a",
      arrival: "2026-09-02",
      departure: "2026-09-04",
      units: [],
    };
    expect(inventoryAvailabilityMatchesContext(
      availability,
      "property-a",
      "2026-09-02",
      "2026-09-04",
    )).toBe(true);
    availability.departure = "2026-09-05";
    expect(inventoryAvailabilityMatchesContext(
      availability,
      "property-a",
      "2026-09-02",
      "2026-09-04",
    )).toBe(false);

    const blocks: ManualBlockListResponse["blocks"] = [{
      blockId: "block-a",
      blockGroupId: "group-a",
      propertyId: "property-b",
      inventoryUnitId: "unit-a",
      arrival: "2026-09-02",
      departure: "2026-09-04",
      reason: "Maintenance",
      status: "active",
      version: 1,
      createdAtUtc: "2026-09-01T10:00:00Z",
      releasedAtUtc: null,
    }];
    expect(manualBlockListMatchesProperty(blocks, "property-a")).toBe(false);
  });
});

function room(name: string): RoomInventoryListResponse["rooms"][number] {
  return {
    propertyId: "property-a",
    roomId: `room-${name}`,
    roomName: name,
    buildingLabel: null,
    floorLabel: null,
    salesMode: "roomLevel",
    version: 1,
    units: [],
  };
}
