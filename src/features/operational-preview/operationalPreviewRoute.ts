import { readCalendarViewport, writeCalendarViewport, type CalendarViewport } from "../calendar/calendarWindow";

export type OperationalUnitState =
  | "available"
  | "occupied"
  | "blocked"
  | "unavailable"
  | "unknown";

export type TodayRoomsFilter = "all" | "attention" | "movements" | "available" | "blocked";
export type TodayRoomsContext = { roomId?: string; filter?: TodayRoomsFilter };

export type TodayQueue = "attention" | "arrivals" | "departures" | "staying";

export function readTodayQueue(params: URLSearchParams, key = "todayQueue"): { valid: boolean; queue: TodayQueue } {
  const values = params.getAll(key);
  const valid = values.length === 0 || (values.length === 1 && ["attention", "arrivals", "departures", "staying"].includes(values[0]));
  return { valid, queue: valid && values.length ? values[0] as TodayQueue : "attention" };
}

export function writeTodayQueue(params: URLSearchParams, queue: TodayQueue = "attention", key = "todayQueue") {
  params.delete(key);
  if (queue !== "attention") params.set(key, queue);
}

export function readTodayOriginContext(params: URLSearchParams, view: string | null, prefix: string): { valid: boolean; rooms?: TodayRoomsContext; queue?: TodayQueue } {
  if (view === "visual") {
    const rooms = readTodayRoomsContext(params, prefix);
    return { valid: rooms.valid, ...(Object.keys(rooms.context).length ? { rooms: rooms.context } : {}) };
  }
  const key = `${prefix}Queue`, queue = readTodayQueue(params, key);
  const valid = view === "operations" && queue.valid && ![...params.keys()].some(key => key.startsWith(prefix) && key !== `${prefix}Queue`);
  return { valid, ...(valid && queue.queue !== "attention" ? { queue: queue.queue } : {}) };
}

export function readTodayRoomsContext(params: URLSearchParams, prefix = "today"): { valid: boolean; context: TodayRoomsContext } {
  const roomKey = `${prefix}Room`, filterKey = `${prefix}Filter`;
  const room = params.get(roomKey), filter = params.get(filterKey);
  const valid = ![...params.keys()].some(key => key.startsWith(prefix) && key !== roomKey && key !== filterKey)
    && params.getAll(roomKey).length <= 1 && params.getAll(filterKey).length <= 1
    && (!params.has(roomKey) || Boolean(room && uuidPattern.test(room)))
    && (!params.has(filterKey) || ["all", "attention", "movements", "available", "blocked"].includes(filter ?? ""));
  return { valid, context: valid ? { ...(room ? { roomId: room } : {}), ...(filter && filter !== "all" ? { filter: filter as TodayRoomsFilter } : {}) } : {} };
}

export function writeTodayRoomsContext(params: URLSearchParams, context?: TodayRoomsContext, prefix = "today") {
  [...params.keys()].filter(key => key.startsWith(prefix)).forEach(key => params.delete(key));
  if (context?.roomId) params.set(`${prefix}Room`, context.roomId);
  if (context?.filter && context.filter !== "all") params.set(`${prefix}Filter`, context.filter);
}

export type OperationalPreviewSelection =
  | {
      kind: "reservation";
      propertyId: string;
      reservationId: string;
      date?: string;
      inventoryUnitId?: string;
      roomId?: string;
      bedId?: string;
    }
  | {
      kind: "inventoryBlock";
      propertyId: string;
      blockGroupId: string;
      blockId?: string;
      date?: string;
      inventoryUnitId?: string;
      roomId?: string;
      bedId?: string;
    }
  | {
      kind: "inventoryUnit";
      propertyId: string;
      inventoryUnitId: string;
      roomId: string;
      bedId?: string;
      date: string;
      observedState: OperationalUnitState;
    };

