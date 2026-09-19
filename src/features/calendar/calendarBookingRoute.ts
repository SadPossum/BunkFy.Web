import type { InventoryAvailabilityResponse, RoomInventory } from "../../api/types";
import { parseOperationalSurfaceReturn, operationalSurfaceOriginHref, withOperationalSurfaceReturn } from "../operational-preview/operationalSurfaceReturn";
import type { OperationalOrigin } from "../operational-preview/operationalPreviewRoute";
import { readCalendarViewport } from "./calendarWindow";

export type CalendarBookingTarget = {
  roomId: string;
  inventoryUnitId: string;
  bedId?: string;
  arrival: string;
  departure: string;
};
export type CalendarBookingContext = {
  origin: Extract<OperationalOrigin, { surface: "calendar" }>;
  target?: CalendarBookingTarget;
};
const bookingKeys = ["bookingRoom", "bookingUnit", "bookingBed", "bookingArrival", "bookingDeparture"];
const allowedKeys = new Set(["new", "reservation", "property", "bookingEntry", ...bookingKeys,
  "surfaceReturn", "surfaceReturnProperty", "surfaceReturnDate", "surfaceReturnDay", "surfaceReturnViewportDate", "surfaceReturnViewportOffset"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function calendarBookingRangeValid(arrival: string, departure: string): boolean {
  return realDate(arrival) && realDate(departure) && arrival < departure;
}

export function hasCalendarBookingContext(params: URLSearchParams): boolean {
  return [...params.keys()].some((key) => key.startsWith("booking"));
}

// Fixed destinations only. Route coordinates are untrusted; labels and availability come from current property-scoped reads.
export function parseCalendarBookingContext(params: URLSearchParams): CalendarBookingContext | null {
  if (params.get("bookingEntry") !== "calendar" || [...params.keys()].some((key) => !allowedKeys.has(key) || params.getAll(key).length !== 1)
    || (params.has("new") && params.get("new") !== "1")
    || (params.has("reservation") && (!uuid.test(params.get("reservation")!) || params.has("new")))) return null;
  const origin = parseOperationalSurfaceReturn(params);
  if (origin?.surface !== "calendar") return null;
  if (!bookingKeys.some((key) => params.has(key))) return { origin };
  const roomId = params.get("bookingRoom") ?? "";
  const inventoryUnitId = params.get("bookingUnit") ?? "";
  const bedId = params.get("bookingBed") ?? undefined;
  const arrival = params.get("bookingArrival") ?? "";
  const departure = params.get("bookingDeparture") ?? "";
  if (!uuid.test(roomId) || !uuid.test(inventoryUnitId) || (bedId !== undefined && !uuid.test(bedId))
    || !calendarBookingRangeValid(arrival, departure) || arrival !== origin.day) return null;
  return { origin, target: { roomId, inventoryUnitId, ...(bedId ? { bedId } : {}), arrival, departure } };
}

export function calendarBookingHref(context: CalendarBookingContext): string {
  const params = withOperationalSurfaceReturn(new URLSearchParams({ new: "1", property: context.origin.propertyId, bookingEntry: "calendar" }), context.origin);
  if (context.target) {
    params.set("bookingRoom", context.target.roomId);
    params.set("bookingUnit", context.target.inventoryUnitId);
    if (context.target.bedId) params.set("bookingBed", context.target.bedId);
    params.set("bookingArrival", context.target.arrival);
    params.set("bookingDeparture", context.target.departure);
  }
  return `/reservations?${params}`;
}

export function calendarBookingReturnHref(context: CalendarBookingContext): string {
  const destination = new URL(operationalSurfaceOriginHref(context.origin), "http://local.invalid");
  destination.searchParams.set("bookFocus", context.target?.inventoryUnitId ?? "new");
  if (context.target) destination.searchParams.set("bookRoom", context.target.roomId);
  return `${destination.pathname}${destination.search}`;
}

export function parseCalendarBookingFocus(params: URLSearchParams, propertyId: string): { unitId: string | null; roomId: string | null } | null {
  const allowed = new Set(["property", "date", "day", "bookFocus", "bookRoom", "calViewDate", "calViewOffset"]);
  if ([...params.keys()].some((key) => !allowed.has(key) || params.getAll(key).length !== 1)
    || params.get("property") !== propertyId || !uuid.test(propertyId)) return null;
  const viewport = readCalendarViewport(params);
  if (!viewport.valid) return null;
  const originParams = withOperationalSurfaceReturn(new URLSearchParams({ property: propertyId }), {
    surface: "calendar", propertyId, date: params.get("date") ?? "", day: params.get("day") ?? "",
    ...(viewport.viewport ? { viewport: viewport.viewport } : {}),
  });
  if (!parseOperationalSurfaceReturn(originParams)) return null;
  const focus = params.get("bookFocus");
  if (focus === "new" && !params.has("bookRoom")) return { unitId: null, roomId: null };
  const roomId = params.get("bookRoom");
  return focus && uuid.test(focus) && roomId && uuid.test(roomId) ? { unitId: focus, roomId } : null;
}

export function calendarBookingTriggerKey(unitId: string, day: string): string {
  return `${unitId}:${day}`;
}

export function reservationAvailabilityMatchesRange(response: InventoryAvailabilityResponse | undefined, propertyId: string, arrival: string, departure: string): boolean {
  return Boolean(response && calendarBookingRangeValid(arrival, departure)
    && response.propertyId === propertyId && response.arrival === arrival && response.departure === departure
    && response.units.every(({ unit }) => unit.propertyId === propertyId)
    && new Set(response.units.map(({ unit }) => unit.inventoryUnitId)).size === response.units.length);
}

export function reservationRoomsMatchProperty(rooms: RoomInventory[] | undefined, propertyId: string): boolean {
  return Boolean(rooms && rooms.every((room) => room.propertyId === propertyId
    && room.units.every((unit) => unit.propertyId === propertyId && unit.roomId === room.roomId)));
}

export function reservationSelectionMatchesRooms(selectedIds: string[], rooms: RoomInventory[], response: InventoryAvailabilityResponse | undefined): boolean {
  return selectedIds.every((id) => {
    const candidate = response?.units.find((item) => item.unit.inventoryUnitId === id)?.unit;
    const room = rooms.find((item) => item.roomId === candidate?.roomId);
    return Boolean(candidate?.isSellable && candidate.isTopologyActive && room?.units.some((unit) => unit.inventoryUnitId === id
      && unit.propertyId === candidate.propertyId && (unit.bedId ?? undefined) === (candidate.bedId ?? undefined)
      && unit.isSellable && unit.isTopologyActive));
  });
}

export function resolveCalendarBookingTarget(target: CalendarBookingTarget, rooms: RoomInventory[], response: InventoryAvailabilityResponse | undefined) {
  const room = rooms.find((item) => item.roomId === target.roomId);
  const unit = room?.units.find((item) => item.inventoryUnitId === target.inventoryUnitId
    && (item.bedId ?? undefined) === target.bedId);
  const available = response?.units.find((item) => item.unit.inventoryUnitId === target.inventoryUnitId
    && item.unit.roomId === target.roomId && (item.unit.bedId ?? undefined) === target.bedId);
  return {
    room,
    unit,
    available: Boolean(unit?.isSellable && unit.isTopologyActive && available?.isAvailable
      && available.unit.isSellable && available.unit.isTopologyActive),
  };
}

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
