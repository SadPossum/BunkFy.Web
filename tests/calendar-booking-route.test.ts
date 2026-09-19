import { describe, expect, it } from "vitest";
import type { InventoryAvailabilityResponse, RoomInventory, RoomInventoryChangeImpact } from "../src/api/types";
import {
  calendarBookingHref, calendarBookingRangeValid, calendarBookingReturnHref,
  parseCalendarBookingContext, parseCalendarBookingFocus,
  hasCalendarBookingContext,
  reservationAvailabilityMatchesRange, reservationRoomsMatchProperty, resolveCalendarBookingTarget,
  reservationSelectionMatchesRooms,
  type CalendarBookingContext,
} from "../src/features/calendar/calendarBookingRoute";
import { affectedSalesReservationsUrl } from "../src/features/inventory/salesModeRoutes";
import { parseOperationalSurfaceReturn, withOperationalSurfaceReturn } from "../src/features/operational-preview/operationalSurfaceReturn";

const propertyId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const inventoryUnitId = "33333333-3333-4333-8333-333333333333";
const bedId = "44444444-4444-4444-8444-444444444444";
const context: CalendarBookingContext = {
  origin: { surface: "calendar", propertyId, date: "2026-09-12", day: "2026-09-11" },
  target: { roomId, inventoryUnitId, bedId, arrival: "2026-09-11", departure: "2026-09-15" },
};
const params = (href: string) => new URL(href, "http://localhost").searchParams;
const unit = { propertyId, roomId, inventoryUnitId, bedId, kind: "bed" as const, label: "104-D", isSellable: true, isTopologyActive: true };
const room: RoomInventory = { propertyId, roomId, roomName: "Dorm 104", buildingLabel: null, floorLabel: null, salesMode: "bedLevel", version: 1, units: [unit] };
const response: InventoryAvailabilityResponse = { propertyId, arrival: "2026-09-11", departure: "2026-09-15", units: [{ unit, isAvailable: true, activeBlockIds: [], activeAllocationIds: [] }] };

describe("Calendar booking context", () => {
  it("roundtrips an extended-day bed through booking, result and exact viewport/focus without loosening legacy week validation", () => {
    const value: CalendarBookingContext = { origin: { ...context.origin, date: "2026-10-08", day: "2026-10-08", viewport: { date: "2026-10-06", offset: 375 } }, target: { ...context.target!, arrival: "2026-10-08", departure: "2026-10-12" } };
    expect(parseCalendarBookingContext(params(calendarBookingHref(value)))).toEqual(value);
    const back = params(calendarBookingReturnHref(value));
    expect(back.get("calViewDate")).toBe("2026-10-06"); expect(back.get("calViewOffset")).toBe("375");
    expect(parseCalendarBookingFocus(back, propertyId)).toEqual({ unitId: inventoryUnitId, roomId });
    const malformed = params(calendarBookingHref(value)); malformed.append("surfaceReturnViewportOffset", "375");
    expect(parseCalendarBookingContext(malformed)).toBeNull();
    back.delete("calViewOffset"); expect(parseCalendarBookingFocus(back, propertyId)).toBeNull();
    const legacyMismatch = params(calendarBookingHref(value)); legacyMismatch.set("surfaceReturnDate", "2026-09-12");
    expect(parseCalendarBookingContext(legacyMismatch)).toBeNull();
  });
  it("does not intercept the existing Calendar to Spaces sales-impact reservation journey", () => {
    const origin = withOperationalSurfaceReturn(new URLSearchParams({ property: propertyId }), context.origin);
    const href = affectedSalesReservationsUrl({ propertyId, affectedReservationIds: [bedId] } as RoomInventoryChangeImpact, origin, true)!;
    expect(hasCalendarBookingContext(params(href))).toBe(false);
    expect(parseCalendarBookingContext(params(href))).toBeNull();
    expect(parseOperationalSurfaceReturn(params(href))).toEqual(context.origin);
    expect(params(href).get("affected")).toBe(bedId);
  });
  it.each([
    ["2026-09-06", "2026-09-08"], ["2026-09-11", "2026-09-15"],
  ])("carries exact bed and genuine %s–%s dates, without using defaults", (arrival, departure) => {
    const value = { ...context, origin: { ...context.origin, date: arrival, day: arrival }, target: { ...context.target!, arrival, departure } };
    expect(parseCalendarBookingContext(params(calendarBookingHref(value)))).toEqual(value);
  });
  it("keeps page-level creation unprefilled but returns to the exact Calendar day", () => {
    const value = { origin: context.origin };
    expect(parseCalendarBookingContext(params(calendarBookingHref(value)))).toEqual(value);
    expect(params(calendarBookingHref(value)).has("bookingUnit")).toBe(false);
    expect(parseCalendarBookingFocus(params(calendarBookingReturnHref(value)), propertyId)).toEqual({ unitId: null, roomId: null });
  });
  it("retains room-only inventory and returns to the originating bed after creation", () => {
    const value = { ...context, target: { roomId, inventoryUnitId, arrival: "2026-09-11", departure: "2026-09-12" } };
    expect(parseCalendarBookingContext(params(calendarBookingHref(value)))).toEqual(value);
    const detail = params(calendarBookingHref(context));
    detail.delete("new"); detail.set("reservation", "55555555-5555-4555-8555-555555555555");
    expect(parseCalendarBookingContext(detail)).toEqual(context);
    const back = params(calendarBookingReturnHref(context));
    expect(back.get("date")).toBe("2026-09-12");
    expect(back.get("day")).toBe("2026-09-11");
    expect(parseCalendarBookingFocus(back, propertyId)).toEqual({ unitId: inventoryUnitId, roomId });
  });
  it.each([
    ["bookingArrival", "2026-02-30"], ["bookingDeparture", "2026-09-10"],
    ["bookingRoom", "missing"], ["bookingBed", ""], ["bookingUnit", "https://outside.test"],
    ["property", roomId], ["surfaceReturnProperty", roomId], ["bookingArrival", "2026-09-10"],
    ["surfaceReturnDay", "2026-10-01"], ["surfaceReturn", "today"],
    ["bookingExtra", "1"], ["bookingEntry", "unknown"], ["opReturn", "reservation"], ["spacesReturn", "layout"],
    ["returnTo", "https://outside.test"], ["unknown", "1"], ["new", "yes"],
  ])("rejects malformed, cross-property, mixed or unknown %s", (key, value) => {
    const query = params(calendarBookingHref(context)); query.set(key, value);
    expect(parseCalendarBookingContext(query)).toBeNull();
  });
  it.each(["property", "bookingRoom", "bookingUnit", "bookingBed", "bookingArrival", "bookingDeparture", "surfaceReturnDate", "new"])("rejects duplicate %s even when values match", (key) => {
    const query = params(calendarBookingHref(context)); query.append(key, query.get(key)!);
    expect(parseCalendarBookingContext(query)).toBeNull();
  });
  it("rejects incomplete targets and mixed return-focus coordinates", () => {
    const query = params(calendarBookingHref(context)); query.delete("bookingUnit");
    expect(parseCalendarBookingContext(query)).toBeNull();
    const back = params(calendarBookingReturnHref(context));
    back.set("bookOther", "1");
    expect(parseCalendarBookingFocus(back, propertyId)).toBeNull();
    expect(parseCalendarBookingFocus(params(calendarBookingReturnHref(context)), roomId)).toBeNull();
  });
  it.each([ ["2026-09-11", "2026-09-11"], ["2026-02-30", "2026-03-03"], ["bad", "2026-09-12"] ])("requires a real half-open range %s/%s", (arrival, departure) => {
    expect(calendarBookingRangeValid(arrival, departure)).toBe(false);
  });
});

