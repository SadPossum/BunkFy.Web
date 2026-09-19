import type { InventoryAvailabilityResponse, Reservation, RoomInventory } from "../../api/types";
import { reservationStatusKey } from "../../app/liveUpdates";
import { propertyDateKey, shiftDateKey } from "../../app/propertyDate";
import { calendarBookingRangeValid, reservationAvailabilityMatchesRange, reservationRoomsMatchProperty, reservationSelectionMatchesRooms } from "../calendar/calendarBookingRoute";
import { operationalOriginHref, parseOperationalReturnRoute, withOperationalReturnRoute, type OperationalPreviewRoute } from "../operational-preview/operationalPreviewRoute";
import { inventorySelectionIsCurrent } from "./reservationsMutationAuthority";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CompletedReservationCreateContext = { propertyId: string; reservationId: string; returnRoute: OperationalPreviewRoute };
export type CompletedReservationCreateSeed = { primaryGuestName: string; email: string; phone: string; guestCount: number; inventoryUnitIds: string[] };

export function hasCompletedReservationCreateContext(params: URLSearchParams): boolean {
  return [...params.keys()].some(key => key.startsWith("extendFrom"));
}

export function parseCompletedReservationCreateContext(params: URLSearchParams): CompletedReservationCreateContext | null {
  if ([...params.keys()].some(key => !["new", "property", "extendFrom"].includes(key) && !key.startsWith("opReturn"))
    || ["new", "property", "extendFrom"].some(key => params.getAll(key).length !== 1)
    || params.get("new") !== "1") return null;
  const propertyId = params.get("property")!, reservationId = params.get("extendFrom")!;
  const returnRoute = parseOperationalReturnRoute(params);
  if (!uuid.test(propertyId) || !uuid.test(reservationId) || !returnRoute
    || returnRoute.selection.kind !== "reservation" || returnRoute.selection.propertyId !== propertyId
    || returnRoute.origin.propertyId !== propertyId || returnRoute.selection.reservationId !== reservationId) return null;
  return { propertyId, reservationId, returnRoute };
}

export function completedReservationCreateHref(route: OperationalPreviewRoute): string | null {
  if (route.selection.kind !== "reservation") return null;
  const params = withOperationalReturnRoute(new URLSearchParams({ new: "1", property: route.selection.propertyId, extendFrom: route.selection.reservationId }), route);
  return parseCompletedReservationCreateContext(params) ? `/reservations?${params}` : null;
}

export function completedReservationReturnHref(context: CompletedReservationCreateContext): string {
  return operationalOriginHref(context.returnRoute);
}

export function completedReservationSeed(record: Reservation | undefined, propertyId: string, reservationId: string): CompletedReservationCreateSeed | null {
  // The DTO has no privacy flag; reject the backend's explicit anonymisation sentinel.
  // Never infer a Guest Record from a name/contact match or from the source's guest links.
  if (!record || record.propertyId !== propertyId || record.reservationId !== reservationId
    || reservationStatusKey(record.status) !== "checkedOut" || record.holdsInventory !== false
    || typeof record.primaryGuestName !== "string" || !record.primaryGuestName.trim()
    || record.primaryGuestName.trim().toLowerCase() === "anonymised guest"
    || !Number.isInteger(record.guestCount) || record.guestCount < 1) return null;
  return { primaryGuestName: record.primaryGuestName, email: record.email ?? "", phone: record.phone ?? "", guestCount: record.guestCount,
    inventoryUnitIds: Array.isArray(record.inventoryUnitIds) ? [...record.inventoryUnitIds] : [] };
}

export function completedReservationStayRange(timeZoneId: string, instant = new Date()): { arrival: string; departure: string } | null {
  const arrival = propertyDateKey(timeZoneId, instant);
  if (!arrival) return null;
  const departure = shiftDateKey(arrival, 1);
  return calendarBookingRangeValid(arrival, departure) ? { arrival, departure } : null;
}

export function completedReservationPreselection(ids: string[], propertyId: string, arrival: string, departure: string,
  rooms: RoomInventory[] | undefined, availability: InventoryAvailabilityResponse | undefined, current: boolean): string[] {
  if (!current || !ids.length || new Set(ids).size !== ids.length
    || !reservationAvailabilityMatchesRange(availability, propertyId, arrival, departure)
    || !reservationRoomsMatchProperty(rooms, propertyId)
    || !inventorySelectionIsCurrent(propertyId, availability!.units, ids)
    || !reservationSelectionMatchesRooms(ids, rooms!, availability)) return [];
  return [...ids];
}