export type OperationalOrigin =
  | {
      surface: "calendar";
      propertyId: string;
      date: string;
      day: string;
      viewport?: CalendarViewport;
    }
  | {
      surface: "today";
      propertyId: string;
      view: "visual";
      rooms?: TodayRoomsContext;
      queue?: never;
    }
  | {
      surface: "today";
      propertyId: string;
      view: "operations";
      rooms?: never;
      queue?: TodayQueue;
    };

export type OperationalPreviewRoute = {
  selection: OperationalPreviewSelection;
  origin: OperationalOrigin;
};

const activeKeys = [
  "op",
  "opProperty",
  "opReservation",
  "opBlockGroup",
  "opBlock",
  "opUnit",
  "opRoom",
  "opBed",
  "opDate",
  "opState",
  "opFrom",
  "opFromDate",
  "opFromDay",
  "opFromViewportDate",
  "opFromViewportOffset",
  "opFromView",
  "opFromTodayRoom",
  "opFromTodayFilter",
  "opFromTodayQueue",
] as const;

const returnKeys = activeKeys.map((key) => `opReturn${key.slice(2)}`);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const unitStates = new Set<OperationalUnitState>([
  "available",
  "occupied",
  "blocked",
  "unavailable",
  "unknown",
]);

export function parseOperationalPreviewRoute(
  params: URLSearchParams,
): OperationalPreviewRoute | null {
  return parseNamespacedRoute(params, "op");
}

export function parseOperationalReturnRoute(
  params: URLSearchParams,
): OperationalPreviewRoute | null {
  if ([...params.keys()].some((key) => key.startsWith("surfaceReturn")
    || (key.startsWith("opReturn") && (!returnKeys.includes(key) || params.getAll(key).length !== 1)))
    || params.getAll("property").length > 1) return null;
  return parseNamespacedRoute(params, "opReturn");
}

export function hasOperationalPreviewRouteParams(params: URLSearchParams): boolean {
  return activeKeys.some((key) => params.has(key));
}

export function withOperationalPreviewRoute(
  current: URLSearchParams,
  route: OperationalPreviewRoute,
): URLSearchParams {
  const next = withoutOperationalPreviewRoute(current);
  writeNamespacedRoute(next, "op", route);
  return next;
}

export function withoutOperationalPreviewRoute(
  current: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(current);
  activeKeys.forEach((key) => next.delete(key));
  [...next.keys()].filter((key) => key.startsWith("opFromViewport")).forEach((key) => next.delete(key));
  [...next.keys()].filter((key) => key.startsWith("opFromToday")).forEach((key) => next.delete(key));
  return next;
}

export function withOperationalReturnRoute(
  current: URLSearchParams,
  route: OperationalPreviewRoute,
): URLSearchParams {
  const next = withoutOperationalReturnRoute(current);
  [...next.keys()].filter((key) => key.startsWith("surfaceReturn")).forEach((key) => next.delete(key));
  writeNamespacedRoute(next, "opReturn", route);
  return next;
}

export function withoutOperationalReturnRoute(
  current: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(current);
  returnKeys.forEach((key) => next.delete(key));
  [...next.keys()].filter((key) => key.startsWith("opReturnFromViewport")).forEach((key) => next.delete(key));
  [...next.keys()].filter((key) => key.startsWith("opReturnFromToday")).forEach((key) => next.delete(key));
  return next;
}

export function operationalOriginHref(route: OperationalPreviewRoute): string {
  const originParams = new URLSearchParams();
  let pathname: string;

  if (route.origin.surface === "calendar") {
    pathname = "/calendar";
    originParams.set("date", route.origin.date);
    originParams.set("day", route.origin.day);
    writeCalendarViewport(originParams, route.origin.viewport);
  } else {
    pathname = "/";
    if (route.origin.view === "visual") originParams.set("view", "visual");
    writeTodayRoomsContext(originParams, route.origin.rooms);
    if (route.origin.view === "operations") writeTodayQueue(originParams, route.origin.queue);
  }

  const params = withOperationalPreviewRoute(originParams, route);
  params.set("property", route.origin.propertyId);
  return `${pathname}?${params.toString()}`;
}

