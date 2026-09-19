import { validStayDateRange } from "../../app/propertyDate";
import { isOperationalRouteForProperty, parseOperationalReturnRoute } from "../operational-preview/operationalPreviewRoute";
import { parseOperationalSurfaceReturn } from "../operational-preview/operationalSurfaceReturn";
import { parseRetirementReturn } from "../properties/topologyRetirementRoutes";
import { parsePropertyRetirementReturn } from "../properties/propertyRetirementRoutes";

export const spacesSections = [
  "layout",
  "availability",
  "blocks",
  "property",
] as const;

export type SpacesSection = (typeof spacesSections)[number];

// A navigation owner contains route coordinates only, never cached grants/data.
export type SpacesEditorNavigationState = { engaged: boolean; pending: boolean; label: string; authorityLost: boolean };

export function spacesNavigationAuthorityKey(actor: string, params: URLSearchParams, fallbackPropertyId: string): string {
  const propertyId = params.has("property") ? params.get("property") ?? "" : fallbackPropertyId;
  return actor && propertyId && !spacesContextIssue(params) ? JSON.stringify([actor, propertyId]) : "";
}

export function spacesRouteIsPaused(held: string | null, requested: string): boolean {
  if (held === null) return false;
  const left = new URLSearchParams(held), right = new URLSearchParams(requested);
  left.sort(); right.sort();
  return left.toString() !== right.toString();
}

export function spacesNavigationLabel(params: URLSearchParams, rooms: readonly { roomId: string; name: string; inventoryUnits: readonly { inventoryUnitId: string; bedId?: string | null; label: string }[] }[], pathname = "/spaces"): string {
  if (pathname !== "/spaces") return pathname === "/" ? "Today" : pathname === "/calendar" ? "Calendar" : pathname.split("/").filter(Boolean).join(" / ");
  const section = parseSpacesSection(params);
  if (section === "property") return "Property settings";
  if (section === "blocks") return "All holds";
  const unitId = params.get("unit"), bedId = params.get("bed"), roomId = params.get("room");
  const units = rooms.flatMap(room => room.inventoryUnits);
  const unit = unitId ? units.find(item => item.inventoryUnitId === unitId) : bedId ? units.find(item => item.bedId === bedId) : undefined;
  const target = unit?.label ?? rooms.find(room => room.roomId === roomId)?.name
    ?? (unitId || bedId ? "the requested bed or space" : roomId ? "the requested room" : "Rooms and beds");
  const range = params.get("arrival") && params.get("departure") ? ` (${params.get("arrival")} to ${params.get("departure")})` : "";
  return target + range;
}

const propertyTargetKeys = [
  "q",
  "room",
  "bed",
  "unit",
  "blockGroup",
  "history",
  "arrival",
  "departure",
  "focus",
  "edit",
  "retire",
  "retirement",
  "spacesSurfaceFrom",
  "spacesSurfaceHistory",
] as const;

export function parseSpacesSection(params: URLSearchParams): SpacesSection {
  const value = params.get("section");
  return isSpacesSection(value) ? value : "layout";
}

export function isSpacesSection(value: string | null | undefined): value is SpacesSection {
  return spacesSections.some((section) => section === value);
}

export function withSpacesSection(
  current: URLSearchParams,
  section: SpacesSection,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("section", section);
  next.delete("focus");
  next.delete("edit");
  next.delete("retire");
  next.delete("retirement");
  return next;
}

export function clearSpacesPropertyTargets(params: URLSearchParams): void {
  propertyTargetKeys.forEach((key) => params.delete(key));
}

// Focused surfaces keep the same exact selection and source owner. History is
// a loading choice, not permission to widen the selected-space hold scope.
export function spacesContextIssue(params: URLSearchParams): string | null {
  const keys = ["section", "property", ...propertyTargetKeys];
  if ([...params.keys()].some((key) => (keys.includes(key) || /^(opReturn|surfaceReturn|spacesReturn|.*RetirementReturn|retirementReturn)/.test(key)) && params.getAll(key).length > 1)) {
    return "This link repeats a Spaces target or return parameter. Keep one exact value before continuing.";
  }
  if (["property", "room", "bed", "unit", "blockGroup"].some((key) => params.has(key) && !/^[A-Za-z0-9._:-]{1,200}$/.test(params.get(key) ?? ""))) {
    return "A requested Spaces identity is invalid. The link is kept unchanged; no substitute is selected.";
  }
  if ((params.has("arrival") || params.has("departure")) && !validStayDateRange({ arrival: params.get("arrival") ?? "", departure: params.get("departure") ?? "" })) {
    return "This link needs an exact valid From and Until date range.";
  }
  if (params.has("spacesSurfaceFrom") && !["layout", "availability"].includes(params.get("spacesSurfaceFrom") ?? "")) return "The Spaces return surface is invalid.";
  if (params.has("spacesSurfaceHistory") && !["active", "all"].includes(params.get("spacesSurfaceHistory") ?? "")) return "The selected-space history return is invalid.";
  const propertyId = params.get("property");
  if ([...params.keys()].some((key) => key.startsWith("opReturn"))) {
    const origin = parseOperationalReturnRoute(params);
    if (!origin || !propertyId || !isOperationalRouteForProperty(origin, propertyId)) return "The operational return does not match this exact Spaces context.";
  }
  if ([...params.keys()].some((key) => key.startsWith("surfaceReturn")) && !parseOperationalSurfaceReturn(params, propertyId)) return "The surface return does not match this exact Spaces context.";
  if (params.has("retirementReturn") && !parseRetirementReturn(params, propertyId)) return "The retirement return does not match this property.";
  if (params.has("propertyRetirementReturn") && !parsePropertyRetirementReturn(params, propertyId)) return "The property retirement return does not match this property.";
  return null;
}

export function withSpacesFocusedSurface(current: URLSearchParams, surface: "property" | "blocks"): URLSearchParams | null {
  if (!current.get("property") || spacesContextIssue(current)) return null;
  const next = new URLSearchParams(current);
  const from = parseSpacesSection(current);
  if (from === "layout" || from === "availability") {
    next.set("spacesSurfaceFrom", from);
    next.set("spacesSurfaceHistory", current.get("history") === "all" ? "all" : "active");
  } else if (!next.has("spacesSurfaceFrom")) next.set("spacesSurfaceFrom", "layout");
  next.set("section", surface);
  next.delete("focus");
  if (surface === "blocks") next.set("history", "all");
  return next;
}

export function spacesFocusedBackParams(current: URLSearchParams): URLSearchParams | null {
  if (!current.get("property") || spacesContextIssue(current)) return null;
  const next = new URLSearchParams(current);
  next.set("section", current.get("spacesSurfaceFrom") === "availability" ? "availability" : "layout");
  if (current.get("spacesSurfaceHistory") === "active") next.delete("history");
  else if (current.get("spacesSurfaceHistory") === "all") next.set("history", "all");
  next.delete("spacesSurfaceFrom");
  next.delete("spacesSurfaceHistory");
  next.delete("focus");
  return next;
}