describe("current exact Calendar booking evidence", () => {
  it("requires the response's exact property, range and unique unit identities", () => {
    expect(reservationAvailabilityMatchesRange(response, propertyId, response.arrival, response.departure)).toBe(true);
    for (const changed of [undefined, { ...response, propertyId: roomId }, { ...response, departure: "2026-09-16" }, { ...response, units: [...response.units, ...response.units] }, { ...response, units: [{ ...response.units[0]!, unit: { ...unit, propertyId: roomId } }] }]) {
      expect(reservationAvailabilityMatchesRange(changed, propertyId, response.arrival, response.departure)).toBe(false);
    }
  });
  it("requires current room and bed membership and refuses substitution", () => {
    expect(reservationRoomsMatchProperty([room], propertyId)).toBe(true);
    expect(reservationRoomsMatchProperty([{ ...room, units: [{ ...unit, roomId: propertyId }] }], propertyId)).toBe(false);
    expect(resolveCalendarBookingTarget(context.target!, [room], response).available).toBe(true);
    for (const rooms of [[], [{ ...room, units: [{ ...unit, bedId: roomId }] }], [{ ...room, units: [{ ...unit, isSellable: false }] }], [{ ...room, units: [{ ...unit, isTopologyActive: false }] }]]) {
      expect(resolveCalendarBookingTarget(context.target!, rooms, response).available).toBe(false);
    }
    expect(resolveCalendarBookingTarget(context.target!, [room], { ...response, units: [{ ...response.units[0]!, isAvailable: false, activeBlockIds: ["hold"] }] }).available).toBe(false);
    expect(resolveCalendarBookingTarget(context.target!, [room], undefined).available).toBe(false);
    expect(reservationSelectionMatchesRooms([inventoryUnitId], [room], response)).toBe(true);
    expect(reservationSelectionMatchesRooms([inventoryUnitId], [], response)).toBe(false);
    expect(reservationSelectionMatchesRooms([inventoryUnitId], [{ ...room, units: [{ ...unit, isSellable: false }] }], response)).toBe(false);
    expect(reservationSelectionMatchesRooms([inventoryUnitId], [room], { ...response, units: [{ ...response.units[0]!, unit: { ...unit, bedId: roomId } }] })).toBe(false);
  });
});
