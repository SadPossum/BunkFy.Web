import type {
  Bed,
  BedListResponse,
  Property,
  PropertyListResponse,
  PropertyProcessingState,
  PropertyTimeZoneCatalogItem,
  PropertyTimeZoneCatalogPage,
  Room,
  RoomListResponse,
} from "../../api/types";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;

export function loadPropertyProcessingState(
  request: ApiRequest,
  propertyId: string,
  signal?: AbortSignal,
): Promise<PropertyProcessingState> {
  return request<PropertyProcessingState>(
    `/api/properties/${propertyId}/processing`,
    { signal },
  );
}

export function propertyProcessingStateMatchesProperty(
  state: PropertyProcessingState | undefined,
  propertyId: string,
): boolean {
  return !state || state.propertyId === propertyId;
}

export function roomListMatchesProperty(
  rooms: Room[],
  propertyId: string,
): boolean {
  return rooms.every((room) => room.propertyId === propertyId);
}

export function bedListMatchesContext(
  beds: Bed[],
  propertyId: string,
  roomId: string,
): boolean {
  return beds.every((bed) => (
    bed.propertyId === propertyId
    && bed.roomId === roomId
  ));
}

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

export async function loadAllPropertyTimeZones(
  request: ApiRequest,
  propertyId?: string | null,
  signal?: AbortSignal,
): Promise<PropertyTimeZoneCatalogPage> {
  const timeZones: PropertyTimeZoneCatalogItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let catalogVersion: string | null = null;
  let observedAtUtc = "";

  for (;;) {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const basePath = propertyId
      ? `/api/properties/${propertyId}/time-zones/catalog`
      : "/api/properties/time-zones/catalog";
    const response = await request<PropertyTimeZoneCatalogPage>(
      `${basePath}?${query}`,
      { signal },
    );
    catalogVersion ??= response.catalogVersion;
    observedAtUtc ||= response.observedAtUtc;
    timeZones.push(...response.timeZones);

    if (!response.hasMore) break;
    const nextCursor = response.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("The time-zone catalogue returned an invalid continuation.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    catalogVersion,
    observedAtUtc,
    timeZones,
    nextCursor: null,
    hasMore: false,
  };
}
