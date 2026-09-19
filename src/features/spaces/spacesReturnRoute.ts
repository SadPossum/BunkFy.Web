import {
  isOperationalRouteForProperty,
  parseOperationalReturnRoute,
  withOperationalReturnRoute,
} from "../operational-preview/operationalPreviewRoute";
import { isSpacesSection, type SpacesSection } from "./spacesSectionRoute";
import { parseOperationalSurfaceReturn, withOperationalSurfaceReturn } from "../operational-preview/operationalSurfaceReturn";

export type SpacesReturnRoute = {
  section: SpacesSection;
  propertyId: string;
  roomId?: string;
  bedId?: string;
  inventoryUnitId?: string;
  blockGroupId?: string;
  history?: "all";
  arrival?: string;
  departure?: string;
  filter?: string;
};

const returnKeys = [
  "spacesReturn",
  "spacesReturnProperty",
  "spacesReturnRoom",
  "spacesReturnBed",
  "spacesReturnUnit",
  "spacesReturnBlockGroup",
  "spacesReturnHistory",
  "spacesReturnArrival",
  "spacesReturnDeparture",
  "spacesReturnQuery",
] as const;

export function withSpacesReturnRoute(
  current: URLSearchParams,
  route: SpacesReturnRoute,
): URLSearchParams {
  const next = withoutSpacesReturnRoute(current);
  next.set("spacesReturn", route.section);
  next.set("spacesReturnProperty", route.propertyId);
  writeOptional(next, "spacesReturnRoom", route.roomId);
  writeOptional(next, "spacesReturnBed", route.bedId);
  writeOptional(next, "spacesReturnUnit", route.inventoryUnitId);
  writeOptional(next, "spacesReturnBlockGroup", route.blockGroupId);
  writeOptional(next, "spacesReturnHistory", route.history);
  writeOptional(next, "spacesReturnArrival", route.arrival);
  writeOptional(next, "spacesReturnDeparture", route.departure);
  writeOptional(next, "spacesReturnQuery", route.filter);
  return next;
}

export function parseSpacesReturnRoute(
  params: URLSearchParams,
  ownerPropertyId?: string | null,
): SpacesReturnRoute | null {
  if (returnKeys.some((key) => params.getAll(key).length > 1)
    || params.getAll("property").length > 1
    || [...params.keys()].some((key) => key.startsWith("spacesReturn") && !(returnKeys as readonly string[]).includes(key))) return null;
  const section = params.get("spacesReturn");
  const propertyId = safeValue(params.get("spacesReturnProperty"));
  if (!isSpacesSection(section) || !propertyId) return null;
  if (ownerPropertyId !== undefined && ownerPropertyId !== propertyId) return null;
  const hasArrival = params.has("spacesReturnArrival");
  const hasDeparture = params.has("spacesReturnDeparture");
  const arrival = safeDate(params.get("spacesReturnArrival"));
  const departure = safeDate(params.get("spacesReturnDeparture"));
  if (hasArrival !== hasDeparture) return null;
  if (hasArrival && (!arrival || !departure || arrival >= departure)) return null;
  const history = params.get("spacesReturnHistory");
  if (history !== null && history !== "all") return null;
  if (["spacesReturnRoom", "spacesReturnBed", "spacesReturnUnit", "spacesReturnBlockGroup"].some((key) => params.has(key) && !safeValue(params.get(key)))) return null;
  const filter = params.get("spacesReturnQuery");
  if (filter !== null && (filter.length > 500 || [...filter].some((character) => character.charCodeAt(0) < 32))) return null;
  return {
    section,
    propertyId,
    ...optionalValue("roomId", safeValue(params.get("spacesReturnRoom"))),
    ...optionalValue("bedId", safeValue(params.get("spacesReturnBed"))),
    ...optionalValue("inventoryUnitId", safeValue(params.get("spacesReturnUnit"))),
    ...optionalValue("blockGroupId", safeValue(params.get("spacesReturnBlockGroup"))),
    ...(history === "all" ? { history } : {}),
    ...optionalValue("arrival", arrival),
    ...optionalValue("departure", departure),
    ...optionalValue("filter", filter),
  };
}

export function spacesReturnHref(
  route: SpacesReturnRoute,
  current: URLSearchParams,
): string {
  const next = new URLSearchParams({
    section: route.section,
    property: route.propertyId,
  });
  writeOptional(next, "room", route.roomId);
  writeOptional(next, "bed", route.bedId);
  writeOptional(next, "unit", route.inventoryUnitId);
  writeOptional(next, "blockGroup", route.blockGroupId);
  writeOptional(next, "history", route.history);
  writeOptional(next, "arrival", route.arrival);
  writeOptional(next, "departure", route.departure);
  writeOptional(next, "q", route.filter);
  const operationalReturn = parseOperationalReturnRoute(current);
  let safeNext = operationalReturn && isOperationalRouteForProperty(operationalReturn, route.propertyId)
    ? withOperationalReturnRoute(next, operationalReturn)
    : next;
  const surfaceReturn = parseOperationalSurfaceReturn(current, route.propertyId);
  if (surfaceReturn) safeNext = withOperationalSurfaceReturn(safeNext, surfaceReturn);
  return `/spaces?${safeNext.toString()}`;
}

export function withoutSpacesReturnRoute(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  returnKeys.forEach((key) => next.delete(key));
  return next;
}

function writeOptional(params: URLSearchParams, key: string, value: string | undefined) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function optionalValue<Key extends string>(key: Key, value: string | null): Partial<Record<Key, string>> {
  return value ? { [key]: value } as Record<Key, string> : {};
}

function safeValue(value: string | null): string | null {
  if (!value || value.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(value)) return null;
  return value;
}

function safeDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
