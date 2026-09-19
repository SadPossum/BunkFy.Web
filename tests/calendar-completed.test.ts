// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReservationListItem, ReservationListResponse, RoomInventory } from "../src/api/types";
import { loadReservationCalendar, resolveReservationCalendarSource } from "../src/features/calendar/calendarApi";
import { calendarDayMovementCounts, isCalendarCompletedReservation, reservationCalendarEventKind, reservationMovementLabel, reservationsForCalendarDay } from "../src/features/calendar/calendarModel";
import { buildCalendarResourceGroups, buildCalendarUnitDayStates, completedReservationsOutsideLayout, indexCalendarSchedule, requestedNotHeldReservations, reservationHoldsInventory, reservationsForUnit, scheduleDayCounts, unmappedReservationCount } from "../src/features/calendar/calendarSchedule";
import { layoutCalendarIntervals } from "../src/features/calendar/calendarIntervals";
import { CalendarWeekView } from "../src/features/calendar/CalendarWeekView";
import { calendarSegmentFor, calendarWindowDays, mergeCalendarSegments } from "../src/features/calendar/calendarWindow";
import { reservationModel } from "../src/features/operational-preview/OperationalPreviewHost";
import { operationalPreviewTriggerKey } from "../src/features/operational-preview/operationalPreviewRoute";

const preview = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({ useOperationalPreview: () => ({ activeRoute: null, openPreview: preview.open }) }));
const segment = calendarSegmentFor("2026-09-12"), day = "2026-09-12";
const room: RoomInventory = { propertyId: "p", roomId: "r", roomName: "Dorm201", salesMode: "bedLevel", units: ["a", "b", "retired"].map(id => ({ propertyId: "p", roomId: "r", bedId: id, inventoryUnitId: id, label: "201-" + id, kind: "bed", isSellable: id !== "retired", isTopologyActive: id !== "retired" })) } as RoomInventory;
const resources = buildCalendarResourceGroups([room]).flatMap(g => g.resources);
const stay = (id: string, fields: Partial<ReservationListItem> = {}): ReservationListItem => ({ reservationId: id, propertyId: "p", primaryGuestName: "Guest " + id, guestCount: 1, arrival: "2026-09-09", departure: "2026-09-16", inventoryUnitIds: ["a"], inventoryUnitCount: 1, holdsInventory: false, status: 10, sourceKind: "direct", ...fields } as ReservationListItem);
const props = (fields: Partial<ComponentProps<typeof CalendarWeekView>> = {}): ComponentProps<typeof CalendarWeekView> => ({ propertyId: "p", dateKey: day, selectedDay: day, todayKey: day, from: segment.from, to: segment.to, days: calendarWindowDays([segment]), viewport: { date: day, offset: 0 }, onSelectDay: vi.fn(), rooms: [room], roomState: "ready", reservations: [stay("history")], blocks: [], availabilityCurrent: true, canOpenSpaces: false, onBook: vi.fn(), bookingEnabled: true, ...fields });
const rendered = (fields: Partial<ComponentProps<typeof CalendarWeekView>> = {}) => new DOMParser().parseFromString(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, props(fields)))), "text/html");
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("completed calendar consumer separation", () => {
  it.each([10, "checkedOut"] as const)("classifies %s before every operational consumer", status => {
    const history = stay("history", { status }), active = stay("active", { status: 2, holdsInventory: true, inventoryUnitIds: ["b"] }), requested = stay("request", { status: 1 });
    const records = [history, active, requested];
    expect(isCalendarCompletedReservation(history)).toBe(true);
    expect(reservationHoldsInventory(history)).toBe(false);
    expect(requestedNotHeldReservations(records)).toEqual([requested]);
    expect(reservationsForUnit(records, "a")).toEqual([]);
    expect(reservationsForCalendarDay([history], history.arrival)).toEqual([]);
    expect(calendarDayMovementCounts([history], history.arrival)).toEqual({ arrivals: 0, departures: 0, attention: 0 });
    expect(calendarDayMovementCounts([history], history.departure)).toEqual({ arrivals: 0, departures: 0, attention: 0 });
    expect(reservationCalendarEventKind(history, history.arrival)).toBe("completed");
    expect(reservationMovementLabel(history, history.departure)).toBeNull();
    expect(scheduleDayCounts(resources, records, [], day)).toEqual({ total: 2, free: 1, occupied: 1, blocked: 0, conflicts: 0 });
    expect(buildCalendarUnitDayStates(resources, records, [], day).get("a")).toEqual({ availability: "free", reservations: [], blocks: [] });
    expect(unmappedReservationCount([stay("missing", { inventoryUnitIds: ["missing"] })], resources)).toBe(0);
    const index = indexCalendarSchedule(resources, records, [], [day]);
    expect(index.get("a")!.completed).toEqual([history]); expect(index.get("a")!.reservations).toEqual([]);
  });
  it("retains every recorded unit and identifies missing/retired/non-sellable and whole-room-after-switch history without reassignment", () => {
    const partial = stay("partial", { inventoryUnitIds: ["a", "b", "retired", "missing", "former-room"] }), empty = stay("empty", { inventoryUnitIds: [] });
    const indexed = indexCalendarSchedule(resources, [partial, empty], [], [day]);
    expect(indexed.get("a")!.completed).toEqual([partial]); expect(indexed.get("b")!.completed).toEqual([partial]); expect(indexed.has("retired")).toBe(false);
    expect(completedReservationsOutsideLayout([partial, empty], resources)).toEqual([partial, empty]);
    expect(scheduleDayCounts(resources, [partial, empty], [], day).free).toBe(2);
  });
  it("does not turn historical overlap into an operational conflict, and keeps active overlap detection", () => {
    const items = [{ key: "old", kind: "history" as const, arrival: "2026-09-09", departure: "2026-09-16" }, { key: "new", kind: "reservation" as const, arrival: day, departure: "2026-09-14" }];
    expect(layoutCalendarIntervals(items, segment.from, segment.to).intervals.every(i => !i.conflict)).toBe(true);
    const conflicts = layoutCalendarIntervals([...items, { ...items[1], key: "block", kind: "block" }], segment.from, segment.to);
    expect(conflicts.intervals.find(i => i.key === "old")!.conflict).toBe(false);
    expect(conflicts.intervals.find(i => i.key === "new")!.conflictWith).toEqual(["block"]);
  });
});

