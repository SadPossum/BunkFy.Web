import { describe, expect, it } from "vitest";
import {
  operationalSurfaceOriginHref,
  parseOperationalSurfaceReturn,
  todayVisualSpacesHref,
  operationalSpacesHref,
  withOperationalSurfaceReturn,
} from "../src/features/operational-preview/operationalSurfaceReturn";
import { operationalOriginHref, parseOperationalPreviewRoute, parseOperationalReturnRoute, withOperationalReturnRoute, type OperationalPreviewRoute } from "../src/features/operational-preview/operationalPreviewRoute";
import { spacesReturnHref, withSpacesReturnRoute } from "../src/features/spaces/spacesReturnRoute";
import { propertySwitchSearchParams } from "../src/components/layout/propertySwitchRoute";

const propertyId = "11111111-1111-4111-8111-111111111111";
const otherProperty = "22222222-2222-4222-8222-222222222222";
const params = () => new URL(todayVisualSpacesHref(propertyId), "https://example.test").searchParams;

describe("surface-only Today return", () => {
  it.each(["attention", "arrivals", "departures", "staying"] as const)("preserves %s Operations queue through Spaces and nested return", queue => {
    const origin = { surface: "today" as const, propertyId, view: "operations" as const, ...(queue !== "attention" ? { queue } : {}) };
    const initial = new URL(operationalSpacesHref(origin, "layout"), "https://example.test").searchParams;
    expect(parseOperationalSurfaceReturn(initial)).toEqual(origin);
    const owner = withSpacesReturnRoute(initial, { section: "layout", propertyId, roomId: otherProperty });
    const returned = new URL(spacesReturnHref({ section: "layout", propertyId, roomId: otherProperty }, owner), "https://example.test").searchParams;
    expect(parseOperationalSurfaceReturn(returned)).toEqual(origin);
    const href = new URL(operationalSurfaceOriginHref(origin), "https://example.test");
    expect(href.searchParams.get("todayQueue")).toBe(queue === "attention" ? null : queue);
    expect(href.searchParams.has("view")).toBe(false); expect(href.searchParams.get("property")).toBe(propertyId);
    for (const invalid of ["", "ARRIVALS", "secret"]) { const bad = new URLSearchParams(initial); bad.set("surfaceReturnTodayQueue", invalid); expect(parseOperationalSurfaceReturn(bad)).toBeNull(); }
    initial.append("surfaceReturnTodayQueue", "arrivals"); initial.append("surfaceReturnTodayQueue", "arrivals"); expect(parseOperationalSurfaceReturn(initial)).toBeNull();
    expect(parseOperationalSurfaceReturn(propertySwitchSearchParams("/spaces", returned, otherProperty))).toBeNull();
  });
  it("rejects a queue on Rooms or Calendar and keeps unknown/mixed namespaces closed", () => {
    for (const origin of [{ surface: "today" as const, propertyId, view: "visual" as const }, { surface: "calendar" as const, propertyId, date: "2026-09-09", day: "2026-09-09" }]) {
      const value = new URL(operationalSpacesHref(origin, "layout"), "https://example.test").searchParams;
      value.set("surfaceReturnTodayQueue", "attention"); expect(parseOperationalSurfaceReturn(value)).toBeNull();
    }
  });
  it("preserves only scoped structural Rooms filters through Spaces and nested editor return", () => {
    const origin = { surface: "today" as const, propertyId, view: "visual" as const, rooms: { roomId: otherProperty, filter: "movements" as const } };
    const initial = new URL(todayVisualSpacesHref(propertyId, otherProperty, origin.rooms), "https://example.test").searchParams;
    expect(parseOperationalSurfaceReturn(initial)).toEqual(origin);
    const owner = withSpacesReturnRoute(initial, { section: "layout", propertyId, roomId: otherProperty });
    const back = new URL(spacesReturnHref({ section: "layout", propertyId, roomId: otherProperty }, owner), "https://example.test");
    expect(parseOperationalSurfaceReturn(back.searchParams)).toEqual(origin);
    expect(operationalSurfaceOriginHref(origin)).toContain(`todayRoom=${otherProperty}&todayFilter=movements`);
    for (const key of ["surfaceReturnTodayRoom", "surfaceReturnTodayFilter"]) {
      const duplicate = new URLSearchParams(initial); duplicate.append(key, duplicate.get(key)!); expect(parseOperationalSurfaceReturn(duplicate)).toBeNull();
      duplicate.set(key, "secret"); expect(parseOperationalSurfaceReturn(duplicate)).toBeNull();
    }
    expect(parseOperationalSurfaceReturn(propertySwitchSearchParams("/spaces", initial, otherProperty))).toBeNull();
  });
  it("binds Spaces layout and Today Visual to the same property without a fake entity", () => {
    const next = params();
    expect(next.get("section")).toBe("layout");
    expect(next.get("property")).toBe(propertyId);
    const origin = parseOperationalSurfaceReturn(next)!;
    expect(operationalSurfaceOriginHref(origin)).toBe(`/?view=visual&property=${propertyId}`);
    expect(parseOperationalReturnRoute(next)).toBeNull();
    expect(parseOperationalPreviewRoute(next)).toBeNull();
    expect(new URL(todayVisualSpacesHref(propertyId, "room-a"), "https://example.test").searchParams.get("room")).toBe("room-a");
  });

  it.each(["surfaceReturn", "surfaceReturnView", "surfaceReturnProperty"])("rejects missing or ambiguous %s", (key) => {
    const missing = params();
    missing.delete(key);
    expect(parseOperationalSurfaceReturn(missing)).toBeNull();
    const duplicate = params();
    duplicate.append(key, duplicate.get(key)!);
    expect(parseOperationalSurfaceReturn(duplicate)).toBeNull();
  });

  it("rejects arbitrary destinations, malformed identities and changed-property provenance", () => {
    for (const [key, value] of [["surfaceReturn", "https://evil.test"], ["surfaceReturnView", "settings"], ["surfaceReturnProperty", "../private"], ["property", otherProperty]]) {
      const next = params();
      next.set(key!, value!);
      expect(parseOperationalSurfaceReturn(next)).toBeNull();
    }
  });

  it("survives a Spaces section and edit-owner roundtrip only for the same property", () => {
    const route = { section: "property" as const, propertyId };
    const owner = withSpacesReturnRoute(params(), route);
    const back = new URL(spacesReturnHref(route, owner), "https://example.test");
    expect(parseOperationalSurfaceReturn(back.searchParams)).toEqual({ surface: "today", view: "visual", propertyId });
    const crossProperty = new URL(spacesReturnHref({ ...route, propertyId: otherProperty }, owner), "https://example.test");
    expect(parseOperationalSurfaceReturn(crossProperty.searchParams)).toBeNull();
  });

  it("clears provenance on property switching while keeping the current surface view", () => {
    const next = propertySwitchSearchParams("/spaces", params(), otherProperty);
    expect(next.get("property")).toBe(otherProperty);
    expect(next.get("section")).toBe("layout");
    expect(next.has("surfaceReturn")).toBe(false);
    expect(propertySwitchSearchParams("/", new URLSearchParams(`view=visual&property=${propertyId}`), otherProperty).toString()).toBe(`view=visual&property=${otherProperty}`);
  });
});