export function operationalOriginLabel(origin: OperationalOrigin): string {
  if (origin.surface === "calendar") {
    return `Back to Calendar · ${formatOriginDate(origin.day)}`;
  }
  return `Back to Today · ${origin.view === "visual" ? "Rooms" : "Operations"}`;
}

export function operationalPreviewTriggerKey(route: OperationalPreviewRoute): string {
  const selection = route.selection;
  const entity = selection.kind === "reservation"
    ? `${selection.reservationId}:${selection.inventoryUnitId ?? "none"}`
    : selection.kind === "inventoryBlock"
      ? `${selection.blockId ?? selection.blockGroupId}:${selection.inventoryUnitId ?? "none"}`
      : selection.inventoryUnitId;
  const origin = route.origin.surface === "calendar"
    ? `${route.origin.surface}:${selection.date ?? route.origin.day}`
    : `${route.origin.surface}:${route.origin.view}${route.origin.view === "operations" && route.origin.queue && route.origin.queue !== "attention" ? `:${route.origin.queue}` : ""}`;
  return `${origin}:${selection.kind}:${entity}`;
}

export function isOperationalRouteForProperty(
  route: OperationalPreviewRoute,
  propertyId: string,
): boolean {
  return route.selection.propertyId === propertyId
    && route.origin.propertyId === propertyId;
}

export function operationalOriginMatchesLocation(
  origin: OperationalOrigin,
  pathname: string,
  params: URLSearchParams,
): boolean {
  if (origin.surface === "calendar") {
    if (pathname !== "/calendar") return false;
    const date = safeDate(params.get("date"));
    const day = safeDate(params.get("day"));
    return (!date || date === origin.date) && (!day || day === origin.day);
  }
  if (pathname !== "/") return false;
  const view = params.get("view") === "visual" ? "visual" : "operations";
  if (view === "operations") {
    const queue = readTodayQueue(params);
    return view === origin.view && queue.valid && queue.queue === (origin.queue ?? "attention");
  }
  const rooms = readTodayRoomsContext(params);
  return view === origin.view && rooms.valid && (!origin.rooms
    || (rooms.context.roomId === origin.rooms.roomId && rooms.context.filter === origin.rooms.filter));
}

function parseNamespacedRoute(
  params: URLSearchParams,
  prefix: "op" | "opReturn",
): OperationalPreviewRoute | null {
  const kind = params.get(prefix);
  const propertyId = safeId(params.get(`${prefix}Property`));
  const origin = parseOrigin(params, prefix, propertyId);
  if (!propertyId || !origin) return null;

  const date = safeDate(params.get(`${prefix}Date`)) ?? undefined;
  const inventoryUnitId = safeId(params.get(`${prefix}Unit`)) ?? undefined;
  const roomId = safeId(params.get(`${prefix}Room`)) ?? undefined;
  const bedId = safeId(params.get(`${prefix}Bed`)) ?? undefined;

  if (kind === "reservation") {
    const reservationId = safeId(params.get(`${prefix}Reservation`));
    if (!reservationId || (params.has(`${prefix}Date`) && !date)) return null;
    return {
      selection: {
        kind,
        propertyId,
        reservationId,
        // Today selects a record (including overdue/upcoming stays), not a date cell.
        // Normalize valid legacy links without weakening Calendar's date association.
        date: origin.surface === "today" ? undefined : date,
        inventoryUnitId,
        roomId,
        bedId,
      },
      origin,
    };
  }

  if (kind === "inventoryBlock") {
    const blockGroupId = safeId(params.get(`${prefix}BlockGroup`));
    if (!blockGroupId) return null;
    return {
      selection: {
        kind,
        propertyId,
        blockGroupId,
        blockId: safeId(params.get(`${prefix}Block`)) ?? undefined,
        date,
        inventoryUnitId,
        roomId,
        bedId,
      },
      origin,
    };
  }

  if (kind === "inventoryUnit" && inventoryUnitId && roomId && date) {
    const state = params.get(`${prefix}State`) as OperationalUnitState | null;
    if (!state || !unitStates.has(state)) return null;
    return {
      selection: {
        kind,
        propertyId,
        inventoryUnitId,
        roomId,
        bedId,
        date,
        observedState: state,
      },
      origin,
    };
  }

  return null;
}

