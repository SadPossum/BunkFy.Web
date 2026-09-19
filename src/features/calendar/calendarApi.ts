import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { reservationStatusKey } from "../../app/liveUpdates";
import type {
  ReservationListItem,
  ReservationListResponse,
} from "../../api/types";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const PAGE_SIZE = 100;
const calendarStatuses = [1, 2, 3, 4, 6, 7, 9, 10] as const;
export const RESERVATION_INVENTORY_TRUTH_UNAVAILABLE =
  "reservation-inventory-truth-unavailable";
export const RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT = Object.freeze({
  kind: RESERVATION_INVENTORY_TRUTH_UNAVAILABLE,
});

export type ReservationCalendarQueryData =
  | ReservationListItem[]
  | typeof RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT;

export class ReservationInventoryTruthUnavailableError extends Error {
  constructor() {
    super(RESERVATION_INVENTORY_TRUTH_UNAVAILABLE);
    this.name = "ReservationInventoryTruthUnavailableError";
  }
}

export function isReservationInventoryTruthUnavailable(
  error: unknown,
): error is ReservationInventoryTruthUnavailableError {
  return error instanceof ReservationInventoryTruthUnavailableError;
}

export function isReservationInventoryTruthBlockedSnapshot(
  data: ReservationCalendarQueryData | undefined,
): data is typeof RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT {
  return data !== undefined &&
    !Array.isArray(data) &&
    data.kind === RESERVATION_INVENTORY_TRUTH_UNAVAILABLE;
}

export function resolveReservationCalendarSource(
  data: ReservationCalendarQueryData | undefined,
  error: unknown,
): { hasData: boolean; reservations: ReservationListItem[] } {
  if (
    isReservationInventoryTruthUnavailable(error) ||
    isReservationInventoryTruthBlockedSnapshot(data)
  ) {
    return { hasData: false, reservations: [] };
  }

  return {
    hasData: data !== undefined,
    reservations: data ?? [],
  };
}

export async function loadReservationCalendarQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
  request: ApiRequest,
  propertyId: string,
  overlapsFrom: string,
  overlapsTo: string,
  signal?: AbortSignal,
): Promise<ReservationListItem[]> {
  try {
    return await loadReservationCalendar(
      request,
      propertyId,
      overlapsFrom,
      overlapsTo,
      signal,
    );
  } catch (error) {
    if (!signal?.aborted && isReservationInventoryTruthUnavailable(error)) {
      queryClient.setQueryData<ReservationCalendarQueryData>(
        queryKey,
        RESERVATION_INVENTORY_TRUTH_BLOCKED_SNAPSHOT,
      );
    }
    throw error;
  }
}

export function shouldRetryReservationCalendar(
  failureCount: number,
  error: unknown,
): boolean {
  return !isReservationInventoryTruthUnavailable(error) && failureCount < 1;
}

export async function loadReservationCalendar(
  request: ApiRequest,
  propertyId: string,
  overlapsFrom: string,
  overlapsTo: string,
  signal?: AbortSignal,
): Promise<ReservationListItem[]> {
  const reservations: ReservationListItem[] = [];

  for (let page = 1; ; page += 1) {
    signal?.throwIfAborted();
    const params = new URLSearchParams({
      overlapsFrom,
      overlapsTo,
      order: "1",
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    calendarStatuses.forEach((status) => params.append("status", String(status)));

    const response = await request<ReservationListResponse>(
      `/api/reservations/properties/${propertyId}?${params}`,
      { signal },
    );
    signal?.throwIfAborted();
    assertInventoryTruth(response.reservations);
    reservations.push(...response.reservations);
    if (!response.hasMore) break;
  }

  return reservations;
}

function assertInventoryTruth(reservations: ReservationListItem[]) {
  const compatible = Array.isArray(reservations) && reservations.every((reservation) =>
    reservation !== null &&
    typeof reservation === "object" &&
    typeof (reservation as { holdsInventory?: unknown }).holdsInventory === "boolean"
    && !(reservationStatusKey(reservation.status) === "checkedOut" && reservation.holdsInventory));
  if (!compatible) {
    throw new ReservationInventoryTruthUnavailableError();
  }
}
