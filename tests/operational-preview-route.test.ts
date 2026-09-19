import { describe, expect, it } from "vitest";
import {
  hasOperationalPreviewRouteParams,
  isOperationalRouteForProperty,
  operationalOriginHref,
  operationalOriginMatchesLocation,
  operationalPreviewTriggerKey,
  readTodayRoomsContext,
  parseOperationalPreviewRoute,
  parseOperationalReturnRoute,
  withOperationalPreviewRoute,
  withOperationalReturnRoute,
  withoutOperationalPreviewRoute,
  type OperationalPreviewRoute,
} from "../src/features/operational-preview/operationalPreviewRoute";

const propertyId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const roomId = "33333333-3333-4333-8333-333333333333";
const unitId = "44444444-4444-4444-8444-444444444444";

const route: OperationalPreviewRoute = {
  selection: {
    kind: "reservation",
    propertyId,
    reservationId,
    inventoryUnitId: unitId,
    roomId,
    date: "2026-09-02",
  },
  origin: {
    surface: "calendar",
    propertyId,
    date: "2026-09-02",
    day: "2026-09-02",
  },
};

describe("operational preview route", () => {
  it("round-trips Today structural room/filter context without search or changing literal trigger keys", () => {
    const value: OperationalPreviewRoute = { selection: { kind: "reservation", propertyId, reservationId, inventoryUnitId: unitId, roomId }, origin: { surface: "today", propertyId, view: "visual", rooms: { roomId, filter: "attention" } } };
    const active = withOperationalPreviewRoute(new URLSearchParams(), value);
    expect(parseOperationalPreviewRoute(active)).toEqual(value);
    expect(parseOperationalReturnRoute(withOperationalReturnRoute(new URLSearchParams(), value))).toEqual(value);
    const returned = new URL(operationalOriginHref(value), "https://example.test");
    expect(readTodayRoomsContext(returned.searchParams)).toEqual({ valid: true, context: { roomId, filter: "attention" } });
    expect(operationalOriginMatchesLocation(value.origin, "/", returned.searchParams)).toBe(true);
    returned.searchParams.set("todayFilter", "blocked"); expect(operationalOriginMatchesLocation(value.origin, "/", returned.searchParams)).toBe(false);
    expect(operationalPreviewTriggerKey(value)).toBe(`today:visual:reservation:${reservationId}:${unitId}`);
    expect(withoutOperationalPreviewRoute(active).toString()).toBe("");
  });
  it.each(["operations", "visual"] as const)("normalizes only valid legacy Today %s reservation dates in both namespaces", view => {
    const legacy: OperationalPreviewRoute = { ...route, selection: { ...route.selection, bedId: unitId }, origin: { surface: "today", propertyId, view } };
    const canonical = { ...legacy, selection: { ...legacy.selection, date: undefined } };
    for (const [prefix, write, parse] of [
      ["op", withOperationalPreviewRoute, parseOperationalPreviewRoute],
      ["opReturn", withOperationalReturnRoute, parseOperationalReturnRoute],
    ] as const) {
      const params = write(new URLSearchParams(), legacy);
      expect(parse(params)).toEqual(canonical);
      expect(write(new URLSearchParams(), parse(params)!).has(`${prefix}Date`)).toBe(false);
      expect(operationalPreviewTriggerKey(parse(params)!)).toBe(operationalPreviewTriggerKey(legacy));
      params.delete(`${prefix}Date`); expect(parse(params)).toEqual(canonical);
      for (const invalid of ["", "2026-02-30", "not-a-date"]) {
        params.set(`${prefix}Date`, invalid); expect(parse(params)).toBeNull();
      }
    }
  });
  it("retains Calendar reservation date association and rejects malformed explicit dates", () => {
    for (const [prefix, write, parse] of [
      ["op", withOperationalPreviewRoute, parseOperationalPreviewRoute],
      ["opReturn", withOperationalReturnRoute, parseOperationalReturnRoute],
    ] as const) {
      const params = write(new URLSearchParams(), route);
      expect(parse(params)).toEqual(route);
      params.set(`${prefix}Date`, "2026-02-30"); expect(parse(params)).toBeNull();
    }
  });
  it.each(["opFromTodayRoom", "opFromTodayFilter"])("fails closed on duplicate or invalid structural %s", key => {
    const value: OperationalPreviewRoute = { ...route, origin: { surface: "today", propertyId, view: "visual", rooms: { roomId, filter: "attention" } } };
    const active = withOperationalPreviewRoute(new URLSearchParams(), value); active.append(key, active.get(key)!);
    expect(parseOperationalPreviewRoute(active)).toBeNull(); active.set(key, "private guest name"); expect(parseOperationalPreviewRoute(active)).toBeNull();
    expect(parseOperationalPreviewRoute(withOperationalPreviewRoute(new URLSearchParams(), { ...route, origin: { surface: "today", propertyId, view: "operations", rooms: { roomId } } }))).toBeNull();
  });
  const clickedDay = "2026-09-05";
  const selections: [string, OperationalPreviewRoute["selection"], string][] = [
    ["assigned reservation", { ...route.selection, date: clickedDay }, `reservation:${reservationId}:${unitId}`],
    ["unassigned reservation", { kind: "reservation", propertyId, reservationId, date: clickedDay }, `reservation:${reservationId}:none`],
    ["block ID", { kind: "inventoryBlock", propertyId, blockGroupId: roomId, blockId: reservationId, inventoryUnitId: unitId, date: clickedDay }, `inventoryBlock:${reservationId}:${unitId}`],
    ["block group fallback", { kind: "inventoryBlock", propertyId, blockGroupId: roomId, date: clickedDay }, `inventoryBlock:${roomId}:none`],
    ["inventory unit", { kind: "inventoryUnit", propertyId, inventoryUnitId: unitId, roomId, date: clickedDay, observedState: "unknown" }, `inventoryUnit:${unitId}`],
  ];
  it.each(selections)("keys the clicked %s day separately from source dates and viewport", (_name, selection, entity) => {
    const value: OperationalPreviewRoute = { selection, origin: { surface: "calendar", propertyId, date: "2026-09-12", day: "2026-09-08", viewport: { date: "2026-09-02", offset: 152 } } };
    const active = withOperationalPreviewRoute(new URLSearchParams(`property=${propertyId}&date=2026-09-12&day=2026-09-08&calViewDate=2026-09-02&calViewOffset=152`), value);
    const parsed = parseOperationalPreviewRoute(active)!;
    expect(operationalPreviewTriggerKey(parsed)).toBe(`calendar:2026-09-05:${entity}`);
    expect(parsed).toEqual(value);
    expect(parseOperationalReturnRoute(withOperationalReturnRoute(new URLSearchParams(), value))).toEqual(value);
    const returned = new URL(operationalOriginHref(value), "https://example.test").searchParams;
    expect(returned.get("date")).toBe("2026-09-12"); expect(returned.get("day")).toBe("2026-09-08");
    expect(returned.get("calViewDate")).toBe("2026-09-02"); expect(returned.get("calViewOffset")).toBe("152");
    expect(returned.get("opDate")).toBe(clickedDay);
    expect(withOperationalPreviewRoute(withoutOperationalPreviewRoute(active), parsed).toString()).toBe(active.toString());
    expect(operationalPreviewTriggerKey({ ...value, origin: { ...value.origin, day: clickedDay } as typeof value.origin })).toBe(`calendar:2026-09-05:${entity}`);
  });
  it.each(selections.filter(([, selection]) => selection.kind !== "inventoryUnit"))("retains the legacy source-day fallback for %s without a selection date", (_name, selection, entity) => {
    const legacy = { ...selection, date: undefined } as OperationalPreviewRoute["selection"];
    const value: OperationalPreviewRoute = { selection: legacy, origin: { surface: "calendar", propertyId, date: "2026-09-12", day: "2026-09-08" } };
    const parsed = parseOperationalPreviewRoute(withOperationalPreviewRoute(new URLSearchParams(), value))!;
    expect(parsed.selection.date).toBeUndefined();
    expect(operationalPreviewTriggerKey(parsed)).toBe(`calendar:2026-09-08:${entity}`);
  });
  it.each(["operations", "visual"] as const)("keeps Today %s keys view-based for every selection kind", view => {
    for (const [, selection, entity] of selections) {
      const value: OperationalPreviewRoute = { selection, origin: { surface: "today", propertyId, view } };
      expect(operationalPreviewTriggerKey(value)).toBe(`today:${view}:${entity}`);
      expect(operationalPreviewTriggerKey({ ...value, selection: { ...selection, date: "2026-09-09" } })).toBe(`today:${view}:${entity}`);
    }
  });
  it("round-trips a clicked day outside the source week without changing the source/action date contract", () => {
    const value: OperationalPreviewRoute = { ...route, selection: { ...route.selection, date: "2026-09-03" }, origin: { surface: "calendar", propertyId, date: "2026-09-12", day: "2026-09-08", viewport: { date: "2026-09-02", offset: 946 } } };
    expect(parseOperationalPreviewRoute(withOperationalPreviewRoute(new URLSearchParams(), value))).toEqual(value);
    expect(parseOperationalReturnRoute(withOperationalReturnRoute(new URLSearchParams(), value))).toEqual(value);
    const params = new URL(operationalOriginHref(value), "https://example.test").searchParams;
    expect(params.get("date")).toBe("2026-09-12"); expect(params.get("day")).toBe("2026-09-08"); expect(params.get("opDate")).toBe("2026-09-03");
    // Source preservation does not weaken malformed-date or property checks.
    params.set("opFromDay", "2026-02-30"); expect(parseOperationalPreviewRoute(params)).toBeNull();
  });
  it("carries strict viewport metadata through active and return namespaces without changing preview identity", () => {
    const value: OperationalPreviewRoute = { ...route, origin: { surface: "calendar", propertyId, date: "2026-10-08", day: "2026-10-08", viewport: { date: "2026-10-06", offset: 375 } } };
    const active = withOperationalPreviewRoute(new URLSearchParams(), value);
    expect(parseOperationalPreviewRoute(active)).toEqual(value);
    expect(parseOperationalReturnRoute(withOperationalReturnRoute(new URLSearchParams(), value))).toEqual(value);
    const back = new URL(operationalOriginHref(value), "https://example.test");
    expect(back.searchParams.get("calViewDate")).toBe("2026-10-06");
    expect(operationalPreviewTriggerKey(value)).toBe(operationalPreviewTriggerKey({ ...value, origin: { ...value.origin, viewport: { date: "2026-10-05", offset: 0 } } as typeof value.origin }));
    active.append("opFromViewportOffset", "375"); expect(parseOperationalPreviewRoute(active)).toBeNull();
    expect(withoutOperationalPreviewRoute(active).toString()).toBe("");
    const today = withOperationalPreviewRoute(new URLSearchParams(), { ...route, origin: { surface: "today", propertyId, view: "visual" } });
    today.set("opFromViewportDate", "2026-10-08"); today.set("opFromViewportOffset", "0");
    expect(parseOperationalPreviewRoute(today)).toBeNull();
  });
  it("round-trips a scoped selection while preserving unrelated route state", () => {
    const params = withOperationalPreviewRoute(new URLSearchParams("date=2026-09-01&filter=open"), route);

    expect(params.get("date")).toBe("2026-09-01");
    expect(params.get("filter")).toBe("open");
    expect(parseOperationalPreviewRoute(params)).toEqual(route);
  });

  it("removes only active preview fields", () => {
    const params = withOperationalPreviewRoute(new URLSearchParams("view=visual"), route);
    const cleared = withoutOperationalPreviewRoute(params);

    expect(cleared.toString()).toBe("view=visual");
  });

  it("keeps return provenance separate from an active destination preview", () => {
    const params = withOperationalReturnRoute(
      new URLSearchParams(`reservation=${reservationId}`),
      route,
    );

    expect(parseOperationalPreviewRoute(params)).toBeNull();
    expect(parseOperationalReturnRoute(params)).toEqual(route);
    expect(params.get("reservation")).toBe(reservationId);
  });

  it("builds only allowlisted Calendar and Today origins", () => {
    expect(operationalOriginHref(route)).toContain("/calendar?");
    expect(operationalOriginHref(route)).toContain("date=2026-09-02");
    expect(operationalOriginHref(route)).toContain("op=reservation");

    const today: OperationalPreviewRoute = {
      ...route,
      origin: { surface: "today", propertyId, view: "visual" },
    };
    expect(operationalOriginHref(today)).toMatch(/^\/\?view=visual&op=reservation/);
    expect(operationalOriginMatchesLocation(today.origin, "/", new URLSearchParams("view=visual"))).toBe(true);
    expect(operationalOriginMatchesLocation(today.origin, "/", new URLSearchParams())).toBe(false);
    expect(operationalOriginMatchesLocation(route.origin, "/calendar", new URLSearchParams("date=2026-09-02&day=2026-09-02"))).toBe(true);
    expect(operationalOriginMatchesLocation(route.origin, "/calendar", new URLSearchParams("date=2026-09-09"))).toBe(false);
  });

  it("rejects malformed, arbitrary, and cross-property provenance", () => {
    const malformed = new URLSearchParams(
      "op=reservation&opProperty=not-an-id&opReservation=https%3A%2F%2Fevil.example&opFrom=calendar&opFromDate=2026-09-02&opFromDay=2026-09-02",
    );
    expect(parseOperationalPreviewRoute(malformed)).toBeNull();
    expect(hasOperationalPreviewRouteParams(malformed)).toBe(true);
    expect(isOperationalRouteForProperty(route, roomId)).toBe(false);
  });

  it("distinguishes malformed active preview fields from destination return provenance", () => {
    expect(hasOperationalPreviewRouteParams(new URLSearchParams("view=visual"))).toBe(false);
    expect(hasOperationalPreviewRouteParams(new URLSearchParams("op=not-a-kind&keep=this"))).toBe(true);
    expect(hasOperationalPreviewRouteParams(new URLSearchParams("opReturn=reservation"))).toBe(false);
  });

  it("round-trips inventory-unit state without accepting invented state values", () => {
    const unitRoute: OperationalPreviewRoute = {
      selection: {
        kind: "inventoryUnit",
        propertyId,
        inventoryUnitId: unitId,
        roomId,
        date: "2026-09-02",
        observedState: "available",
      },
      origin: { surface: "today", propertyId, view: "visual" },
    };
    const params = withOperationalPreviewRoute(new URLSearchParams(), unitRoute);
    expect(parseOperationalPreviewRoute(params)).toEqual(unitRoute);

    params.set("opState", "cleaning");
    expect(parseOperationalPreviewRoute(params)).toBeNull();
  });
});
