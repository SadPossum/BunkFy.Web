import { readTodayRoomsContext, writeTodayRoomsContext, type OperationalOrigin, type TodayRoomsContext } from "./operationalPreviewRoute";
import { readCalendarViewport, writeCalendarViewport } from "../calendar/calendarWindow";

// A surface handoff has no selected entity. Keep it separate from preview routes.
export type OperationalSurfaceReturn = OperationalOrigin;
const keys = ["surfaceReturn", "surfaceReturnView", "surfaceReturnProperty", "surfaceReturnDate", "surfaceReturnDay", "surfaceReturnViewportDate", "surfaceReturnViewportOffset", "surfaceReturnTodayRoom", "surfaceReturnTodayFilter"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOperationalSurfaceReturn(
  params: URLSearchParams,
  propertyId: string | null = params.get("property"),
): OperationalSurfaceReturn | null {
  if (params.getAll("property").length !== 1
    || params.getAll("surfaceReturn").length !== 1
    || params.getAll("surfaceReturnProperty").length !== 1
    || keys.some((key) => params.getAll(key).length > 1)
    || [...params.keys()].some((key) => key.startsWith("opReturn")
      || (key.startsWith("surfaceReturn") && !(keys as readonly string[]).includes(key)))) return null;
  const property = params.get("surfaceReturnProperty");
  if (!property || !uuidPattern.test(property) || property !== propertyId || property !== params.get("property")) return null;
  if (params.get("surfaceReturn") === "today") {
    const view = params.get("surfaceReturnView");
    const rooms = readTodayRoomsContext(params, "surfaceReturnToday"), hasRooms = Object.keys(rooms.context).length > 0;
    return rooms.valid && !params.has("surfaceReturnDate") && !params.has("surfaceReturnDay") && !params.has("surfaceReturnViewportDate") && !params.has("surfaceReturnViewportOffset") && (view === "visual" || (view === "operations" && !hasRooms))
      ? { surface: "today", propertyId: property, view, ...(hasRooms ? { rooms: rooms.context } : {}) } : null;
  }
  if (params.get("surfaceReturn") === "calendar" && !params.has("surfaceReturnView")) {
    if ([...params.keys()].some(key => key.startsWith("surfaceReturnToday"))) return null;
    const date = params.get("surfaceReturnDate"), day = params.get("surfaceReturnDay");
    const viewport = readCalendarViewport(params, "surfaceReturnViewport");
    if (!realDate(date) || !realDate(day) || !viewport.valid) return null;
    const anchor = new Date(`${date}T12:00:00Z`);
    const weekStart = anchor.getTime() - ((anchor.getUTCDay() + 6) % 7) * 86_400_000;
    const selected = new Date(`${day}T12:00:00Z`).getTime();
    return selected >= weekStart && selected < weekStart + 7 * 86_400_000
      ? { surface: "calendar", propertyId: property, date, day, ...(viewport.viewport ? { viewport: viewport.viewport } : {}) } : null;
  }
  return null;
}

export function withoutOperationalSurfaceReturn(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  [...next.keys()].filter((key) => key.startsWith("surfaceReturn")).forEach((key) => next.delete(key));
  return next;
}

export function withOperationalSurfaceReturn(
  current: URLSearchParams,
  origin: OperationalSurfaceReturn,
): URLSearchParams {
  const next = withoutOperationalSurfaceReturn(current);
  [...next.keys()].filter((key) => key.startsWith("opReturn")).forEach((key) => next.delete(key));
  next.set("surfaceReturn", origin.surface);
  if (origin.surface === "today") {
    next.set("surfaceReturnView", origin.view);
    writeTodayRoomsContext(next, origin.rooms, "surfaceReturnToday");
  }
  else {
    next.set("surfaceReturnDate", origin.date);
    next.set("surfaceReturnDay", origin.day);
    writeCalendarViewport(next, origin.viewport, "surfaceReturnViewport");
  }
  next.set("surfaceReturnProperty", origin.propertyId);
  return next;
}

export function operationalSurfaceOriginHref(origin: OperationalSurfaceReturn): string {
  if (origin.surface === "today") {
    const params = new URLSearchParams({ view: origin.view, property: origin.propertyId });
    writeTodayRoomsContext(params, origin.rooms);
    return `/?${params}`;
  }
  const params = new URLSearchParams({ date: origin.date, day: origin.day, property: origin.propertyId });
  writeCalendarViewport(params, origin.viewport);
  return `/calendar?${params}`;
}

export function todayVisualSpacesHref(propertyId: string, roomId?: string, rooms?: TodayRoomsContext): string {
  return operationalSpacesHref({ surface: "today", view: "visual", propertyId, ...(rooms ? { rooms } : {}) }, "layout", roomId);
}

export function operationalSpacesHref(origin: OperationalSurfaceReturn, section: "layout" | "availability", roomId?: string): string {
  const params = new URLSearchParams({ section, property: origin.propertyId });
  if (roomId) params.set("room", roomId);
  return `/spaces?${withOperationalSurfaceReturn(params, origin)}`;
}

function realDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
