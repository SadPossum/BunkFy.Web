// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManualBlock, ReservationListItem, RoomInventory } from "../src/api/types";
import { calendarDomainQueriesEnabled } from "../src/features/calendar/CalendarPage";
import {
  CalendarIntervalContent,
  CalendarCoverageDetails,
  CalendarCoverageStatus,
  CalendarTimelineGrid,
  CalendarWeekView,
  CompactCalendarInterval,
  MovementSummary,
  calendarNarrowIntervalDisclosure,
  calendarTimelineFocusAdjustment,
  formatCalendarDateRange,
  unitAvailabilityLabel,
} from "../src/features/calendar/CalendarWeekView";
import { blocksForUnit, buildCalendarResourceGroups, buildCalendarUnitDayStates, indexCalendarSchedule, reservationsForUnit, type CalendarUnitDayState } from "../src/features/calendar/calendarSchedule";
import { calendarSegmentFor, calendarViewportScroll, calendarWindowDays, type CalendarCoverage } from "../src/features/calendar/calendarWindow";

vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({
  useOperationalPreview: () => ({ activeRoute: null, openPreview: vi.fn() }),
}));

describe("mounted Calendar Book-control window", () => {
  let root: Root | undefined;
  let host: HTMLDivElement;
  const first = calendarSegmentFor("2026-09-08"), second = calendarSegmentFor(first.to), third = calendarSegmentFor(second.to);
  const days = calendarWindowDays([first, second, third]);
  const room = { propertyId: "p", roomId: "r", roomName: "Dorm with a long room name", salesMode: "bedLevel", units: [{ propertyId: "p", roomId: "r", inventoryUnitId: "u", label: "A", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
  function mount() {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
    const frames = new Map<number, FrameRequestCallback>(); let sequence = 0, width = 1102;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    let resize: (() => void) | undefined;
    let props: ComponentProps<typeof CalendarWeekView> = { propertyId: "p", dateKey: first.from, selectedDay: first.from, todayKey: first.from, from: first.from, to: third.to, days, viewport: { date: first.from, offset: 0 }, onSelectDay: vi.fn(), onViewport: vi.fn(), onExtend: vi.fn(), onBook: vi.fn(), bookingEnabled: true, rooms: [room], roomState: "ready", reservations: [], blocks: [], availabilityCurrent: true, coverage: [first, second, third].map(segment => ({ ...segment, current: true, reservationsCurrent: true, blocksCurrent: true, conflict: false, label: "Loaded", retry: vi.fn() })), canOpenSpaces: false };
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: () => void) {}
      observe(element: HTMLElement) {
        Object.defineProperties(element, { clientWidth: { configurable: true, get: () => width }, scrollWidth: { configurable: true, get: () => 240 + props.days.length * 112 } });
        element.scrollBy = vi.fn(); element.scrollTo = vi.fn((options?: ScrollToOptions | number) => { element.scrollLeft = typeof options === "number" ? options : Number(options?.left); });
        resize = this.callback; this.callback();
      }
      disconnect() { resize = undefined; }
    });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const render = (changes: Partial<typeof props> = {}) => { props = { ...props, ...changes }; act(() => root!.render(createElement(MemoryRouter, null, createElement(CalendarWeekView, props)))); };
    const flush = () => act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); });
    render(); flush();
    const timeline = host.querySelector<HTMLDivElement>(".calendar-timeline")!;
    const scroll = (left: number) => act(() => { timeline.dispatchEvent(new Event("pointerdown", { bubbles: true })); timeline.scrollLeft = left; timeline.dispatchEvent(new Event("scroll")); });
    const buttons = () => [...timeline.querySelectorAll<HTMLButtonElement>("[data-calendar-booking-trigger]")];
    const summaries = () => [...timeline.querySelectorAll<HTMLTableCellElement>("td[aria-label]")].filter(cell => cell.getAttribute("aria-label")!.includes(" arrivals;"));
    const settle = () => act(() => vi.advanceTimersByTime(120));
    return { render, flush, settle, timeline, scroll, buttons, summaries, frames, resize: (nextWidth: number) => { width = nextWidth; act(() => resize?.()); } };
  }
  afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  const day = (index: number) => days[index].toISOString().slice(0, 10);
  const bookKey = (index: number) => 'u:' + day(index);

  it("windows only actual Book controls while all63 headers, summaries and backgrounds remain", () => {
    const s = mount(), summaries = s.summaries(), before = summaries.map(cell => cell.outerHTML);
    expect(s.buttons()).toHaveLength(16);
    expect(summaries).toHaveLength(63);
    expect(s.timeline.querySelectorAll("[data-calendar-day-header]")).toHaveLength(63);
    expect(s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")).toHaveLength(16);
    expect(s.timeline.querySelectorAll('[data-calendar-day-current="true"]')).toHaveLength(63);
    expect(s.timeline.querySelector('table')?.getAttribute("aria-colcount")).toBe("64");
    expect(s.timeline.querySelector('#calendar-room-heading-r')?.getAttribute("aria-colindex")).toBe("1");
    expect(s.timeline.querySelector('[role="grid"]')).toBeNull();
    expect(s.timeline.querySelector("[data-calendar-summary-spacer]")).toBeNull();
    for (const cell of summaries) for (const id of cell.headers.split(" ")) expect(document.getElementById(id)?.tagName).toBe("TH");
    s.scroll(40 * 112);
    expect(s.buttons()).toHaveLength(16); // No per-scroll React update.
    s.settle();
    expect(s.buttons()).toHaveLength(22);
    expect(s.buttons()[0].dataset.calendarBookingTrigger).toBe(bookKey(33));
    expect(s.buttons()[0].style.gridColumn).toBe("34");
    expect(s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")).toHaveLength(22);
    s.summaries().forEach((cell, index) => { expect(cell).toBe(summaries[index]); expect(cell.outerHTML).toBe(before[index]); });
    expect(s.timeline.scrollWidth).toBe(7296);
  });

  it("retains the exact focused Book node only until focus leaves the off-window target", () => {
    const s = mount(), target = s.buttons()[3], descendants = [...target.children];
    act(() => target.focus()); expect(document.activeElement).toBe(target);
    s.scroll(40 * 112); s.settle();
    expect(target.isConnected).toBe(true); expect(document.activeElement).toBe(target);
    expect(s.buttons()).toHaveLength(23);
    [...target.children].forEach((child, index) => expect(child).toBe(descendants[index]));
    const external = document.createElement("button"); document.body.append(external);
    act(() => external.focus()); expect(document.activeElement).toBe(external);
    expect(target.isConnected).toBe(false); expect(s.buttons()).toHaveLength(22);
    external.remove();
  });

  it("pins a focused header without growing the sequential Tab window through focus-induced scrolling", () => {
    const s = mount();
    const header = s.timeline.querySelector<HTMLButtonElement>("[data-calendar-header-action]")!;
    act(() => header.focus());
    const initial = [...s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")];
    act(() => { s.timeline.scrollLeft = 40 * 112; s.timeline.dispatchEvent(new Event("scroll")); });
    s.settle();
    expect([...s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")]).toEqual(initial);
    expect(s.buttons()).toHaveLength(16);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => header.dispatchEvent(tab)); expect(tab.defaultPrevented).toBe(false);
    s.scroll(41 * 112); s.settle();
    expect(header.tabIndex).toBe(0); expect(document.activeElement).toBe(header);
    expect(s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")).toHaveLength(23);
    act(() => s.timeline.focus()); expect(header.tabIndex).toBe(-1);
    expect(s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")).toHaveLength(22);
  });

  it("updates viewport orientation through its real prop echo without widening Tab membership or replacing the focused Book", () => {
    const s = mount(), target = s.buttons()[3], initial = s.buttons();
    const onViewport = vi.fn((viewport: { date: string; offset: number }) => s.render({ viewport }));
    s.render({ onViewport });
    act(() => target.focus());
    const initialHeaders = [...s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")];
    act(() => { s.timeline.scrollLeft = 40 * 112; s.timeline.dispatchEvent(new Event("scroll")); });
    act(() => vi.advanceTimersByTime(100));
    // A subsequent native focus does not cancel persistence of the actual viewport.
    act(() => { initial[4].focus(); target.focus(); });
    act(() => vi.advanceTimersByTime(80));
    expect(onViewport).toHaveBeenCalledExactlyOnceWith({ date: day(40), offset: 0 });
    expect(s.timeline.scrollLeft).toBe(40 * 112);
    expect(s.buttons()).toEqual(initial); expect(document.activeElement).toBe(target);
    expect([...s.timeline.querySelectorAll("[data-calendar-header-action][tabindex='0']")]).toEqual(initialHeaders);
    // A different external Jump still restores, updates presentation, and keeps the exact focused pin.
    s.render({ viewport: { date: day(50), offset: 0 } }); s.flush();
    expect(s.timeline.scrollLeft).toBe(50 * 112); expect(document.activeElement).toBe(target);
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(50))).toBe(true);
    const external = document.createElement("button"); document.body.append(external);
    act(() => external.focus()); expect(target.isConnected).toBe(false); external.remove();
  });

  it("coalesces ordinary scrolling until settled, updates keyboard movement immediately, and cleans pending work", () => {
    const s = mount();
    for (const left of [6, 8, 20, 40]) { s.scroll(left * 112); act(() => vi.advanceTimersByTime(50)); }
    expect(s.buttons()).toHaveLength(16);
    act(() => vi.advanceTimersByTime(70)); expect(s.buttons()).toHaveLength(22);
    act(() => s.timeline.focus());
    const key = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
    act(() => s.timeline.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(true);
    expect(s.buttons()[0].dataset.calendarBookingTrigger).toBe(bookKey(0));
    const scheduled = vi.spyOn(globalThis, "setTimeout"), canceled = vi.spyOn(globalThis, "clearTimeout");
    s.scroll(40 * 112);
    const ownedTimers = scheduled.mock.calls.flatMap((call, index) => call[1] === 120 || call[1] === 180 ? [scheduled.mock.results[index].value] : []);
    expect(ownedTimers).toHaveLength(2);
    act(() => root!.unmount()); root = undefined;
    for (const timer of ownedTimers) expect(canceled).toHaveBeenCalledWith(timer);
    expect(s.frames.size).toBe(0); scheduled.mockRestore(); canceled.mockRestore();
  });

  it("retains an exact booking-return pin without a wide union and never resurrects unknown or occupied Book", () => {
    const s = mount();
    s.render({ bookingFocus: { unitId: "u", roomId: "r" }, selectedDay: day(45), bookingFocusReady: false });
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(45))).toBe(true);
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(30))).toBe(false);
    s.render({ availabilityCurrent: false, coverage: [first, second, third].map(segment => ({ ...segment, current: false, reservationsCurrent: false, blocksCurrent: true, conflict: false, label: "Reservations unavailable", retry: vi.fn() })) });
    expect(s.buttons()).toHaveLength(0);
    expect(s.timeline.querySelectorAll('[data-calendar-day-current="false"]')).toHaveLength(63);
    expect(s.summaries()).toHaveLength(63);
    expect(s.summaries().every(cell => cell.textContent?.includes("Unconfirmed"))).toBe(true);
    s.render({ coverage: [] }); expect(s.buttons()).toHaveLength(0);
    s.render({ coverage: undefined }); expect(s.buttons()).toHaveLength(0);
    s.render({ availabilityCurrent: true });
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(45))).toBe(true);
    s.render({ reservations: [{ propertyId: "p", reservationId: "held", primaryGuestName: "Held", arrival: day(45), departure: day(47), inventoryUnitIds: ["u"], holdsInventory: true, status: "confirmed" } as ReservationListItem] });
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(45))).toBe(false);
  });

  it("keeps a dispatched opener through frozen modal focus, then preserves the same eligible return node", () => {
    const s = mount(), target = s.buttons()[3];
    const onBook = vi.fn(() => s.render({ viewportFrozen: true, bookingEnabled: false }));
    s.render({ onBook });
    act(() => { target.focus(); target.click(); }); expect(onBook).toHaveBeenCalledOnce();
    const modalControl = document.createElement("button"); document.body.append(modalControl);
    act(() => modalControl.focus());
    s.scroll(40 * 112); s.settle();
    expect(target.isConnected).toBe(true); expect(target.getAttribute("aria-disabled")).toBe("true");
    s.render({ viewportFrozen: false, bookingEnabled: true, bookingFocus: { unitId: "u", roomId: "r" }, selectedDay: day(3), bookingFocusReady: false });
    expect(target.isConnected).toBe(true);
    act(() => target.focus()); expect(document.activeElement).toBe(target);
    act(() => modalControl.focus()); expect(target.isConnected).toBe(false);
    modalControl.remove();
  });

  it("returns lost focus to the same timeline when a focused Book becomes unconfirmed, without a stale pin or external-focus steal", () => {
    const s = mount(), target = s.buttons()[3];
    act(() => target.focus()); s.scroll(40 * 112); s.settle();
    expect(document.activeElement).toBe(target);
    s.render({ coverage: undefined, availabilityCurrent: false });
    expect(s.buttons()).toHaveLength(0); expect(document.activeElement).toBe(s.timeline);
    s.render({ availabilityCurrent: true });
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(3))).toBe(false);
    const external = document.createElement("button"); document.body.append(external);
    act(() => { s.buttons()[0].focus(); external.focus(); });
    s.render({ availabilityCurrent: false });
    expect(document.activeElement).toBe(external); external.remove();
  });

  it("keeps complete occupied/block intervals and full movement summaries unchanged across Book-window movement", () => {
    const s = mount(), arrival = day(40), departure = day(42);
    const stay = { propertyId: "p", reservationId: "stay", primaryGuestName: "QA long stay", arrival, departure, inventoryUnitIds: ["u"], holdsInventory: true, status: "confirmed" } as ReservationListItem;
    s.render({ reservations: [stay], blocks: [{ propertyId: "p", blockId: "block", inventoryUnitId: "u", arrival, departure, reason: "QA hold" } as ManualBlock] });
    const arrivalSummary = s.summaries()[40], summaryShape = arrivalSummary.outerHTML;
    expect(arrivalSummary.getAttribute("aria-label")).toContain("1 arrivals");
    const intervals = [...s.timeline.querySelectorAll("[data-operational-preview-trigger]")], shapes = intervals.map(button => button.outerHTML);
    expect(intervals).toHaveLength(2);
    s.scroll(40 * 112); s.settle();
    expect(s.buttons().some(button => button.dataset.calendarBookingTrigger === bookKey(40))).toBe(false);
    expect(s.summaries()[40]).toBe(arrivalSummary); expect(arrivalSummary.outerHTML).toBe(summaryShape);
    [...s.timeline.querySelectorAll("[data-operational-preview-trigger]")].forEach((button, index) => { expect(button).toBe(intervals[index]); expect(button.outerHTML).toBe(shapes[index]); });
  });

  it("does not rerender intervals or full requested summaries when only the Book window changes", () => {
    const s = mount(), name = vi.fn(() => "QA stable interval");
    const stay = { propertyId: "p", reservationId: "stable-stay", arrival: day(30), departure: day(33), inventoryUnitIds: ["u"], holdsInventory: true, status: "confirmed" } as ReservationListItem;
    Object.defineProperty(stay, "primaryGuestName", { get: name });
    const request = { propertyId: "p", reservationId: "request", primaryGuestName: "QA request", arrival: day(2), departure: day(50), inventoryUnitIds: ["u"], holdsInventory: false, status: "pendingAllocation" } as ReservationListItem;
    s.render({ reservations: [stay, request] }); expect(name).toHaveBeenCalled(); name.mockClear();
    const row = s.timeline.querySelector('tbody[aria-label="Requested inventory not held"] tr')!, shape = row.outerHTML;
    expect(row.querySelectorAll("td[headers]")).toHaveLength(63);
    expect(row.querySelector("th")?.getAttribute("aria-colindex")).toBe("1");
    for (const cell of row.querySelectorAll<HTMLTableCellElement>("td[headers]")) for (const id of cell.headers.split(" ")) expect(document.getElementById(id)?.tagName).toBe("TH");
    s.scroll(20 * 112); s.settle(); s.scroll(40 * 112); s.settle();
    expect(name).not.toHaveBeenCalled(); expect(row.outerHTML).toBe(shape);
    s.render({ reservations: [{ ...stay, primaryGuestName: "QA changed current stay" }, request] });
    expect(s.timeline.querySelector('[data-operational-preview-trigger*="stable-stay"]')?.getAttribute("aria-label")).toContain("QA changed current stay");
  });
});