describe("fully paginated completed history source", () => {
  it.each([false, true])("drains mixed >100 records; later failure never returns partial active/history data (%s)", async fail => {
    let page = 0;
    const request = async <T>(url: string): Promise<T> => {
      expect(new URL(url, "https://local.test").searchParams.getAll("status")).toContain("10"); page++;
      if (page === 2 && fail) throw new Error("503 later page");
      return { reservations: page === 1 ? Array.from({ length: 100 }, (_, i) => stay(String(i))) : [stay("replacement", { status: 2, holdsInventory: true }), stay("0")], page, pageSize: 100, hasMore: page === 1 } as T;
    };
    const pending = loadReservationCalendar(request, "p", segment.reservationFrom, segment.to);
    if (fail) await expect(pending).rejects.toThrow("503 later page");
    else {
      const records = await pending; expect(records).toHaveLength(102);
      const merged = mergeCalendarSegments([{ segment, reservations: records, blocks: [], reservationsCurrent: true }]);
      expect(merged.reservations).toHaveLength(101); expect(merged.conflictIds).toEqual([]);
      expect(merged.reservations.some(r => r.reservationId === "replacement")).toBe(true);
      const contradiction = mergeCalendarSegments([{ segment, reservations: [...records, stay("0", { departure: "2026-09-18" })], blocks: [], reservationsCurrent: true }]);
      expect(contradiction.conflictIds).toEqual(["reservation:0"]); expect(contradiction.conflicts.has(segment.from)).toBe(true);
      expect(contradiction.reservations.some(r => r.reservationId === "0")).toBe(false);
    }
    expect(page).toBe(2);
  });
  it("aborts before admitting a late page", async () => {
    const controller = new AbortController();
    const request = async <T>(): Promise<T> => { controller.abort(); return { reservations: [stay("late")], hasMore: true } as T; };
    await expect(loadReservationCalendar(request, "p", segment.from, segment.to, controller.signal)).rejects.toThrow();
  });
  it("fails closed on contradictory checked-out hold truth instead of making a Book gap", async () => {
    const request = async <T>() => ({ reservations: [stay("bad", { holdsInventory: true })], hasMore: false } as ReservationListResponse as T);
    const error = await loadReservationCalendar(request, "p", segment.from, segment.to).catch(error => error);
    expect(resolveReservationCalendarSource([stay("cached")], error)).toEqual({ hasData: false, reservations: [] });
  });
});

