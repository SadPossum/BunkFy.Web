import { describe, expect, it } from "vitest";
import { shiftDateKey } from "../src/app/propertyDate";
import { CALENDAR_DAY_WIDTH, calendarActionDate, calendarDateDistance, calendarDayCoverage, calendarInitialWindow, calendarReconciliationNeeded, calendarSegmentFor, calendarViewportAt, calendarViewportScroll, calendarWindowDays, extendCalendarWindow, mergeCalendarSegments, readCalendarViewport, writeCalendarViewport, type CalendarCoverage } from "../src/features/calendar/calendarWindow";
import type { ManualBlock, ReservationListItem } from "../src/api/types";

const reservation = (changes: Partial<ReservationListItem> = {}): ReservationListItem => ({ reservationId: "stay", propertyId: "property", arrival: "2026-08-01", departure: "2026-11-01", inventoryUnitIds: ["unit"], inventoryUnitCount: 1, holdsInventory: true, status: 2, primaryGuestName: "Practice", guestCount: 1, sourceKind: 1, ...changes } as ReservationListItem);
const block = (id = "block", unit = "unit"): ManualBlock => ({ blockId: id, blockGroupId: "same-group", inventoryUnitId: unit, propertyId: "property", arrival: "2026-08-01", departure: "2026-11-01", version: 1, status: 1, reason: "Practice" } as ManualBlock);

describe("bounded Calendar window", () => {
  it("reloads both the viewport and adjacent action owner before freezing, prioritizing the owner over a distant preference", () => {
    const segment = calendarSegmentFor("2026-09-08");
    const nextDay = segment.to;
    expect(calendarInitialWindow(shiftDateKey(segment.to, -1), nextDay)).toEqual([segment, calendarSegmentFor(nextDay)]);
    expect(calendarInitialWindow("2020-01-01", nextDay)).toEqual([calendarSegmentFor(nextDay)]);
  });
  it.each(["2026-09-06", "2024-02-29", "2025-12-31", "1970-01-01"])("uses deterministic non-overlapping 21-day ownership at %s", (day) => {
    const segment = calendarSegmentFor(day);
    expect(segment.from <= day && day < segment.to).toBe(true);
    expect(calendarDateDistance(segment.from, segment.to)).toBe(21);
    expect(calendarDateDistance(segment.reservationFrom, segment.to)).toBe(22);
    expect(calendarSegmentFor(shiftDateKey(segment.to, -1))).toEqual(segment);
    expect(calendarSegmentFor(segment.to).from).toBe(segment.to);
  });
  it("caps forward/backward DOM windows at three segments and leases the exact owned window", () => {
    let segments = [calendarSegmentFor("2026-09-08")];
    for (const direction of [1, 1, 1, 1, -1, -1, -1, -1] as const) {
      const before = segments;
      expect(extendCalendarWindow(segments, direction, true)).toEqual(before);
      segments = extendCalendarWindow(segments, direction, false);
      expect(segments.length).toBeLessThanOrEqual(3);
      expect(calendarWindowDays(segments)).toHaveLength(segments.length * 21);
      segments.slice(1).forEach((segment, index) => expect(segment.from).toBe(segments[index].to));
    }
  });
  it("compensates prepend and eviction without changing the date/fraction under the pinned inventory", () => {
    const first = calendarSegmentFor("2026-09-08");
    const viewport = calendarViewportAt(first.from, 13.375 * CALENDAR_DAY_WIDTH);
    const previous = calendarSegmentFor(shiftDateKey(first.from, -1));
    expect(calendarViewportScroll(previous.from, viewport)).toBe((21 + 13.375) * CALENDAR_DAY_WIDTH);
    expect(calendarViewportAt(previous.from, calendarViewportScroll(previous.from, viewport))).toEqual(viewport);
    expect(calendarViewportScroll(first.from, viewport)).toBe(13.375 * CALENDAR_DAY_WIDTH);
  });
  it("retains the legacy business week and canonicalizes only an explicit extended-day action", () => {
    expect(calendarActionDate("2026-09-12", "2026-09-08")).toBe("2026-09-12");
    expect(calendarActionDate("2026-09-12", "2026-10-08")).toBe("2026-10-08");
  });
  it("does not borrow truth from a neighbouring segment or from an uncovered selected day", () => {
    const coverage = [{ from: "2026-09-01", to: "2026-09-22", current: true }, { from: "2026-09-22", to: "2026-10-13", current: false }] as CalendarCoverage[];
    expect(calendarDayCoverage(coverage, "2026-09-21")?.current).toBe(true);
    expect(calendarDayCoverage(coverage, "2026-09-22")?.current).toBe(false);
    expect(calendarDayCoverage(coverage, "2026-08-31")).toBeUndefined();
  });
});

