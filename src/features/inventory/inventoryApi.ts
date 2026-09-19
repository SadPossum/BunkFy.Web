import type {
  InventoryAvailabilityResponse,
  ManualBlockListResponse,
  RoomInventory,
  RoomInventoryListResponse,
} from "../../api/types";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;

export async function loadInventoryAvailability(
  request: ApiRequest,
  propertyId: string,
  arrival: string,
  departure: string,
  signal?: AbortSignal,
): Promise<InventoryAvailabilityResponse> {
  const params = new URLSearchParams({ arrival, departure });
  return request<InventoryAvailabilityResponse>(
    `/api/inventory/properties/${propertyId}/availability?${params}`,
    { signal },
  );
}

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
  overlapWindow?: { from: string; to: string },
): Promise<ManualBlockListResponse> {
  const blocks: ManualBlockListResponse["blocks"] = [];
  for (let page = 1; ; page += 1) {
    const params = new URLSearchParams({
      includeReleased: String(includeReleased),
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (overlapWindow) {
      params.set("overlapsFrom", overlapWindow.from);
      params.set("overlapsTo", overlapWindow.to);
    }
    const response = await request<ManualBlockListResponse>(
      `/api/inventory/properties/${propertyId}/blocks?${params}`,
      { signal },
    );
    blocks.push(...response.blocks);
    if (!response.hasMore) break;
  }

  return { blocks, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}

export function roomInventoryMatchesProperty(
  rooms: RoomInventory[],
  propertyId: string,
): boolean {
  return rooms.every((room) => (
    room.propertyId === propertyId
    && room.units.every((unit) => (
      unit.propertyId === propertyId
      && unit.roomId === room.roomId
    ))
  ));
}

export function inventoryAvailabilityMatchesContext(
  response: InventoryAvailabilityResponse | undefined,
  propertyId: string,
  arrival: string,
  departure: string,
): boolean {
  return !response || (
    response.propertyId === propertyId
    && response.arrival === arrival
    && response.departure === departure
    && response.units.every((item) => item.unit.propertyId === propertyId)
  );
}

export function manualBlockListMatchesProperty(
  blocks: ManualBlockListResponse["blocks"],
  propertyId: string,
): boolean {
  return blocks.every((block) => block.propertyId === propertyId);
}
