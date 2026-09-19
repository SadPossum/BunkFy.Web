import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ReservationListItem } from "../src/api/types";
import {
  WEEK_WINDOW_DAYS,
  addCalendarDays,
  calendarDayMovementCounts,
  calendarSelectedDay,
  occupiesCalendarDay,
  reservationCalendarEventKind,
  reservationMovementLabel,
  reservationStayPhaseLabel,
  reservationsForCalendarDay,
  scheduleSpan,
  weekWindow,
} from "../src/features/calendar/calendarModel";
import { formatCompactDate, parseDateKey, toDateKey } from "../src/components/ui/DatePicker";

describe("calendar model", () => {
  it.each([
    [1, "pendingAllocation", "Requested — not held"],
    [2, "confirmed", "Stay scheduled"],
    [3, "allocationRejected", "Requested — not held"],
    [4, "cancellationPending", "Cancellation pending"],
    [5, "cancelled", "Cancelled"],
    [6, "checkedIn", "In house"],
    [7, "noShowPending", "No-show pending"],
    [8, "noShow", "No-show"],
    [9, "checkoutPending", "Checkout pending"],
    [10, "checkedOut", "Completed · scheduled"],
  ] as const)("uses recorded lifecycle for interior status %s / %s", (numeric, named, label) => {
    for (const status of [numeric, named]) {
      const stay = reservation(status, "2026-09-11", "2026-09-14");
      expect(reservationMovementLabel(stay, "2026-09-13")).toBeNull();
      expect(reservationStayPhaseLabel(stay)).toBe(label);
      expect(reservationStayPhaseLabel({ ...stay, holdsInventory: !stay.holdsInventory })).toBe(label);
    }
  });

  it("does not infer physical presence for unknown status or change scheduled boundaries", () => {
    const stay = reservation("confirmed", "2026-09-11", "2026-09-14");
    expect(reservationMovementLabel(stay, stay.arrival)).toBe("Arrives");
    expect(reservationMovementLabel(stay, stay.departure)).toBe("Departs");
    expect(reservationMovementLabel({ ...stay, departure: stay.arrival }, stay.arrival)).toBe("Arrives and departs");
    expect(reservationStayPhaseLabel({ ...stay, status: 99 as ReservationListItem["status"] })).toBe("Status unknown");
  });

  it.each(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"])(
    "selects the exact date-only deep link %s, not its week start",
    (key) => {
      const anchor = parseDateKey(key)!;
      expect(calendarSelectedDay(anchor, null)).toBe(key);
      expect(calendarSelectedDay(addCalendarDays(anchor, 7), null))
        .toBe(toDateKey(addCalendarDays(anchor, 7)));
      expect(calendarSelectedDay(addCalendarDays(anchor, -7), null))
        .toBe(toDateKey(addCalendarDays(anchor, -7)));
    },
  );

  it("preserves an explicit valid in-week day from an operational preview origin", () => {
    expect(calendarSelectedDay(new Date(2026, 8, 6), "2026-09-03")).toBe("2026-09-03");
    expect(calendarSelectedDay(new Date(2026, 8, 6), "2026-08-31")).toBe("2026-08-31");
  });

  it.each(["", "bad-date", "2026-02-30", "2026-08-30", "2026-09-07"])(
    "falls back to the exact anchor for invalid or out-of-week day %s",
    (day) => expect(calendarSelectedDay(new Date(2026, 8, 6), day)).toBe("2026-09-06"),
  );

  it("builds one bounded Monday-to-Sunday operating week", () => {
    const window = weekWindow(new Date(2026, 7, 6));

    expect(window.days).toHaveLength(WEEK_WINDOW_DAYS);
    expect(window.from).toBe("2026-08-03");
    expect(window.to).toBe("2026-08-10");
  });

  it("clips half-open stays to visible tape-chart columns", () => {
    expect(scheduleSpan("2026-08-01", "2026-08-05", "2026-08-03", "2026-08-10"))
      .toEqual({ start: 0, span: 2 });
    expect(scheduleSpan("2026-08-08", "2026-08-13", "2026-08-03", "2026-08-10"))
      .toEqual({ start: 5, span: 2 });
    expect(scheduleSpan("2026-08-10", "2026-08-12", "2026-08-03", "2026-08-10"))
      .toBeNull();
    expect(occupiesCalendarDay("2026-08-03", "2026-08-06", "2026-08-05")).toBe(true);
    expect(occupiesCalendarDay("2026-08-03", "2026-08-06", "2026-08-06")).toBe(false);
  });

  it("distinguishes arrivals, in-house stays, departures, and attention", () => {
    const confirmed = reservation("confirmed", "2026-08-03", "2026-08-06");

    expect(reservationCalendarEventKind(confirmed, "2026-08-03")).toBe("arrival");
    expect(reservationCalendarEventKind(confirmed, "2026-08-04")).toBe("stay");
    expect(reservationCalendarEventKind(confirmed, "2026-08-06")).toBe("departure");
    expect(reservationCalendarEventKind(
      reservation("checkoutPending", "2026-08-03", "2026-08-06"),
      "2026-08-06",
    )).toBe("attention");

    expect(calendarDayMovementCounts([
      confirmed,
      reservation("checkoutPending", "2026-08-03", "2026-08-06"),
    ], "2026-08-06")).toEqual({ arrivals: 0, departures: 2, attention: 1 });
  });

  it("includes the departure day and orders exceptions first", () => {
    const ordinary = reservation("confirmed", "2026-08-03", "2026-08-06", "Zulu");
    const attention = reservation("allocationRejected", "2026-08-06", "2026-08-07", "Alpha");

    expect(reservationsForCalendarDay([ordinary, attention], "2026-08-06"))
      .toEqual([attention, ordinary]);
    expect(reservationsForCalendarDay([ordinary], "2026-08-07")).toEqual([]);
  });
});