describe("bounded indexed Calendar model", () => {
  it("matches the existing unit/day semantics for multi-bed holds, requests, departure context and overlapping blocks", () => {
    const resources = buildCalendarResourceGroups([{ roomId: "room", roomName: "Dorm", salesMode: "bedLevel", units: ["a", "b"].map(inventoryUnitId => ({ inventoryUnitId, label: inventoryUnitId, isSellable: true, isTopologyActive: true })) } as RoomInventory]).flatMap(group => group.resources);
    const stay = { reservationId: "stay", propertyId: "property", arrival: "2026-09-08", departure: "2026-09-10", inventoryUnitIds: ["a", "b"], holdsInventory: true } as ReservationListItem;
    const reservations = [stay, { ...stay, reservationId: "request", holdsInventory: false }, { ...stay, reservationId: "unmapped", inventoryUnitIds: ["foreign"] }];
    const blocks = [{ blockId: "block", inventoryUnitId: "b", arrival: "2026-09-09", departure: "2026-09-11" } as ManualBlock];
    const days = ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];
    const indexed = indexCalendarSchedule(resources, reservations, blocks, days);
    expect([...indexed.keys()]).toEqual(["a", "b"]);
    for (const resource of resources) {
      const model = indexed.get(resource.inventoryUnitId)!;
      expect(model.reservations).toEqual(reservationsForUnit(reservations, resource.inventoryUnitId));
      expect(model.blocks).toEqual(blocksForUnit(blocks, resource.inventoryUnitId));
      for (const day of days) expect(model.days.get(day)).toEqual(buildCalendarUnitDayStates([resource], reservations, blocks, day).get(resource.inventoryUnitId));
    }
    expect(indexed.get("a")!.days.get("2026-09-10")).toMatchObject({ availability: "free", reservations: [stay] });
    expect(indexed.get("b")!.days.get("2026-09-09")!.availability).toBe("conflict");
    const updated = indexCalendarSchedule(resources, [{ ...stay, departure: "2026-09-12", inventoryUnitIds: ["b"] }], [{ ...blocks[0], inventoryUnitId: "a" }], days);
    expect(updated.get("a")!.reservations).toEqual([]); expect(updated.get("a")!.blocks).toHaveLength(1);
    expect(updated.get("b")!.days.get("2026-09-11")!.availability).toBe("occupied");
  });
});