const calendar = { surface: "calendar" as const, propertyId, date: "2026-09-09", day: "2026-09-11" };
const calendarParams = () => new URL(operationalSpacesHref(calendar, "layout", otherProperty), "https://example.test").searchParams;
describe("Calendar and Today entityless Spaces handoffs", () => {
  it("preserves an extended Calendar viewport through Spaces and nested owners with strict paired fields", () => {
    const origin = { ...calendar, date: "2026-10-08", day: "2026-10-08", viewport: { date: "2026-10-06", offset: 375 } };
    const route = { section: "layout" as const, propertyId, roomId: otherProperty };
    const initial = new URL(operationalSpacesHref(origin, "layout", otherProperty), "https://example.test").searchParams;
    const owner = withSpacesReturnRoute(initial, route);
    const returned = new URL(spacesReturnHref(route, owner), "https://example.test").searchParams;
    expect(parseOperationalSurfaceReturn(returned)).toEqual(origin);
    const calendarBack = new URL(operationalSurfaceOriginHref(origin), "https://example.test");
    expect(calendarBack.searchParams.get("calViewOffset")).toBe("375");
    for (const key of ["surfaceReturnViewportDate", "surfaceReturnViewportOffset"]) {
      const incomplete = new URLSearchParams(initial); incomplete.delete(key); expect(parseOperationalSurfaceReturn(incomplete)).toBeNull();
      const duplicate = new URLSearchParams(initial); duplicate.append(key, duplicate.get(key)!); expect(parseOperationalSurfaceReturn(duplicate)).toBeNull();
    }
    expect(parseOperationalSurfaceReturn(propertySwitchSearchParams("/spaces", initial, otherProperty))).toBeNull();
  });
  it("preserves exact room/property, Calendar anchor/selected day and canonical Today Operations view", () => {
    const next = calendarParams();
    expect(next.get("room")).toBe(otherProperty);
    expect(parseOperationalSurfaceReturn(next)).toEqual(calendar);
    expect(operationalSurfaceOriginHref(calendar)).toBe(`/calendar?date=2026-09-09&day=2026-09-11&property=${propertyId}`);
    const today = { surface: "today" as const, propertyId, view: "operations" as const };
    const availability = new URL(operationalSpacesHref(today, "availability"), "https://example.test");
    expect(availability.searchParams.get("section")).toBe("availability");
    expect(availability.searchParams.has("room")).toBe(false);
    expect(parseOperationalSurfaceReturn(availability.searchParams)).toEqual(today);
    expect(operationalSurfaceOriginHref(today)).toBe(`/?property=${propertyId}`);
    for (const item of [next, availability.searchParams]) {
      expect(parseOperationalPreviewRoute(item)).toBeNull(); expect(parseOperationalReturnRoute(item)).toBeNull();
    }
  });
  it.each(["property", "surfaceReturn", "surfaceReturnProperty", "surfaceReturnDate", "surfaceReturnDay"])("rejects missing or duplicate Calendar %s", (key) => {
    const missing = calendarParams(); missing.delete(key); expect(parseOperationalSurfaceReturn(missing)).toBeNull();
    const duplicate = calendarParams(); duplicate.append(key, duplicate.get(key)!); expect(parseOperationalSurfaceReturn(duplicate)).toBeNull();
  });
  it.each([
    ["surfaceReturnDate", "2026-02-30"], ["surfaceReturnDay", "2026-09-06"], ["surfaceReturnDay", "2026-09-14"],
    ["surfaceReturnDay", "2026-9-11"], ["surfaceReturnView", "operations"], ["surfaceReturnExtra", "ignored?"],
    ["surfaceReturn", "unknown"], ["surfaceReturnProperty", otherProperty],
  ])("rejects invalid/mixed Calendar %s=%s", (key, value) => {
    const next = calendarParams(); next.set(key, value); expect(parseOperationalSurfaceReturn(next)).toBeNull();
  });
  it("accepts Monday/Sunday and year/leap boundaries only inside the anchored week", () => {
    for (const [date, day] of [["2026-09-09", "2026-09-07"], ["2026-09-09", "2026-09-13"], ["2026-01-01", "2025-12-29"], ["2024-02-29", "2024-03-03"]]) {
      const origin = { ...calendar, date: date!, day: day! };
      expect(parseOperationalSurfaceReturn(new URL(operationalSpacesHref(origin, "layout"), "https://example.test").searchParams)).toEqual(origin);
    }
    const mixedToday = params(); mixedToday.set("surfaceReturnDay", calendar.day); expect(parseOperationalSurfaceReturn(mixedToday)).toBeNull();
  });
  it("rejects surface/entity ambiguity in both parsers; deliberate writers keep only one origin", () => {
    const entity: OperationalPreviewRoute = { selection: { kind: "reservation", propertyId, reservationId: otherProperty }, origin: calendar };
    const entityParams = withOperationalReturnRoute(new URLSearchParams({ property: propertyId }), entity);
    const mixed = calendarParams(); entityParams.forEach((value, key) => { if (key.startsWith("opReturn")) mixed.set(key, value); });
    expect(parseOperationalSurfaceReturn(mixed)).toBeNull(); expect(parseOperationalReturnRoute(mixed)).toBeNull();
    expect(parseOperationalReturnRoute(withOperationalReturnRoute(calendarParams(), entity))).toEqual(entity);
    expect(parseOperationalSurfaceReturn(withOperationalSurfaceReturn(entityParams, calendar))).toEqual(calendar);
    const duplicate = new URLSearchParams(entityParams); duplicate.append("opReturnProperty", propertyId); expect(parseOperationalReturnRoute(duplicate)).toBeNull();
    const unknown = new URLSearchParams(entityParams); unknown.set("opReturnExtra", "invalid"); expect(parseOperationalReturnRoute(unknown)).toBeNull();
    const back = new URL(operationalOriginHref(entity), "https://example.test");
    expect(back.searchParams.get("property")).toBe(propertyId); expect(parseOperationalPreviewRoute(back.searchParams)).toEqual(entity);
  });
  it("keeps the Calendar surface origin through Spaces owner return and removes it on property switch", () => {
    const route = { section: "layout" as const, propertyId, roomId: otherProperty };
    const next = new URL(spacesReturnHref(route, withSpacesReturnRoute(calendarParams(), route)), "https://example.test").searchParams;
    expect(parseOperationalSurfaceReturn(next)).toEqual(calendar);
    const switched = propertySwitchSearchParams("/spaces", next, otherProperty);
    expect([...switched.keys()].some((key) => key.startsWith("surfaceReturn"))).toBe(false);
    expect(switched.has("room")).toBe(false);
  });
});
