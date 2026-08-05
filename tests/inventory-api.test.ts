import { describe, expect, it } from "vitest";
import type { ManualBlockListResponse, RoomInventoryListResponse } from "../src/api/types";
import {
  loadAllManualInventoryBlocks,
  loadAllRoomInventory,
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