describe("segmented Calendar rendered truth", () => {
  const first = calendarSegmentFor("2026-09-08"), second = calendarSegmentFor(first.to);
  const coverage: CalendarCoverage[] = [first, second].map((segment, index) => ({ ...segment, current: index === 0, reservationsCurrent: index === 0, blocksCurrent: index === 0, label: index === 0 ? "Loaded" : "Schedule unavailable", conflict: false, retry: vi.fn() }));
  it.each([false, true])("keeps optional viewport compatibility on both room and empty-layout Spaces links (provided=%s)", (provided) => {
    const room = { propertyId: "property-a", roomId: "room-a", roomName: "Dorm", salesMode: "bedLevel", units: [{ propertyId: "property-a", roomId: "room-a", inventoryUnitId: "bed-a", label: "104-D", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
    for (const rooms of [[room], []]) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, { propertyId: "property-a", dateKey: "2026-09-12", selectedDay: "2026-09-08", todayKey: first.from, from: first.from, to: first.to, days: calendarWindowDays([first]), onSelectDay: vi.fn(), rooms, roomState: "ready", reservations: [], blocks: [], availabilityCurrent: true, canOpenSpaces: true, ...(provided ? { viewport: { date: "2026-09-07", offset: 375 } } : {}) })));
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => new URL(match[1].replaceAll("&amp;", "&"), "https://example.test")).filter((url) => url.pathname === "/spaces");
      expect(links).toHaveLength(rooms.length ? 2 : 1);
      for (const { searchParams: params } of links) {
        expect(params.get("surfaceReturnDate")).toBe("2026-09-12"); expect(params.get("surfaceReturnDay")).toBe("2026-09-08");
        expect(params.get("room")).toBe(rooms.length ? "room-a" : null);
        expect(params.get("surfaceReturnViewportDate")).toBe(provided ? "2026-09-07" : null);
        expect(params.get("surfaceReturnViewportOffset")).toBe(provided ? "375" : null);
      }
    }
  });
  it("paints unknown cells explicitly while retaining the adjacent current band", () => {
    const html = renderToStaticMarkup(createElement(CalendarTimelineGrid, { days: calendarWindowDays([first, second]), laneCount: 1, selectedDay: "2026-09-08", todayKey: "2026-09-08", coverage, children: null }));
    expect(html).toContain("grid-template-columns:repeat(42, minmax(0, 1fr))");
    expect(html.match(/data-calendar-day-current="false"/g)).toHaveLength(21);
    expect(html.match(/data-calendar-day-current="true"/g)).toHaveLength(21);
    expect(html).toContain(`${second.from}: Schedule unavailable`);
    expect(html).not.toContain("Free");
  });
  it("renders a real 42-column table, seven mobile choices and no booking trigger in unavailable dates", () => {
    const room = { propertyId: "property-a", roomId: "room-a", roomName: "Dorm", salesMode: "bedLevel", units: [{ propertyId: "property-a", roomId: "room-a", bedId: "bed-a", inventoryUnitId: "bed-a", label: "104-D", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, { propertyId: "property-a", dateKey: "2026-09-08", selectedDay: "2026-09-08", todayKey: first.from, from: first.from, to: second.to, days: calendarWindowDays([first, second]), onSelectDay: vi.fn(), onBook: vi.fn(), bookingEnabled: true, rooms: [room], roomState: "ready", reservations: [], blocks: [], availabilityCurrent: false, coverage, canOpenSpaces: false })));
    expect(html).toContain('colSpan="42"');
    expect(html.match(/data-calendar-day-header=/g)).toHaveLength(42);
    const mobile = html.split('class="lg:hidden"')[1]?.split('class="hidden lg:block"')[0] ?? "";
    expect(mobile.match(/aria-label="Show /g)).toHaveLength(7);
    expect(html).toContain('data-calendar-booking-trigger="bed-a:2026-09-08"');
    expect(html).not.toContain(`data-calendar-booking-trigger="bed-a:${first.from}"`); // Current but outside the presented Book window.
    expect(html).not.toContain(`data-calendar-booking-trigger="bed-a:${second.from}"`);
    expect(html).toContain("Some dates unconfirmed");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('role="grid"');
    expect(html.match(/aria-label="Calendar legend"/g)).toHaveLength(1);
    expect(html.indexOf('aria-label="Calendar legend"')).toBeLessThan(html.indexOf('class="calendar-timeline'));
    expect(html).toContain("Blank gaps are available only on confirmed dates");
    expect(html).not.toContain("Blank gap is available");
  });

  it.each([
    { name: "all displayed dates current", segments: [first, second], states: [true, true], pageCurrent: false, expected: "Blank gap is available" },
    { name: "mixed despite current page", segments: [first, second], states: [true, false], pageCurrent: true, expected: "Blank gaps are available only on confirmed dates" },
    { name: "all displayed dates unconfirmed", segments: [first, second], states: [false, false], pageCurrent: true, expected: "Blank gaps are unconfirmed" },
    { name: "missing second-day coverage", segments: [first, second], states: [true], pageCurrent: true, expected: "Blank gaps are available only on confirmed dates" },
    { name: "empty coverage is not confirmed", segments: [first, second], states: [], pageCurrent: true, expected: "Blank gaps are unconfirmed" },
    { name: "failed segment outside displayed days", segments: [first], states: [true, false], pageCurrent: true, expected: "Blank gap is available" },
    { name: "current legacy no-coverage fallback", segments: [first], states: undefined, pageCurrent: true, expected: "Blank gap is available" },
    { name: "uncurrent legacy no-coverage fallback", segments: [first], states: undefined, pageCurrent: false, expected: "Blank gaps are unconfirmed" },
  ])("scopes the rendered legend to $name", ({ segments, states, pageCurrent, expected }) => {
    const coverage = states?.map((current, index): CalendarCoverage => ({ ...[first, second][index], current, reservationsCurrent: current, blocksCurrent: current, conflict: false, label: current ? "Loaded" : "Schedule unavailable", retry: vi.fn() }));
    const room = { propertyId: "property-a", roomId: "room-a", roomName: "Dorm", salesMode: "bedLevel", units: [{ propertyId: "property-a", roomId: "room-a", inventoryUnitId: "bed-a", label: "104-D", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, { propertyId: "property-a", dateKey: "2026-09-08", selectedDay: "2026-09-08", todayKey: first.from, from: first.from, to: segments.at(-1)!.to, days: calendarWindowDays(segments), onSelectDay: vi.fn(), rooms: [room], roomState: "ready", reservations: [], blocks: [], availabilityCurrent: pageCurrent, coverage, canOpenSpaces: false })));
    const legend = html.split('aria-label="Calendar legend"')[1]?.split('</div>')[0] ?? "";
    expect(html.match(/aria-label="Calendar legend"/g)).toHaveLength(1);
    expect(legend).toContain(expected);
    expect(legend).toContain("inline-flex min-h-8 w-[21rem] max-w-full items-center gap-1.5 leading-4");
    expect(legend).not.toMatch(/truncate|overflow-hidden|line-clamp/);
    for (const other of ["Blank gap is available", "Blank gaps are available only on confirmed dates", "Blank gaps are unconfirmed"].filter(label => label !== expected)) expect(legend).not.toContain(other);
  });
});

