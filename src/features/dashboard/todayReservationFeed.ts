import type { ReservationListItem, ReservationListResponse } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;
export type TodayReservationFeed = {
  propertyId: string;
  localDate: string;
  reservations: ReservationListItem[];
  conflictingIds: string[];
};

export class TodayReservationFeedError extends Error {
  constructor() {
    super("Today reservation details could not be confirmed completely. Retry to reload both sources.");
    this.name = "TodayReservationFeedError";
  }
}

const pageSize = 100;
const maximumPages = 100; // Exceeding this is an explicit failure, never a truncated success.
const statuses = [1, 2, 3, 4, 6, 7, 9];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shiftTodayDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertItem(item: ReservationListItem, propertyId: string) {
  if (!item || item.propertyId !== propertyId || !uuid.test(item.reservationId)
    || !realDate(item.arrival) || !realDate(item.departure) || item.arrival >= item.departure
    || typeof item.primaryGuestName !== "string" || typeof item.holdsInventory !== "boolean"
    || !Array.isArray(item.inventoryUnitIds) || !item.inventoryUnitIds.every(id => typeof id === "string" && uuid.test(id))
    || new Set(item.inventoryUnitIds).size !== item.inventoryUnitIds.length
    || !Number.isSafeInteger(item.inventoryUnitCount) || item.inventoryUnitCount < 0
    || item.inventoryUnitCount !== item.inventoryUnitIds.length
    || !Number.isSafeInteger(item.guestCount) || item.guestCount < 1
    || ![1, 2, "direct", "external"].includes(item.sourceKind)
    || !["pendingAllocation", "confirmed", "allocationRejected", "cancellationPending", "checkedIn", "noShowPending", "checkoutPending"].includes(reservationStatusKey(item.status))
    || ![item.expectedArrivalTime, item.expectedDepartureTime].every(value => value === null || (typeof value === "string" && /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)))) throw new TodayReservationFeedError();
}

function signature(item: ReservationListItem) {
  return JSON.stringify([item.propertyId, item.arrival, item.departure, item.expectedArrivalTime,
    item.expectedDepartureTime, item.primaryGuestName, item.guestCount, item.inventoryUnitCount,
    [...item.inventoryUnitIds].sort(), item.holdsInventory, item.sourceKind, reservationStatusKey(item.status)]);
}

export function combineTodayReservations(propertyId: string, localDate: string, window: ReservationListItem[], attention: ReservationListItem[]): TodayReservationFeed {
  const records = new Map<string, ReservationListItem>();
  const conflicts = new Set<string>();
  for (const item of [...window, ...attention]) {
    assertItem(item, propertyId);
    const previous = records.get(item.reservationId);
    if (previous && signature(previous) !== signature(item)) conflicts.add(item.reservationId);
    else if (!previous) records.set(item.reservationId, item);
  }
  // There is no list-item version. Do not invent which conflicting observation won.
  for (const id of conflicts) records.delete(id);
  return { propertyId, localDate, reservations: [...records.values()], conflictingIds: [...conflicts].sort() };
}

export async function loadTodayReservationFeed(request: Request, propertyId: string, localDate: string, signal?: AbortSignal): Promise<TodayReservationFeed> {
  if (!uuid.test(propertyId) || !realDate(localDate)) throw new TodayReservationFeedError();
  const window = new URLSearchParams({ overlapsFrom: shiftTodayDate(localDate, -1), overlapsTo: shiftTodayDate(localDate, 1) });
  statuses.forEach(status => window.append("status", String(status)));
  const attention = new URLSearchParams({ view: "3", operatingDate: localDate });
  // One query publishes only the complete pair; no partial page is cached as a complete shift.
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const [windowItems, attentionItems] = await Promise.all([pages(window), pages(attention)]);
    controller.signal.throwIfAborted();
    return combineTodayReservations(propertyId, localDate, windowItems, attentionItems);
  } catch (error) {
    controller.abort(); // Stop the sibling stream, including the next pagination step.
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  async function pages(parameters: URLSearchParams) {
    const items: ReservationListItem[] = [], seen = new Set<string>();
    for (let page = 1; page <= maximumPages; page += 1) {
      controller.signal.throwIfAborted();
      const params = new URLSearchParams(parameters);
      params.set("order", "1"); params.set("page", String(page)); params.set("pageSize", String(pageSize));
      const response = await request<ReservationListResponse>(`/api/reservations/properties/${propertyId}?${params}`, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!response || !Array.isArray(response.reservations) || response.page !== page
        || response.pageSize !== pageSize || typeof response.hasMore !== "boolean"
        || response.reservations.length > pageSize || (response.hasMore && response.reservations.length !== pageSize)) throw new TodayReservationFeedError();
      for (const item of response.reservations) {
        assertItem(item, propertyId);
        if (seen.has(item.reservationId)) throw new TodayReservationFeedError(); // Offset pages drifted; retry, not quiet deduplication.
        seen.add(item.reservationId); items.push(item);
      }
      if (!response.hasMore) return items;
    }
    throw new TodayReservationFeedError();
  }
}
