import type {
  Bed,
  BedListResponse,
  Property,
  PropertyListResponse,
  Room,
  RoomListResponse,
} from "../../api/types";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;

export async function loadAllProperties(
  request: ApiRequest,
  signal?: AbortSignal,
): Promise<PropertyListResponse> {
  const properties: Property[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<PropertyListResponse>(
      `/api/properties?page=${page}&pageSize=${PAGE_SIZE}`,
      { signal },
    );
    properties.push(...response.properties);
    if (!response.hasMore) break;
  }

  return { properties, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}

export async function loadAllRooms(
  request: ApiRequest,
  propertyId: string,
  signal?: AbortSignal,
): Promise<RoomListResponse> {
  const rooms: Room[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<RoomListResponse>(
      `/api/properties/${propertyId}/rooms?page=${page}&pageSize=${PAGE_SIZE}`,
      { signal },
    );
    rooms.push(...response.rooms);
    if (!response.hasMore) break;
  }

  return { rooms, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}

export async function loadAllBeds(
  request: ApiRequest,
  propertyId: string,
  roomId: string,
  signal?: AbortSignal,
): Promise<BedListResponse> {
  const beds: Bed[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<BedListResponse>(
      `/api/properties/${propertyId}/rooms/${roomId}/beds?page=${page}&pageSize=${PAGE_SIZE}`,
      { signal },
    );
    beds.push(...response.beds);
    if (!response.hasMore) break;
  }

  return { beds, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}