describe("Calendar opaque cached interval paint", () => {
  it.each([
    { name: "reserved", status: "confirmed", block: false, conflict: false, base: 87, color: "success", tint: 13 },
    { name: "in house", status: "checkedIn", block: false, conflict: false, base: 85, color: "secondary", tint: 15 },
    { name: "attention", status: "cancellationPending", block: false, conflict: false, base: 80, color: "warning", tint: 20 },
    { name: "manual hold", status: "confirmed", block: true, conflict: false, base: 84, color: "warning", tint: 16 },
    { name: "conflict", status: "confirmed", block: false, conflict: true, base: 86, color: "error", tint: 14 },
  ])("keeps $name readable over an unknown band without removing source truth or current neighbours", ({ status, block, conflict, base, color, tint }) => {
    const first = calendarSegmentFor("2026-09-08"), second = calendarSegmentFor(first.to);
    const coverage: CalendarCoverage[] = [
      { ...first, current: false, reservationsCurrent: block, blocksCurrent: !block && !conflict, conflict: false, label: "Schedule unavailable", retry: vi.fn() },
      { ...second, current: true, reservationsCurrent: true, blocksCurrent: true, conflict: false, label: "Loaded", retry: vi.fn() },
    ];
    const room = { propertyId: "property-a", roomId: "room-a", roomName: "Dorm", salesMode: "bedLevel", units: [{ propertyId: "property-a", roomId: "room-a", bedId: "bed-a", inventoryUnitId: "bed-a", label: "104-D", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
    const stay = { ...reservation(status as ReservationListItem["status"]), arrival: "2026-09-08", departure: "2026-09-11" };
    const reservations = block ? [] : conflict ? [stay, { ...stay, reservationId: "reservation-b", primaryGuestName: "Second guest" }] : [stay];
    const blocks = block ? [{ propertyId: "property-a", blockId: "block-a", blockGroupId: "group-a", inventoryUnitId: "bed-a", arrival: stay.arrival, departure: stay.departure, reason: "Maintenance", status: "active" } as ManualBlock] : [];
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, { propertyId: "property-a", dateKey: stay.arrival, selectedDay: stay.arrival, todayKey: first.from, from: first.from, to: second.to, days: calendarWindowDays([first, second]), onSelectDay: vi.fn(), onBook: vi.fn(), bookingEnabled: true, rooms: [room], roomState: "ready", reservations, blocks, availabilityCurrent: false, coverage, canOpenSpaces: false })));
    const desktop = html.split('class="hidden lg:block"')[1] ?? "";
    const buttons = desktop.match(/<button\b[^>]*data-operational-preview-trigger=[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(conflict ? 2 : 1);
    for (const button of buttons) {
      const opening = button.slice(0, button.indexOf(">") + 1);
      expect(opening).toContain(`bg-[color-mix(in_oklab,var(--color-base-100)_${base}%,var(--color-${color})_${tint}%)]`);
      const foreground = color === "success" || color === "secondary" ? "text-base-content"
        : color === "warning" ? "text-warning-content" : "text-base-content";
      expect(opening).toContain(` ${foreground}`);
      expect(opening).not.toMatch(/\btext-(?:success|secondary)\b/);
      expect(opening).not.toMatch(/\bbg-(?:success|secondary|warning|error)\/\d/);
      expect(opening).toContain("relative z-10"); expect(opening).toContain("focus-visible:z-20");
      expect(opening).toContain(" h-8 "); expect(opening).toContain("text-[0.8125rem]");
      expect(opening).toContain('aria-controls="operational-preview"');
      expect(button).toMatch(block ? /Maintenance/ : /Maya Rivera|Second guest/);
      expect(button).toContain('data-calendar-endpoint="start"');
      expect(button).toContain('data-calendar-endpoint="end"');
    }
    expect(html).toContain(block ? "Maintenance" : "Maya Rivera");
    expect(html).toContain('data-calendar-day-current="false"');
    expect(html).toContain(`${first.from}: Schedule unavailable`);
    expect(html).toContain('leading-8">Unconfirmed</span>');
    expect(html).toContain("Some dates unconfirmed");
    expect(html).not.toContain(`data-calendar-booking-trigger="bed-a:${first.from}"`);
    expect(html).toContain(`data-calendar-booking-trigger="bed-a:${second.from}"`);
    // Static surface/identity/currentness contract only: actual glyph opacity,
    // endpoints and contrast are verified from the independent rendered frame.
  });
});

describe("Calendar stable status and progressive source details", () => {
  const first = calendarSegmentFor("2026-09-08");
  const segments = [first, calendarSegmentFor(first.to), calendarSegmentFor(calendarSegmentFor(first.to).to)];
  const loaded = segments.map((segment): CalendarCoverage => ({ ...segment, current: true, reservationsCurrent: true, blocksCurrent: true, label: "Schedule unconfirmed", conflict: false, retry: vi.fn() }));
  const props = { viewportFrozen: false, selectedDate: new Date(2026, 8, 8, 12), onShowSelectedDay: vi.fn() };
  it.each([1, 2, 3])("reserves one compact success row for %s segments without exposed request ranges", (count) => {
    const html = renderToStaticMarkup(createElement(CalendarCoverageStatus, { ...props, coverage: loaded.slice(0, count) }));
    expect(html).toContain('class="flex h-14 items-center justify-between');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Dates loaded");
    expect(html).toContain("Details");
    expect(html).not.toContain("end exclusive");
    expect(html).not.toMatch(/2026-\d{2}-\d{2}/);
    expect(html).not.toContain('data-calendar-segment=');
    expect(html).not.toContain('role="dialog"');
  });
  it.each(["Loading schedule", "Schedule unavailable", "Schedule unconfirmed", "Conflicting schedule snapshots — unconfirmed"])("keeps %s explicit through a stable summary and accessible details", (label) => {
    const coverage = [loaded[0], { ...loaded[1], current: false, reservationsCurrent: false, label, conflict: label.startsWith("Conflicting") }];
    const summary = renderToStaticMarkup(createElement(CalendarCoverageStatus, { ...props, coverage }));
    expect(summary).toContain("Some dates unconfirmed");
    expect(summary).toContain('class="flex h-14 ');
    const details = renderToStaticMarkup(createElement(CalendarCoverageDetails, { ...props, coverage }));
    expect(details).toContain(label);
    expect(details).toContain("Reservations: unconfirmed");
    expect(details).toContain("Manual holds: current");
    expect(details).toContain("Retry dates");
    expect(details).toContain(formatCalendarDateRange(coverage[1].from, "2026-10-04"));
    expect(details).not.toContain("end exclusive");
  });
  it("distinguishes hold-source failure and keeps the same recovery control mounted after it becomes current", () => {
    const coverage = [{ ...loaded[0], current: false, blocksCurrent: false, label: "Schedule unavailable" }];
    const details = CalendarCoverageDetails({ ...props, coverage });
    const section = details.props.children[2][0];
    section.props.children[3].props.onClick();
    expect(coverage[0].retry).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(details);
    expect(html).toContain("Reservations: current");
    expect(html).toContain("Manual holds: unconfirmed");
    const recovered = CalendarCoverageDetails({ ...props, coverage: [loaded[0]] });
    expect(recovered.props.children[2][0].key).toBe(section.key);
    expect(recovered.props.children[2][0].props.children[3].type).toBe("button");
    expect(renderToStaticMarkup(recovered)).toContain("Refresh dates");
    // Element/key continuity only; mounted focus is a separate browser gate.
  });
  it("keeps paused and outside-selected-day notices in details without adding rows above the timeline", () => {
    const paused = { ...props, coverage: loaded, viewportFrozen: true, selectedDate: new Date(2026, 11, 1, 12) };
    const summary = renderToStaticMarkup(createElement(CalendarCoverageStatus, paused));
    expect(summary).toContain('class="flex h-14 ');
    expect(summary).toContain("Date loading paused");
    expect(summary).not.toContain("outside the loaded dates");
    const details = renderToStaticMarkup(createElement(CalendarCoverageDetails, paused));
    expect(details).toContain("Date loading is paused");
    expect(details).toContain("outside the loaded dates");
    expect(details).toMatch(/disabled=""[^>]*>Show selected day/);
  });
});

// Render the real week and its four interval-button paths. Native browser layout,
// computed pixels, zoom and focus interactions remain independent review gates.
describe("calendar primary interval text", () => {
  it.each([
    { name: "multi-day reservation", arrival: "2026-09-08", departure: "2026-09-11", held: true, block: false },
    { name: "one-day reservation", arrival: "2026-09-08", departure: "2026-09-09", held: true, block: false },
    { name: "continued reservation", arrival: "2026-09-04", departure: "2026-09-16", held: true, block: false },
    { name: "inventory block", arrival: "2026-09-08", departure: "2026-09-11", held: true, block: true },
    { name: "reservation departure marker", arrival: "2026-09-04", departure: "2026-09-07", held: true, block: false },
    { name: "requested interval", arrival: "2026-09-08", departure: "2026-09-11", held: false, block: false },
    { name: "requested departure marker", arrival: "2026-09-04", departure: "2026-09-07", held: false, block: false },
  ])("keeps readable primary text and compact badges on $name", ({ arrival, departure, held, block }) => {
    const label = block ? "Réparation longue · chambre accessible" : "Saoirse O’Connell · José Müller";
    const booking = { ...reservation(held ? "confirmed" : "pendingAllocation"), arrival, departure, primaryGuestName: label, holdsInventory: held };
    const room = { propertyId: "property-a", roomId: "room-a", roomName: "Dorm 101", salesMode: "bedLevel", units: [{
      propertyId: "property-a", roomId: "room-a", bedId: "bed-a", inventoryUnitId: "bed-a", label: "101-A", kind: "bed", isSellable: true, isTopologyActive: true,
    }] } as RoomInventory;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, {
      propertyId: "property-a", dateKey: "2026-09-08", days: Array.from({ length: 7 }, (_, index) => new Date(2026, 8, 7 + index, 12)),
      from: "2026-09-07", to: "2026-09-14", selectedDay: "2026-09-08", todayKey: "2026-09-08", onSelectDay: vi.fn(),
      reservations: block ? [] : [booking], rooms: [room], roomState: "ready", availabilityCurrent: true, canOpenSpaces: false,
      blocks: block ? [{ propertyId: "property-a", blockId: "block-a", inventoryUnitId: "bed-a", arrival, departure, reason: label, status: "active" } as ManualBlock] : [],
    })));
    const buttons = html.match(/<button\b[^>]*class="[^"]*text-\[0\.8125rem\][^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1);
    const interval = buttons[0];
    expect(interval).toContain(" h-8 "); expect(interval).toContain("text-[0.58rem]");
    expect(interval).toContain('aria-label="' + label); expect(interval).toContain('aria-controls="operational-preview"');
    expect(interval).toContain('aria-expanded="false"'); expect(interval).toContain("data-operational-preview-trigger=");
    expect(interval).toContain("truncate"); expect(interval).not.toContain("text-[0.68rem]");
    expect(html).toContain('class="calendar-timeline ');
    // Headings must out-rank both resting and focused events, below the date
    // header. Actual scrolling, opaque paint and focus require browser proof.
    const headingId = held ? "calendar-unit-bed-a" : "calendar-request-reservation-a";
    const heading = html.match(new RegExp(`<th id="${headingId}"[^>]*>`))?.[0];
    expect(heading).toContain("z-[25]");
    expect(heading).not.toContain("bg-warning/5");
    expect(html).toContain('class="sticky top-0 z-30 ');
    expect(html).toMatch(/grid-template-rows:repeat\(\d+, 2rem\)/);
    if (held) expect(interval).toContain('title="');
    if (arrival === "2026-09-08" && departure === "2026-09-11") expect(interval).toContain("text-[0.6rem]");
  });
});

