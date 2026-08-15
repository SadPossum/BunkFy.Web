import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import type {
  CreateManualBlockGroupRequest,
  ManualBlockGroupMutationReceipt,
  ManualBlockListResponse,
  RoomInventoryListResponse,
} from "../src/api/types";
import {
  createManualBlockGroup,
  loadManualBlockGroupMemberPage,
  loadManualBlockGroupPage,
  loadAllManualInventoryBlocks,
  loadAllRoomInventory,
  releaseManualBlockGroup,
  replaceManualBlockGroup,
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

  it("passes opaque group and member cursors without caching", async () => {
    const calls: Array<{ path: string; options?: RequestInit }> = [];
    const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
      calls.push({ path, options });
      return (path.includes("/members")
        ? { blocks: [], pageSize: 25, nextCursor: null }
        : { blockGroups: [], pageSize: 25, nextCursor: null }) as T;
    };

    await loadManualBlockGroupPage(request, "property-a", 2, "opaque:group cursor", undefined, 25);
    await loadManualBlockGroupMemberPage(request, "property-a", "group-a", "opaque:member cursor", undefined, 25);

    expect(calls[0].path).toBe("/api/inventory/properties/property-a/block-groups?pageSize=25&status=2&cursor=opaque%3Agroup+cursor");
    expect(calls[1].path).toBe("/api/inventory/properties/property-a/block-groups/group-a/members?pageSize=25&cursor=opaque%3Amember+cursor");
    expect(calls.every((call) => call.options?.cache === "no-store")).toBe(true);
  });

  it("recovers an ambiguous create without sending the mutation twice", async () => {
    const calls: string[] = [];
    const receipt = blockGroupReceipt();
    const request = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (calls.length === 1) throw new TypeError("connection closed after send");
      return {
        operationId: "operation-a",
        propertyId: "property-a",
        requestedBlockGroupId: null,
        kind: 1,
        status: 1,
        receipt,
        completedAtUtc: "2026-08-13T00:00:00Z",
      } as T;
    };

    await expect(createManualBlockGroup(request, "property-a", createRequest())).resolves.toEqual(receipt);
    expect(calls).toEqual([
      "/api/inventory/properties/property-a/block-groups",
      "/api/inventory/properties/property-a/block-group-create-operations/operation-a",
    ]);
  });

  it("recovers an ambiguous replacement only from matching predecessor lineage", async () => {
    const calls: string[] = [];
    const receipt = {
      ...blockGroupReceipt(),
      blockGroupId: "group-b",
      resultBlockGroupId: "group-b",
      previousBlockGroupId: "group-a",
      releasedNowBlockCount: 2,
      createdNowBlockCount: 2,
    };
    const request = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (calls.length === 1) throw new TypeError("connection closed after send");
      return {
        operationId: "operation-a",
        propertyId: "property-a",
        requestedBlockGroupId: "group-a",
        kind: 2,
        status: 1,
        receipt,
        completedAtUtc: "2026-08-13T00:00:00Z",
      } as T;
    };

    await expect(replaceManualBlockGroup(request, "property-a", "group-a", {
      ...createRequest(),
      expectedVersion: 7,
    })).resolves.toEqual(receipt);
    expect(calls).toEqual([
      "/api/inventory/properties/property-a/block-groups/group-a",
      "/api/inventory/properties/property-a/block-groups/group-a/operations/operation-a",
    ]);
  });

  it("recovers an ambiguous release only from the requested group", async () => {
    const calls: string[] = [];
    const receipt = {
      ...blockGroupReceipt(),
      createdBlockCount: 0,
      createdNowBlockCount: 0,
      releasedBlockCount: 2,
      releasedNowBlockCount: 2,
      activeBlockCount: 0,
      status: 3 as const,
    };
    const request = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (calls.length === 1) throw new TypeError("connection closed after send");
      return {
        operationId: "operation-a",
        propertyId: "property-a",
        requestedBlockGroupId: "group-a",
        kind: 3,
        status: 1,
        receipt,
        completedAtUtc: "2026-08-13T00:00:00Z",
      } as T;
    };

    await expect(releaseManualBlockGroup(request, "property-a", "group-a", {
      operationId: "operation-a",
      expectedVersion: 7,
      confirmed: true,
    })).resolves.toEqual(receipt);
    expect(calls).toEqual([
      "/api/inventory/properties/property-a/block-groups/group-a/release",
      "/api/inventory/properties/property-a/block-groups/group-a/operations/operation-a",
    ]);
  });

  it("replays the same operation id only after recovery proves it absent", async () => {
    const calls: string[] = [];
    const request = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (calls.length === 1) throw new TypeError("network reset");
      if (calls.length === 2) throw new ApiError("not found", 404);
      return blockGroupReceipt() as T;
    };

    await expect(createManualBlockGroup(request, "property-a", createRequest())).resolves.toEqual(blockGroupReceipt());
    expect(calls.filter((path) => path.endsWith("/block-groups"))).toHaveLength(2);
  });

  it("rejects a mismatched recovery record instead of trusting the wrong action", async () => {
    let call = 0;
    const request = async <T>(): Promise<T> => {
      call += 1;
      if (call === 1) throw new TypeError("network reset");
      return {
        operationId: "operation-a",
        propertyId: "property-a",
        requestedBlockGroupId: null,
        kind: 3,
        status: 1,
        receipt: blockGroupReceipt(),
        completedAtUtc: "2026-08-13T00:00:00Z",
      } as T;
    };

    await expect(createManualBlockGroup(request, "property-a", createRequest())).rejects.toThrow(/requested action/i);
  });

  it("rejects a recovery record from another property", async () => {
    let call = 0;
    const request = async <T>(): Promise<T> => {
      call += 1;
      if (call === 1) throw new TypeError("network reset");
      return {
        operationId: "operation-a",
        propertyId: "property-b",
        requestedBlockGroupId: null,
        kind: 1,
        status: 1,
        receipt: { ...blockGroupReceipt(), propertyId: "property-b" },
        completedAtUtc: "2026-08-13T00:00:00Z",
      } as T;
    };

    await expect(createManualBlockGroup(request, "property-a", createRequest())).rejects.toThrow(/property and block group/i);
  });

  it("respects rate limiting after recovery proves no completed operation", async () => {
    const calls: string[] = [];
    const rateLimit = new ApiError("Try later", 429, undefined, 5_000);
    const request = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (calls.length === 1) throw rateLimit;
      throw new ApiError("not found", 404);
    };

    await expect(createManualBlockGroup(request, "property-a", createRequest())).rejects.toBe(rateLimit);
    expect(calls).toHaveLength(2);
  });

  it("does not run recovery for a deterministic client rejection", async () => {
    let calls = 0;
    const rejection = new ApiError("bad request", 400, "Inventory.BlockReasonInvalid");
    const request = async <T>(): Promise<T> => {
      calls += 1;
      throw rejection;
    };

    await expect(createManualBlockGroup(request, "property-a", createRequest())).rejects.toBe(rejection);
    expect(calls).toBe(1);
  });
});

function createRequest(): CreateManualBlockGroupRequest {
  return {
    operationId: "operation-a",
    target: { kind: 4, buildingLabel: null, floorLabel: null, roomId: "room-a", inventoryUnitId: null },
    arrival: "2026-08-20",
    departure: "2026-08-22",
    reason: "Deep clean",
    expectedSelectionDigest: "selection-v2",
    expectedAffectedBlockCount: 2,
    confirmed: true,
  };
}

function blockGroupReceipt(): ManualBlockGroupMutationReceipt {
  return {
    blockGroupId: "group-a",
    propertyId: "property-a",
    affectedBlockCount: 2,
    status: 1,
    version: 1,
    previousBlockGroupId: null,
    releasedBlockCount: null,
    createdBlockCount: 2,
    totalBlockCount: 2,
    activeBlockCount: 2,
    alreadyReleasedBlockCount: 0,
    membershipDigest: "membership-v1",
    resultBlockGroupId: "group-a",
    releasedNowBlockCount: null,
    createdNowBlockCount: 2,
  };
}

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