describe("actual calendar history presentation", () => {
  it("places history in a sibling track, preserving a free Book control and replacement stay independently", () => {
    const doc = rendered({ reservations: [stay("history", { inventoryUnitIds: ["a", "b"] }), stay("replacement", { status: 2, holdsInventory: true, inventoryUnitIds: ["b"], arrival: day, departure: "2026-09-14" })] });
    const row = doc.querySelector('#calendar-unit-a')!.closest('tr')!, history = row.querySelector('[data-calendar-history-track]')!;
    expect(history.querySelector('[data-calendar-booking-trigger]')).toBeNull();
    expect(row.querySelector('[data-calendar-booking-trigger="a:2026-09-12"]')).not.toBeNull();
    expect(history.previousElementSibling?.querySelector('[data-calendar-booking-trigger]')).not.toBeNull();
    expect(history.querySelector('button')!.getAttribute('aria-label')).toContain('Completed booking, scheduled dates');
    expect(history.querySelector('button')!.getAttribute('aria-label')).toContain('not current occupancy');
    expect(history.querySelector('button')!.style.gridColumn).toBe('17 / span 5'); // Scheduled9–16Sep clipped at the retained14Sep boundary.
    expect(history.querySelector('button')!.getAttribute('aria-label')).toContain('ends after displayed dates');
    const second = doc.querySelector('#calendar-unit-b')!.closest('tr')!;
    expect(second.querySelector('[data-calendar-completed-history]')).not.toBeNull();
    expect(second.querySelector('button[title*="Reserved"]')).not.toBeNull();
    expect(second.textContent).not.toContain('Conflict');
    expect(doc.querySelector('[aria-label="Requested inventory not held"]')).toBeNull();
  });
  it("does not reserve history tracks for empty rows or when no completed records exist", () => {
    const doc = rendered(); expect(doc.querySelector('#calendar-unit-b')!.closest('tr')!.querySelector('[data-calendar-history-track]')).toBeNull();
    expect(rendered({ reservations: [] }).querySelector('[data-calendar-history-track]')).toBeNull();
    expect(rendered({ reservations: [] }).querySelector('[data-calendar-history-disclosure]')).toBeNull();
  });
  it.each([
    { arrival: '2026-09-12', departure: '2026-09-13' },
    { arrival: '2026-08-20', departure: '2026-09-02' },
    { arrival: '2026-09-09', departure: '2026-09-30' },
  ])("retains in-button pinned labels and noninteractive normal-flow disclosure for short/edge spans (%o)", dates => {
    const name = 'Alexandra Example — long completed guest identity';
    const doc = rendered({ reservations: [stay('history', { ...dates, primaryGuestName: name })] });
    const row = doc.querySelector('#calendar-unit-a')!.closest('tr')!;
    const button = row.querySelector<HTMLButtonElement>('[data-calendar-completed-history]')!;
    const label = button.querySelector<HTMLElement>('[data-calendar-history-label]')!;
    expect(label.classList.contains('sticky')).toBe(true); expect(label.style.left).toBe('248px');
    expect(label.textContent).toContain(name); expect(label.textContent).toContain('Completed · scheduled');
    const disclosure = row.querySelector<HTMLElement>('th [data-calendar-history-disclosure]')!;
    expect(disclosure.textContent).toContain(name); expect(disclosure.textContent).toContain('Completed · scheduled');
    expect(disclosure.className).toContain('text-[13px]'); expect(disclosure.className).not.toMatch(/absolute|fixed|sticky/);
    expect(disclosure.querySelector('button,a,[tabindex]')).toBeNull();
    expect(row.querySelectorAll('[data-calendar-completed-history]')).toHaveLength(1);
    expect(button.style.gridColumn).toMatch(/\d+ \/ span \d+/); expect(button.getAttribute('aria-label')).toContain('not current occupancy');
    expect(row.querySelector('[data-calendar-booking-trigger="a:2026-09-12"]')).not.toBeNull();
  });
  it("keeps separate compact disclosures for multiple histories and does not fabricate a whole-room bed label", () => {
    const whole = { ...room.units[0], inventoryUnitId: 'former-room', kind: 'room' as const, bedId: null, label: room.roomName, isSellable: false };
    const doc = rendered({ rooms: [{ ...room, units: [...room.units, whole] }], reservations: [stay('one'), stay('two'), stay('whole', { inventoryUnitIds: ['former-room'] })] });
    const row = doc.querySelector('#calendar-unit-a')!.closest('tr')!;
    expect(row.querySelectorAll('[data-calendar-history-disclosure]')).toHaveLength(2);
    expect(row.querySelectorAll('[data-calendar-completed-history]')).toHaveLength(2);
    const former = doc.querySelector('section[aria-label^="Former or unavailable spaces"]')!;
    expect(former.textContent).toContain('Dorm201 · Whole room'); expect(former.textContent).not.toContain('Dorm201 · Dorm201');
    expect(former.querySelector('[data-calendar-booking-trigger]')).toBeNull();
  });
  it.each([{ rooms: [room], roomState: "ready" as const }, { rooms: [], roomState: "ready" as const }, { rooms: [], roomState: "unavailable" as const }])("keeps former/all-unavailable history readable without Book or UUID display (%o)", fields => {
    const doc = rendered({ ...fields, reservations: [stay("former", { inventoryUnitIds: ["retired", "missing-uuid"] })] });
    const fallback = doc.querySelector('section[aria-label^="Former or unavailable spaces"]')!;
    expect(fallback.textContent).toContain('Guest former'); expect(fallback.textContent).toContain('Completed');
    expect(fallback.textContent).not.toContain('missing-uuid'); expect(fallback.querySelector('[data-calendar-booking-trigger]')).toBeNull();
    expect(fallback.textContent).toContain(fields.rooms.length ? 'Dorm201 · 201-retired' : 'Recorded space label unavailable');
  });
  it("keeps selected-day mobile history separate from free/operational state", () => {
    const doc = rendered(), mobile = doc.querySelector('#calendar-mobile-room-r')!;
    expect(mobile.querySelector('[data-calendar-completed-history="history"]')).not.toBeNull();
    expect(mobile.querySelector('[data-calendar-booking-trigger="a:2026-09-12"]')).not.toBeNull();
    expect(mobile.textContent).not.toContain('Arrives'); expect(mobile.textContent).toContain('Completed · scheduled');
    const unknown = rendered({ availabilityCurrent: false });
    expect(unknown.querySelector('[data-calendar-completed-history]')).not.toBeNull();
    expect(unknown.querySelector('.calendar-timeline [data-calendar-booking-trigger]')).toBeNull();
  });
  it("opens the exact history identity and literal return key, retaining current Calendar origin", () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      act(() => root.render(createElement(MemoryRouter, null, createElement(CalendarWeekView, props()))));
      const button = host.querySelector<HTMLButtonElement>('.calendar-timeline [data-calendar-completed-history="history"]')!;
      act(() => button.click()); const opened = preview.open.mock.calls[0][0];
      expect(opened.route.selection).toMatchObject({ kind: 'reservation', reservationId: 'history', inventoryUnitId: 'a', date: day });
      expect(opened.route.origin).toMatchObject({ surface: 'calendar', propertyId: 'p', date: day, day, viewport: { date: day, offset: 0 } });
      expect(button.dataset.operationalPreviewTrigger).toBe(operationalPreviewTriggerKey(opened.route)); expect(opened.trigger).toBe(button);
    } finally { act(() => root.unmount()); host.remove(); }
  });
});

describe("completed shared preview truth", () => {
  it("distinguishes scheduled dates from actual authoritative detail and exposes no terminal quick command", () => {
    const item = stay('complete'); const model = reservationModel(item, undefined, 'current', '2026-09-10');
    expect(model.kindLabel).toBe('Completed booking'); expect(model.details[0].label).toBe('Scheduled dates');
    expect(model.details.find(d => d.label === 'Actual checkout')?.value).toContain('10');
    expect(reservationModel(item, undefined, 'current').details.some(d => d.label === 'Actual checkout')).toBe(false);
    expect(reservationModel(item, undefined, 'delayed', '2026-09-10').details.some(d => d.label === 'Actual checkout')).toBe(false);
    expect(reservationModel(item, undefined, 'current', '2026-02-30').details.some(d => d.label === 'Actual checkout')).toBe(false);
    expect(model.actions).toEqual([]);
  });
});