describe("calendar timeline focus clearance", () => {
  const visible = { left: 248, right: 680, top: 64, bottom: 800 };
  it.each([
    { name: "behind pinned bed labels", action: { left: 69, right: 181, top: 100, bottom: 132 }, expected: { left: -179, top: 0 } },
    { name: "beyond right edge", action: { left: 620, right: 732, top: 100, bottom: 132 }, expected: { left: 52, top: 0 } },
    { name: "under date heading", action: { left: 250, right: 362, top: 40, bottom: 72 }, expected: { left: 0, top: -24 } },
    { name: "already unobscured", action: { left: 250, right: 362, top: 100, bottom: 132 }, expected: { left: 0, top: 0 } },
    { name: "longer than visible dates", action: { left: 300, right: 1000, top: 100, bottom: 132 }, expected: { left: 52, top: 0 } },
    { name: "already spanning the viewport", action: { left: 100, right: 1000, top: 100, bottom: 132 }, expected: { left: 0, top: 0 } },
    { name: "long interval clipped on the left", action: { left: 0, right: 600, top: 100, bottom: 132 }, expected: { left: -80, top: 0 } },
    { name: "below the visible rows", action: { left: 250, right: 362, top: 780, bottom: 812 }, expected: { left: 0, top: 12 } },
  ])("reveals a focused action $name without choosing another target", ({ action, expected }) => {
    expect(calendarTimelineFocusAdjustment(action, visible)).toEqual(expected);
  });
  it("does not recenter the captured 17 September / 54 position when the returning trigger fits", () => {
    const saved = calendarViewportScroll("2026-09-14", { date: "2026-09-17", offset: 54 });
    const delta = calendarTimelineFocusAdjustment({ left: 560, right: 678, top: 100, bottom: 132 }, visible);
    expect(saved).toBeCloseTo(342.048, 3);
    expect(delta).toEqual({ left: 0, top: 0 });
    expect(saved + delta.left).toBe(saved);
  });
});