describe("calendar product boundary", () => {
  it("keeps Calendar primary and outside Today's local views", () => {
    const app = source("app/App.tsx");
    const shell = source("components/layout/AppShell.tsx");
    const today = source("features/dashboard/DashboardPage.tsx");

    expect(app).toContain('<Route path="/calendar" element={<CalendarPage />} />');
    expect(shell).toContain('{ to: "/calendar", label: "Calendar"');
    expect(today).toContain('{ value: "operations", label: "Operations"');
    expect(today).toContain('{ value: "visual", label: "Rooms"');
    expect(today).not.toContain('value: "calendar"');
    expect(today).not.toContain("CalendarPage");
  });

  it("keeps localized date navigation legible in the compact calendar toolbar", () => {
    const calendar = source("features/calendar/CalendarPage.tsx");
    const picker = source("components/ui/DatePicker.tsx");

    expect(calendar).toContain("grid-cols-[2.25rem_minmax(0,1fr)_2.25rem]");
    expect(calendar).toContain("compactOnSmallScreens");
    expect(picker).toContain("formatCompactDate(selected)");
    expect(picker).toContain('formatDate(selected, "medium")');
    expect(formatCompactDate(new Date(2026, 8, 2))).toMatch(/2026/);
    expect(calendar).toContain('ariaLabel="Jump timeline to date"');
    expect(calendar).toContain("value={viewport.date}");
    expect(calendar).toContain("parseDateKey(viewport.date) ?? anchor");
  });

  it("uses bounded date columns and a semantic read-only occupancy table", () => {
    const calendar = source("features/calendar/CalendarPage.tsx");
    const week = source("features/calendar/CalendarWeekView.tsx");

    expect(calendar).not.toContain("calendarViews");
    expect(calendar).not.toContain("MonthView");
    expect(calendar).not.toContain("AgendaView");
    expect(calendar).toContain('next.delete("view")');
    expect(week).toContain('max-h-[calc(100vh-18rem)] overflow-auto');
    expect(week).toContain('<table className="min-w-[64rem] table-fixed border-collapse"');
    expect(week).toContain('<thead className="sticky top-0');
    expect(week).toContain('scope="col"');
    expect(week).toContain('scope="row"');
    expect(week).toContain('aria-current={today ? "date" : undefined}');
    expect(week).toContain('aria-pressed={selected}');
    expect(week).toContain('colSpan={days.length}');
    expect(week).toContain('headers={`calendar-unit-${resource.inventoryUnitId}');
    expect(week).toContain('data-calendar-row-label={resource.inventoryUnitId} className="sticky left-0');
    expect(week).toContain('[contain:paint]');
    expect(week).toContain('layoutCalendarIntervals');
    expect(week).toContain('operationalPreviewTriggerKey');
    expect(week).toContain('<LogIn');
    expect(week).toContain('<LogOut');
    expect(week).not.toContain('function ResourceDayCell');
    expect(week).not.toContain('function ReservationCellButton');
    expect(week).not.toContain('slice(0, 2)');
    expect(week).not.toContain('+{hiddenCount} more');
    expect(week).not.toContain('role="grid"');
  });

  it("loads the preceding date so a Monday checkout remains visible without occupying Monday", () => {
    const window = source("features/calendar/calendarWindow.ts");
    const segments = source("features/calendar/useCalendarSegments.ts");
    expect(window).toContain("reservationFrom: shiftDateKey(from, -1)");
    expect(segments).toContain('kind === "reservation" ? segment.reservationFrom : segment.from');
    expect(segments).toContain("request, propertyId, segment.reservationFrom, segment.to, signal");
  });

  it("uses the selected property's date authority for Calendar today state", () => {
    const calendar = source("features/calendar/CalendarPage.tsx");
    const week = source("features/calendar/CalendarWeekView.tsx");

    expect(calendar).toContain('propertyDateKey(selectedProperty?.timeZoneId ?? "")');
    expect(calendar).toContain("setDate(propertyToday, propertyToday)");
    expect(calendar).toContain("todayKey={propertyTodayKey}");
    expect(week).toContain("const today = key === todayKey");
    expect(week).not.toContain("toDateKey(new Date())");
  });

  it("routes incompatible reservation responses through fail-closed authority on Calendar and Today", () => {
    const calendar = source("features/calendar/useCalendarSegments.ts");
    const today = source("features/dashboard/DashboardPage.tsx");

    expect(calendar).toContain("loadReservationCalendarQuery(");
    expect(calendar).toContain("resolveReservationCalendarSource(");
    expect(calendar).toContain("resolved.hasData");
    expect(calendar).toContain("resolved.reservations");
    expect(today).toContain("loadTodayReservationFeed(");
    expect(today).toContain("schedule.data?.propertyId === selectedPropertyId && schedule.data?.localDate === localDate");
    expect(today).toContain("hasData: feedMatches && !readDenied(schedule.error) && !(schedule.error instanceof TodayReservationFeedError)");
    expect(today).toContain("compositeSourceUsable(scheduleSource.state) ? schedule.data?.reservations");
  });

  it("rejects impossible date keys instead of normalizing them into another day", () => {
    expect(parseDateKey("2026-02-29")).toBeUndefined();
    expect(parseDateKey("2026-13-01")).toBeUndefined();
    expect(toDateKey(parseDateKey("2028-02-29")!)).toBe("2028-02-29");
    expect(parseDateKey("0000-01-01")).toBeUndefined();
    expect(toDateKey(parseDateKey("0099-01-01")!)).toBe("0099-01-01");
  });
});

function reservation(
  status: ReservationListItem["status"],
  arrival: string,
  departure: string,
  primaryGuestName = "Guest",
): ReservationListItem {
  return {
    reservationId: `${primaryGuestName}-${status}`,
    propertyId: "property-a",
    primaryGuestName,
    guestCount: 1,
    arrival,
    departure,
    inventoryUnitCount: 1,
    inventoryUnitIds: ["unit-a"],
    holdsInventory: [
      "confirmed",
      "cancellationPending",
      "checkedIn",
      "noShowPending",
      "checkoutPending",
    ].includes(String(status)),
    status,
    sourceKind: "direct",
  } as ReservationListItem;
}

function source(path: string) {
  return readFileSync(join(process.cwd(), "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}