function parseOrigin(
  params: URLSearchParams,
  prefix: "op" | "opReturn",
  propertyId: string | null,
): OperationalOrigin | null {
  if (!propertyId) return null;
  const surface = params.get(`${prefix}From`);
  if (surface === "calendar") {
    if ([...params.keys()].some(key => key.startsWith(`${prefix}FromToday`))) return null;
    const date = safeDate(params.get(`${prefix}FromDate`));
    const day = safeDate(params.get(`${prefix}FromDay`));
    const viewport = readCalendarViewport(params, `${prefix}FromViewport`);
    return date && day && viewport.valid ? { surface, propertyId, date, day, ...(viewport.viewport ? { viewport: viewport.viewport } : {}) } : null;
  }
  if (surface === "today") {
    if ([...params.keys()].some((key) => key.startsWith(`${prefix}FromViewport`))) return null;
    const view = params.get(`${prefix}FromView`);
    const { valid, ...context } = readTodayOriginContext(params, view, `${prefix}FromToday`);
    if (!valid) return null;
    if (view === "visual") return { surface, propertyId, view, ...(context.rooms ? { rooms: context.rooms } : {}) };
    if (view === "operations") return { surface, propertyId, view, ...(context.queue ? { queue: context.queue } : {}) };
    return null;
  }
  return null;
}

function writeNamespacedRoute(
  params: URLSearchParams,
  prefix: "op" | "opReturn",
  route: OperationalPreviewRoute,
) {
  const selection = route.selection;
  params.set(prefix, selection.kind);
  params.set(`${prefix}Property`, selection.propertyId);
  if (selection.kind === "reservation") {
    params.set(`${prefix}Reservation`, selection.reservationId);
  } else if (selection.kind === "inventoryBlock") {
    params.set(`${prefix}BlockGroup`, selection.blockGroupId);
    setOptional(params, `${prefix}Block`, selection.blockId);
  }
  if (selection.kind === "inventoryUnit") {
    params.set(`${prefix}State`, selection.observedState);
  }
  setOptional(params, `${prefix}Unit`, selection.inventoryUnitId);
  setOptional(params, `${prefix}Room`, selection.roomId);
  setOptional(params, `${prefix}Bed`, selection.bedId);
  setOptional(params, `${prefix}Date`, selection.date);

  params.set(`${prefix}From`, route.origin.surface);
  if (route.origin.surface === "calendar") {
    params.set(`${prefix}FromDate`, route.origin.date);
    params.set(`${prefix}FromDay`, route.origin.day);
    writeCalendarViewport(params, route.origin.viewport, `${prefix}FromViewport`);
  } else {
    params.set(`${prefix}FromView`, route.origin.view);
    if (route.origin.view === "visual") writeTodayRoomsContext(params, route.origin.rooms, `${prefix}FromToday`);
    else writeTodayQueue(params, route.origin.queue, `${prefix}FromTodayQueue`);
  }
}

function setOptional(
  params: URLSearchParams,
  key: string,
  value: string | undefined,
) {
  if (value) params.set(key, value);
}

function safeId(value: string | null): string | null {
  return value && uuidPattern.test(value) ? value : null;
}

function safeDate(value: string | null): string | null {
  if (!value || !datePattern.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function formatOriginDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00Z`));
}