describe("calendar interval presentation", () => {
  it("shows both scheduled endpoints on a one-night reservation bar", () => {
    const html = renderToStaticMarkup(createElement(CalendarIntervalContent, {
      kind: "reservation",
      label: "Maya Rivera",
      operation: "Reserved",
      conflict: false,
      columnSpan: 1,
      startsBeforeWindow: false,
      endsAfterWindow: false,
      showsArrival: true,
      showsDeparture: true,
    }));

    expect(html).toContain('data-calendar-endpoint="start"');
    expect(html).toContain('data-calendar-endpoint="end"');
    expect(html).toContain("<span>In</span>");
    expect(html).toContain("<span>Out</span>");
    expect(html).toContain("Maya Rivera");
  });

  it("does not let a redundant state label displace identity on a two-column bar", () => {
    const html = renderToStaticMarkup(createElement(CalendarIntervalContent, {
      kind: "reservation",
      label: "Jonas Müller",
      operation: "Reserved",
      conflict: false,
      columnSpan: 2,
      startsBeforeWindow: true,
      endsAfterWindow: false,
      showsArrival: false,
      showsDeparture: true,
    }));

    expect(html).toContain("Jonas Müller");
    expect(html).not.toContain("Reserved");
  });

  it("gives blocks visible start and end cues without reducing their interval weight", () => {
    const html = renderToStaticMarkup(createElement(CalendarIntervalContent, {
      kind: "block",
      label: "Maintenance",
      operation: "Inventory block",
      conflict: false,
      columnSpan: 3,
      startsBeforeWindow: false,
      endsAfterWindow: false,
      showsArrival: true,
      showsDeparture: true,
    }));

    expect(html).toContain("<span>Start</span>");
    expect(html).toContain("<span>End</span>");
    expect(html).toContain("Inventory block");
    expect(html).toContain("Maintenance");
  });

  it("creates a full adjacent identity for a one-column clipped continuation", () => {
    const disclosure = calendarNarrowIntervalDisclosure({
      key: "long-stay",
      label: "Long-stay QA family",
      arrival: "2026-09-06",
      departure: "2026-09-13",
      columnSpan: 1,
      startsBeforeWindow: false,
      endsAfterWindow: true,
    });

    expect(disclosure).toEqual({
      key: "long-stay",
      label: "Long-stay QA family",
      range: expect.stringContaining("2026"),
      direction: "after",
    });
  });

  it("keeps a one-night block identifiable beside its endpoint-heavy bar", () => {
    expect(calendarNarrowIntervalDisclosure({
      key: "deep-clean",
      label: "Deep clean after maintenance",
      arrival: "2026-09-02",
      departure: "2026-09-03",
      columnSpan: 1,
      startsBeforeWindow: false,
      endsAfterWindow: false,
    })).toEqual({
      key: "deep-clean",
      label: "Deep clean after maintenance",
      range: expect.stringContaining("2026"),
      direction: "within",
    });
  });

  it("renders movement names visibly and exposes a complete accessible summary", () => {
    const html = renderToStaticMarkup(createElement(MovementSummary, {
      counts: { arrivals: 2, departures: 1, attention: 1 },
    }));

    expect(html).toContain("2 in");
    expect(html).toContain("1 out");
    expect(html).toContain("1 attention");
    expect(html).toContain('aria-label="2 arrivals, 1 departure, 1 item needing attention"');
  });

  it("renders a continuous seven-day-relative interval in compact layouts", () => {
    const html = renderToStaticMarkup(createElement(CompactCalendarInterval, {
      arrival: "2026-09-01",
      departure: "2026-09-04",
      from: "2026-08-31",
      to: "2026-09-07",
      kind: "reservation",
    }));

    expect(html).toContain('data-calendar-compact-interval="reservation"');
    expect(html).toContain("grid-column:2 / span 3");
    expect(html).toContain("3 nights");
  });
});

