import type {
  ManualBlockListResponse,
  RoomInventory,
  RoomInventoryListResponse,
} from "../../api/types";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;

export async function loadAllRoomInventory(
  request: ApiRequest,
  propertyId: string,
  signal?: AbortSignal,
): Promise<RoomInventoryListResponse> {
  const rooms: RoomInventory[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<RoomInventoryListResponse>(
      `/api/inventory/properties/${propertyId}/rooms?page=${page}&pageSize=${PAGE_SIZE}`,
      { signal },
    );
    rooms.push(...response.rooms);
    if (!response.hasMore) break;
  }

  return { rooms, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}

export async function loadAllManualInventoryBlocks(
  request: ApiRequest,
  propertyId: string,
  includeReleased: boolean,
  signal?: AbortSignal,
): Promise<ManualBlockListResponse> {
  const blocks: ManualBlockListResponse["blocks"] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<ManualBlockListResponse>(
      `/api/inventory/properties/${propertyId}/blocks?includeReleased=${includeReleased}&page=${page}&pageSize=${PAGE_SIZE}`,
      { signal },
    );
    blocks.push(...response.blocks);
    if (!response.hasMore) break;
  }

  return { blocks, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}
