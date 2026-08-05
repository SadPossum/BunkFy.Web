import type {
  AdapterConnectionListItem,
  AdapterConnectionListResponse,
} from "../../api/types";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;

export async function loadAllAdapterConnections(
  request: ApiRequest,
  propertyId: string,
  signal?: AbortSignal,
): Promise<AdapterConnectionListResponse> {
  const connections: AdapterConnectionListItem[] = [];
  for (let page = 1; ; page += 1) {
    const response = await request<AdapterConnectionListResponse>(
      `/api/ingestion/properties/${propertyId}/connections?page=${page}&pageSize=${PAGE_SIZE}`,
      { signal },
    );
    connections.push(...response.connections);
    if (!response.hasMore) break;
  }

  return { connections, page: 1, pageSize: PAGE_SIZE, hasMore: false };
}