describe("calendar narrow-view truthfulness", () => {
  it("reuses default-locale formatters across repeated 63-day renders without caching date labels", () => {
    const first = calendarSegmentFor("2026-09-08"), second = calendarSegmentFor(first.to), third = calendarSegmentFor(second.to);
    const date = new Date(2026, 8, 8, 12);
    const expected = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
    const room = { propertyId: "property-a", roomId: "room-a", roomName: "Dorm", salesMode: "bedLevel", units: [{ propertyId: "property-a", roomId: "room-a", inventoryUnitId: "bed-a", label: "104-D", kind: "bed", isSellable: true, isTopologyActive: true }] } as RoomInventory;
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructors = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function(locale, options) { return new NativeDateTimeFormat(locale, options); });
    try {
      for (const selectedDay of ["2026-09-08", "2026-09-09"]) {
        const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CalendarWeekView, { propertyId: "property-a", dateKey: selectedDay, selectedDay, todayKey: first.from, from: first.from, to: third.to, days: calendarWindowDays([first, second, third]), onSelectDay: vi.fn(), onBook: vi.fn(), bookingEnabled: true, rooms: [room], roomState: "ready", reservations: [], blocks: [], availabilityCurrent: true, canOpenSpaces: false })));
        expect(html).toContain(expected); expect(html.match(/data-calendar-day-header=/g)).toHaveLength(63);
      }
      expect(constructors).not.toHaveBeenCalled();
    } finally { constructors.mockRestore(); }
    // Construction/render contracts, not a frame-time or native-scroll benchmark.
  });

  it("keeps explicit locale options, a one-entry formatter cache and invalid-date fallback", () => {
    const locales = ["ja-JP", "de-DE", "ja-JP"];
    const options = { month: "short", day: "numeric", year: "numeric" } as const;
    const expected = locales.map(locale => {
      const formatter = new Intl.DateTimeFormat(locale, options);
      return `${formatter.format(new Date(2026, 8, 1, 12))} – ${formatter.format(new Date(2026, 8, 14, 12))}`;
    });
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    const constructors = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function(locale, options) { return new NativeDateTimeFormat(locale, options); });
    try {
      locales.forEach((locale, index) => {
        expect(formatCalendarDateRange("2026-09-01", "2026-09-14", [locale])).toBe(expected[index]);
        expect(formatCalendarDateRange("2026-09-01", "2026-09-14", locale)).toBe(expected[index]);
        expect(formatCalendarDateRange("2026-09-01", "2026-09-14", new Intl.Locale(locale))).toBe(expected[index]);
      });
      expect(constructors).toHaveBeenCalledTimes(3);
      expect(formatCalendarDateRange("not-a-date", "2026-02-30", "bad_locale")).toBe("not-a-date – 2026-02-30");
    } finally { constructors.mockRestore(); }
  });

  it.each(([[], [new Intl.Locale("th-TH-u-ca-buddhist-nu-thai")], ["ar-EG-u-ca-islamic", "en-US"]] as const).map(list => ({ list })))("preserves readonly locale lists and Unicode calendar/numbering extensions: $list", ({ list }) => {
    const formatter = new Intl.DateTimeFormat(list, { month: "short", day: "numeric", year: "numeric" });
    const expected = `${formatter.format(new Date(2026, 8, 1, 12))} – ${formatter.format(new Date(2026, 8, 14, 12))}`;
    expect(formatCalendarDateRange("2026-09-01", "2026-09-14", list)).toBe(expected);
  });

  it("formats the complete arrival and departure range without relying on truncation", () => {
    expect(formatCalendarDateRange("2026-09-01", "2026-09-14", "en-US"))
      .toBe("Sep 1, 2026 – Sep 14, 2026");
  });

  it("withholds Free while availability sources are not current", () => {
    const free: CalendarUnitDayState = {
      availability: "free",
      reservations: [],
      blocks: [],
    };
    const occupied: CalendarUnitDayState = {
      availability: "occupied",
      reservations: [reservation("checkedIn")],
      blocks: [],
    };

    expect(unitAvailabilityLabel(free, false)).toBe("Unconfirmed");
    expect(unitAvailabilityLabel(free, true)).toBe("Free");
    expect(unitAvailabilityLabel(occupied, false)).toBe("In house");
  });
});

describe("calendar authority gate", () => {
  it("does not start domain reads from cached grants after authority becomes unconfirmed", () => {
    expect(calendarDomainQueriesEnabled("property-a", false, true)).toBe(false);
    expect(calendarDomainQueriesEnabled("property-a", true, false)).toBe(false);
    expect(calendarDomainQueriesEnabled(undefined, true, true)).toBe(false);
    expect(calendarDomainQueriesEnabled("property-a", true, true)).toBe(true);
  });
});

function reservation(status: ReservationListItem["status"]): ReservationListItem {
  return {
    reservationId: "reservation-a",
    propertyId: "property-a",
    primaryGuestName: "Maya Rivera",
    guestCount: 1,
    arrival: "2026-09-01",
    departure: "2026-09-04",
    inventoryUnitCount: 1,
    inventoryUnitIds: ["bed-a"],
    holdsInventory: true,
    status,
    sourceKind: "direct",
  } as ReservationListItem;
}