describe("viewport schema and conflicting snapshots", () => {
  it.each(["calView", "opFromViewport", "opReturnFromViewport", "surfaceReturnViewport"])("roundtrips only the date/fraction pair under %s", (prefix) => {
    const params = new URLSearchParams("untouched=1");
    writeCalendarViewport(params, { date: "2026-10-08", offset: 375 }, prefix);
    expect(readCalendarViewport(params, prefix)).toEqual({ valid: true, viewport: { date: "2026-10-08", offset: 375 } });
    expect(params.get("untouched")).toBe("1");
    params.append(`${prefix}Offset`, "375"); expect(readCalendarViewport(params, prefix).valid).toBe(false);
    writeCalendarViewport(params, undefined, prefix); expect(params.toString()).toBe("untouched=1");
  });
  it.each(["", "-1", "1000", "1.5", "NaN", "Infinity", "1e2", "01"])("rejects malformed offset %s without coercion", (offset) => {
    expect(readCalendarViewport(new URLSearchParams({ calViewDate: "2026-09-08", calViewOffset: offset })).valid).toBe(false);
  });
  it("rejects partial, unknown and impossible viewport values", () => {
    for (const query of ["calViewDate=2026-09-08", "calViewOffset=0", "calViewDate=2026-02-30&calViewOffset=0", "calViewDate=2026-09-08&calViewOffset=0&calViewExtra=1"]) expect(readCalendarViewport(new URLSearchParams(query)).valid).toBe(false);
  });
  it("deduplicates long identical intervals and never collapses distinct blocks in one group", () => {
    const first = calendarSegmentFor("2026-09-08"), next = calendarSegmentFor(first.to);
    const merged = mergeCalendarSegments([first, next].map((segment) => ({ segment, reservations: [reservation(), reservation()], blocks: [block(), block("second", "other-unit")] })));
    expect(merged.reservations).toHaveLength(1); expect(merged.blocks).toHaveLength(2); expect(merged.conflicts.size).toBe(0);
  });
  it.each(["status", "arrival", "departure", "holdsInventory", "inventoryUnitIds", "primaryGuestName", "guestCount"] as const)("withholds differing versionless %s independent of response order", (field) => {
    const changes = { status: 4, arrival: "2026-08-02", departure: "2026-11-02", holdsInventory: false, inventoryUnitIds: ["other"], primaryGuestName: "Other", guestCount: 2 };
    const first = calendarSegmentFor("2026-09-08"), next = calendarSegmentFor(first.to);
    const entries = [{ segment: first, reservations: [reservation()], blocks: [] }, { segment: next, reservations: [reservation({ [field]: changes[field] })], blocks: [] }];
    for (const snapshots of [entries, [...entries].reverse()]) {
      const merged = mergeCalendarSegments(snapshots); expect(merged.reservations).toEqual([]); expect(merged.conflictIds).toEqual(["reservation:stay"]); expect([...merged.conflicts].sort()).toEqual([first.from, next.from]);
    }
  });
  it("treats a missing record in another complete overlapping owner as unconfirmed, not Free", () => {
    const first = calendarSegmentFor("2026-09-08"), next = calendarSegmentFor(first.to);
    const merged = mergeCalendarSegments([{ segment: first, reservations: [reservation()], blocks: [], reservationsCurrent: true }, { segment: next, reservations: [], blocks: [], reservationsCurrent: true }]);
    expect(merged.conflicts.size).toBe(2); expect(merged.reservations).toEqual([]);
  });
  it("does not assign a leading context-only day to the fetched display segment", () => {
    const segment = calendarSegmentFor("2026-09-08");
    const items = [reservation({ departure: segment.reservationFrom }), reservation({ reservationId: "departure", departure: segment.from })];
    expect(mergeCalendarSegments([{ segment, reservations: items, blocks: [] }]).reservations.map((item) => item.reservationId)).toEqual(["departure"]);
  });
  it("allows at most one automatic reconciliation per stationary generation", () => {
    expect(calendarReconciliationNeeded("owner:window", "", true, false, true)).toBe(true);
    expect(calendarReconciliationNeeded("owner:window", "owner:window", true, false, true)).toBe(false);
    expect(calendarReconciliationNeeded("owner:window", "", true, true, true)).toBe(false);
    expect(calendarReconciliationNeeded("owner:window", "", true, false, false)).toBe(false);
    expect(calendarReconciliationNeeded("new-owner:window", "owner:window", true, false, true)).toBe(true);
  });
});
