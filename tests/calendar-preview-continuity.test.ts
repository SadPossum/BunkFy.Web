import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPage } from "../src/features/calendar/CalendarPage";
import { DashboardPage } from "../src/features/dashboard/DashboardPage";
import { TodayOperationsView } from "../src/features/dashboard/TodayOperationsView";
import { TodayVisualView } from "../src/features/dashboard/TodayVisualView";
import { CalendarWeekView } from "../src/features/calendar/CalendarWeekView";
import { DatePicker } from "../src/components/ui/DatePicker";
import { CompositeSourceNotice } from "../src/components/ui/CompositeSourceNotice";
import { compositeSourceCurrent, type CompositeSource } from "../src/app/compositeSourceState";
import { calendarInitialWindow, calendarSegmentFor, calendarViewportAt, calendarViewportScroll, calendarWindowDays } from "../src/features/calendar/calendarWindow";
import { shiftDateKey } from "../src/app/propertyDate";
import { calendarDateHasRichPresentation, calendarPresentationColumns, calendarPresentationWindow, calendarTimelineKeyScroll } from "../src/features/calendar/calendarPresentationWindow";
import { operationalOriginHref, parseOperationalPreviewRoute, withOperationalPreviewRoute, withoutOperationalPreviewRoute, type OperationalPreviewRoute } from "../src/features/operational-preview/operationalPreviewRoute";
import { mergeAccessPermissionChecks } from "../src/app/accessAuthority";
import { permissions } from "../src/app/permissions";
import type { ManualBlock, ReservationListItem } from "../src/api/types";

// Real Page/WeekView handlers and authority-key merge with controlled query
// states. Browser scroller lifetime, paint and exact focus remain aftergate proof.
const state = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], route: null as OperationalPreviewRoute | null,
  layouts: [] as (() => unknown)[],
  params: new URLSearchParams(), checks: [] as { permission: string; scope: string }[], segmentOptions: {} as Record<string, unknown>,
  open: vi.fn(), setParams: vi.fn(), denied: false, hasData: true, fetching: false, roomsEnabled: false,
  todayFetching: false, generation: 1,
  todayFetchingKey: "", todayPaused: false, todayFailureKey: "",
  todayMissingKey: "", todayErrorUpdatedAt: 0,
}));
vi.mock("react", async load => {
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const index = state.cursor++, previous = state.values[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) state.values[index] = { deps, value: factory() };
    return (state.values[index] as { value: unknown }).value;
  };
  return { ...await load<typeof import("react")>(), useEffect: vi.fn(), useLayoutEffect: (effect: () => unknown) => { state.layouts.push(effect); },
  useMemo: memo, useCallback: (callback: () => unknown, deps: unknown[]) => memo(() => callback, deps),
  useState: (initial: unknown) => { const index = state.cursor++; if (!(index in state.values)) state.values[index] = typeof initial === "function" ? initial() : initial; return [state.values[index], (value: unknown) => { state.values[index] = typeof value === "function" ? value(state.values[index]) : value; }]; },
  useRef: (initial: unknown) => { const index = state.cursor++; return state.values[index] ?? (state.values[index] = { current: initial }); },
}; });
vi.mock("react-router", async load => ({ ...await load<typeof import("react-router")>(), useLocation: () => ({ pathname: "/calendar", search: state.params.size ? `?${state.params}` : "", hash: "" }), useNavigate: () => vi.fn(), useSearchParams: () => [state.params, state.setParams] }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ request: vi.fn(), session: { tenantId: "tenant", subjectId: "actor", sessionId: "session", generation: state.generation } }) }));
vi.mock("../src/app/resourceFocus", () => ({ useTargetProperty: vi.fn() }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({ selectedPropertyId: propertyId, properties: [property], selectedProperty: property, propertiesLoaded: true, propertiesLoading: false, propertiesFetching: false, propertiesError: null, refetchProperties: vi.fn() }) }));
vi.mock("../src/app/permissions", async load => ({ ...await load<typeof import("../src/app/permissions")>(), usePermissions: (checks: typeof state.checks) => {
  state.checks = checks; return { hasData: state.hasData, isLoading: !state.hasData, isFetching: state.fetching, error: null, refetch: vi.fn(), allows: () => !state.denied && state.hasData };
} }));
vi.mock("@tanstack/react-query", async load => ({ ...await load<typeof import("@tanstack/react-query")>(), useQueryClient: () => ({}), useQuery: (options: { enabled: boolean; queryKey: string[] }) => {
  state.roomsEnabled = options.enabled;
  const data = options.queryKey[0] === "reservation-operations" ? { propertyId, localDate: "2026-09-08", timeZoneId: "Europe/London", upcoming: [] }
    : options.queryKey[0] === "reservations" ? { propertyId, localDate: "2026-09-08", reservations: [], conflictingIds: [] }
    : options.queryKey[0] === "reservation-calendar" ? [] : options.queryKey[0] === "blocks" ? { blocks: [] }
      : options.queryKey[0] === "availability" ? { propertyId, arrival: "2026-09-08", departure: "2026-09-09", units: [] } : { rooms: [room] };
  const missing = options.queryKey[0] === state.todayMissingKey;
  return { data: missing ? undefined : data, isLoading: missing, errorUpdatedAt: missing ? state.todayErrorUpdatedAt : 0, isFetching: state.todayFetching || options.queryKey[0] === state.todayFetchingKey, isPaused: state.todayPaused, error: options.queryKey[0] === state.todayFailureKey ? new Error("503") : null, refetch: vi.fn() };
} }));
vi.mock("../src/features/calendar/useCalendarSegments", () => ({ useCalendarSegments: (options: Record<string, unknown>) => {
  state.segmentOptions = options; return scheduleFixture;
} }));
vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({ useOperationalPreview: () => ({ activeRoute: state.route, openPreview: state.open }) }));
const propertyId = "11111111-1111-4111-8111-111111111111", roomId = "22222222-2222-4222-8222-222222222222", unitId = "33333333-3333-4333-8333-333333333333", reservationId = "44444444-4444-4444-8444-444444444444";
const property = { propertyId, name: "QA", timeZoneId: "Europe/London" };
const room = { propertyId, roomId, roomName: "Dorm", salesMode: "bedLevel", units: [{ propertyId, roomId, inventoryUnitId: unitId, label: "101-A", kind: "bed", isSellable: true, isTopologyActive: true }] };
const segments = calendarInitialWindow("2026-09-03");
const scheduleFixture = { segments, coverage: segments.map(segment => ({ ...segment, current: true, reservationsCurrent: true, blocksCurrent: true, conflict: false, label: "Loaded", retry: vi.fn() })), reservations: [], blocks: [], conflictIds: [], extend: vi.fn() };
type Node = ReactElement<Record<string, unknown> & { children?: unknown }>;
type OpenHandler = (record: unknown, resource: unknown, day: string, event: unknown) => void;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; const node = value as Node; return [node, ...nodes(node.props?.children)]; }
function page() { state.cursor = 0; return nodes(CalendarPage()); }
function weekProps(tree: Node[]) { return tree.find(node => node.type === CalendarWeekView)!.props as unknown as ComponentProps<typeof CalendarWeekView>; }
beforeEach(() => { state.cursor = 0; state.values = []; state.route = null; state.params = new URLSearchParams({ property: propertyId, date: "2026-09-12", day: "2026-09-08", calViewDate: "2026-09-02", calViewOffset: "946" }); state.denied = false; state.hasData = true; state.fetching = false; state.open.mockReset(); state.setParams.mockReset(); vi.stubGlobal("window", { location: { pathname: "/calendar", get search() { return state.params.size ? `?${state.params}` : ""; }, hash: "" } }); });
afterEach(() => { state.todayFetching = false; state.generation = 1; state.todayFetchingKey = ""; state.todayFailureKey = ""; state.todayMissingKey = ""; state.todayErrorUpdatedAt = 0; state.todayPaused = false; state.layouts = []; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Today first-load retry source continuity", () => {
  it.each([
    ["reservation-operations", "Today operations"],
    ["inventory-rooms", "Inventory"],
    ["blocks", "Blocks"],
    ["reservations", "Complete Today reservation details"],
    ["availability", "Tonight availability"],
  ])("keeps %s unavailable during retry, without converting untouched loading into failure", (key, label) => {
    state.params = new URLSearchParams({ property: propertyId, view: "visual" });
    const source = () => {
      state.cursor = 0;
      const notice = nodes(DashboardPage()).find(node => node.type === CompositeSourceNotice)!;
      return (notice.props.sources as CompositeSource[]).find(item => item.label === label)!;
    };
    state.todayMissingKey = key; state.todayFetchingKey = key;
    expect(source().state).toBe("loading");
    state.todayErrorUpdatedAt = 100; state.todayFailureKey = key; state.todayFetchingKey = "";
    expect(source().state).toBe("unavailable");
    state.todayFailureKey = ""; state.todayFetchingKey = key;
    expect(source()).toMatchObject({ state: "unavailable", isFetching: true });
    expect(compositeSourceCurrent(source())).toBe(false);
    state.todayFailureKey = key; state.todayFetchingKey = "";
    expect(source().state).toBe("unavailable");
    state.todayMissingKey = ""; state.todayFailureKey = "";
    expect(compositeSourceCurrent(source())).toBe(true);
    // A new query's metadata starts at zero; prior failures must not follow it.
    state.todayMissingKey = key; state.todayFetchingKey = key; state.todayErrorUpdatedAt = 0;
    expect(source().state).toBe("loading");
  });
});

describe("Today owned retry focus recovery (browser focus remains an aftergate)", () => {
  function setup() {
    class TestButton {
      disabled = false; isConnected = true;
      getAttribute = vi.fn(() => null as string | null);
      closest = vi.fn((selector: string) => selector === "button" ? this : null);
      getClientRects = vi.fn(() => [{}]);
      focus = vi.fn();
    }
    const doc = Object.assign(new EventTarget(), { body: {}, activeElement: {} as unknown });
    const retry = new TestButton(), tab = new TestButton();
    doc.activeElement = retry;
    vi.stubGlobal("Element", TestButton); vi.stubGlobal("document", doc);
    vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
    state.params = new URLSearchParams({ property: propertyId, view: "visual" });
    state.todayFailureKey = "availability";
    let capture: (event: unknown) => void, effect: () => unknown, unmount: () => void;
    const render = () => {
      state.cursor = 0; state.layouts = [];
      const tree = nodes(DashboardPage());
      const controls = tree.find(node => node.type === "div" && node.props.ref);
      if (controls) (controls.props.ref as { current: unknown }).current = { querySelector: () => tab };
      capture = tree.find(node => node.props.onClickCapture)?.props.onClickCapture as typeof capture;
      effect = state.layouts[0]; unmount = state.layouts[1]() as () => void;
      effect();
    };
    render();
    return { doc, retry, tab, render,
      activate: () => capture({ target: retry }),
      recovered: () => { state.todayFailureKey = ""; state.todayFetching = false; retry.isConnected = false; doc.activeElement = doc.body; render(); },
      cancel: (type: string, key?: string, target?: unknown) => { const event = new Event(type); if (key) Object.defineProperty(event, "key", { value: key }); if (target) Object.defineProperty(event, "target", { value: target }); doc.dispatchEvent(event); },
      unmount: () => unmount(),
    };
  }
  it("hands focused retry to the active view once after success, without scrolling", () => {
    const s = setup(); s.activate(); state.todayFetching = true; s.render();
    expect(s.tab.focus).not.toHaveBeenCalled(); s.recovered();
    expect(s.tab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    s.render(); expect(s.tab.focus).toHaveBeenCalledOnce(); s.unmount();
  });
  it("does not focus after background recovery, unfocused clicks or disabled activation", () => {
    for (const action of ["background", "unfocused", "disabled"]) {
      state.values = []; const s = setup();
      if (action === "unfocused") { s.doc.activeElement = s.doc.body; s.activate(); }
      if (action === "disabled") { s.retry.disabled = true; s.activate(); }
      s.recovered(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
    }
  });
  it.each(["focusin", "pointerdown", "Tab"])("does not reclaim deliberate %s movement even if focus later falls to BODY", input => {
    const s = setup(); s.activate(); s.cancel(input === "Tab" ? "keydown" : input, input === "Tab" ? "Tab" : undefined);
    s.recovered(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it("retains failure/partial recovery without a success handoff", () => {
    const s = setup(); s.activate(); state.todayFetching = true; s.render();
    state.todayFetching = false; s.render(); expect(s.tab.focus).not.toHaveBeenCalled();
    state.todayFailureKey = "reservations"; s.render(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it("waits for a routine same-authority recheck without abandoning owned recovery focus", () => {
    const s = setup(); s.activate(); state.fetching = true; s.recovered();
    expect(s.tab.focus).not.toHaveBeenCalled(); state.fetching = false; s.render();
    expect(s.tab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); s.unmount();
  });
  it("ignores repeated activation of an aria-disabled retry", () => {
    const s = setup(); s.retry.getAttribute.mockReturnValue("true"); s.activate();
    s.recovered(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it("keeps owned recovery when the same pending Retry receives another pointer press", () => {
    const s = setup(); s.activate(); s.retry.getAttribute.mockReturnValue("true");
    s.cancel("pointerdown", undefined, s.retry); s.activate(); s.recovered();
    expect(s.tab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); s.unmount();
  });
  it.each(["view", "route", "property", "session", "permission", "unmount"])("cancels on %s change", reason => {
    const s = setup(); s.activate();
    if (reason === "view") state.params.delete("view");
    if (reason === "route") state.params.set("op", "reservation");
    if (reason === "property") state.params.set("property", roomId);
    if (reason === "session") state.generation++;
    if (reason === "permission") state.denied = true;
    if (reason === "unmount") s.unmount(); else s.render();
    state.denied = false; state.fetching = false;
    s.recovered(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it.each(["disconnected", "disabled", "hidden", "inert", "visibility", "other focus"])("never moves focus to an invalid target or from %s", reason => {
    const s = setup(); s.activate();
    if (reason === "disconnected") s.tab.isConnected = false;
    if (reason === "disabled") s.tab.disabled = true;
    if (reason === "hidden") s.tab.getClientRects.mockReturnValue([]);
    if (reason === "inert") s.tab.closest.mockReturnValue(s.tab);
    if (reason === "visibility") vi.stubGlobal("getComputedStyle", () => ({ visibility: "hidden" }));
    if (reason === "other focus") { state.todayFailureKey = ""; s.retry.isConnected = false; s.doc.activeElement = {}; s.render(); }
    else s.recovered();
    expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
});

describe("pure Calendar Book-control bounds", () => {
  const from = "2026-08-24", to = "2026-10-26";
  const calculate = (column: number, width = 1102, current?: ReturnType<typeof calendarPresentationWindow>) => calendarPresentationWindow({ from, to, scrollLeft: column * 112, width, current });
  it("retains seven overscan dates and the exact object until crossing the three-day safety guard", () => {
    const initial = calculate(20);
    expect(initial).toEqual({ from: shiftDateKey(from, 13), to: shiftDateKey(from, 35) });
    for (const column of [21, 22, 23, 24, 23, 20, 18, 16]) expect(calculate(column, 1102, initial)).toBe(initial);
    const moved = calculate(25, 1102, initial);
    expect(moved).toEqual({ from: shiftDateKey(from, 18), to: shiftDateKey(from, 40) });
    expect(calculate(17, 1102, moved)).toEqual({ from: shiftDateKey(from, 10), to: shiftDateKey(from, 32) });
  });
  it("clamps both ends and treats an unmeasured width conservatively without a full63-day rich range", () => {
    expect(calculate(-5)).toEqual({ from, to: shiftDateKey(from, 15) });
    expect(calculate(100)).toEqual({ from: shiftDateKey(from, 55), to });
    expect(calculate(0, 0)).toEqual({ from, to: shiftDateKey(from, 16) });
    expect(calculate(Number.NaN)).toEqual(calculate(0));
  });
  it("reconciles resize, far jumps, initial short range and eviction without retaining out-of-range dates", () => {
    const initial = calculate(20);
    expect(calculate(20, 686, initial)).toBe(initial);
    expect(calculate(20, 1920, initial).to).toBe(shiftDateKey(from, 42));
    expect(calculate(55, 1102, initial)).toEqual({ from: shiftDateKey(from, 48), to });
    const short = calendarPresentationWindow({ from, to: shiftDateKey(from, 21), scrollLeft: 15 * 112, width: 1102 });
    const appended = calculate(15, 1102, short);
    expect(appended).toEqual({ from: shiftDateKey(from, 8), to: shiftDateKey(from, 30) });
    const evictedFrom = shiftDateKey(from, 21);
    expect(calendarPresentationWindow({ from: evictedFrom, to: shiftDateKey(to, 21), scrollLeft: 0, width: 686, current: initial })).toEqual({ from: evictedFrom, to: shiftDateKey(evictedFrom, 11) });
  });
  it("never turns an arbitrary selected/focused date into a huge union or changes date currentness", () => {
    const window = calculate(20);
    expect(calendarDateHasRichPresentation(window, window.from)).toBe(true);
    expect(calendarDateHasRichPresentation(window, window.to)).toBe(false);
    expect(calendarDateHasRichPresentation(window, from)).toBe(false);
    expect(Object.keys(window)).toEqual(["from", "to"]);
  });
  it("preserves exact logical columns across leading/trailing spacers, null owner and eviction", () => {
    for (const column of [-5, 0, 20, 40, 100]) {
      const range = calendarPresentationColumns(from, 63, calculate(column));
      expect(range.start + (range.end - range.start) + (63 - range.end)).toBe(63);
      expect(range.start).toBeGreaterThanOrEqual(0); expect(range.end).toBeLessThanOrEqual(63);
    }
    expect(calendarPresentationColumns(from, 63, null)).toEqual({ start: 0, end: 63 });
    expect(calendarPresentationColumns(shiftDateKey(from, 21), 63, calculate(0))).toEqual({ start: 0, end: 0 });
    expect(calendarPresentationColumns(from, 21, calculate(40))).toEqual({ start: 21, end: 21 });
  });
  it("moves one day or a bounded visible page, clamps retained edges and does not own Tab", () => {
    expect(calendarTimelineKeyScroll("ArrowLeft", 1000, 1102, 7296)).toBe(888);
    expect(calendarTimelineKeyScroll("ArrowRight", 1000, 1102, 7296)).toBe(1112);
    expect(calendarTimelineKeyScroll("PageUp", 1000, 1102, 7296)).toBe(216);
    expect(calendarTimelineKeyScroll("PageDown", 1000, 1102, 7296)).toBe(1784);
    expect(calendarTimelineKeyScroll("Home", 1000, 1102, 7296)).toBe(0);
    expect(calendarTimelineKeyScroll("End", 1000, 1102, 7296)).toBe(6194);
    expect(calendarTimelineKeyScroll("ArrowRight", 6194, 1102, 7296)).toBe(6194);
    expect(calendarTimelineKeyScroll("ArrowLeft", 0, 1102, 7296)).toBe(0);
    expect(calendarTimelineKeyScroll("PageDown", 0, 200, 7296)).toBe(112);
    expect(calendarTimelineKeyScroll("Tab", 1000, 1102, 7296)).toBeNull();
  });
});

describe("Calendar pure-append layout restoration", () => {
  function setup(initial: Partial<ComponentProps<typeof CalendarWeekView>> = {}) {
    vi.useFakeTimers();
    vi.stubGlobal("HTMLElement", class {});
    const props = { ...weekProps(page()), onViewport: vi.fn(), onExtend: vi.fn(), ...initial };
    state.values = [];
    let left = 0, sequence = 0, cleanups: (() => void)[] = [];
    const frames = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
    const cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal("requestAnimationFrame", requestFrame); vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const reads = vi.fn(() => left), writes = vi.fn((value: number) => { left = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, value)); });
    const presentation = vi.fn();
    const element = { scrollWidth: 2592, clientWidth: 1102, get scrollLeft() { return reads(); }, set scrollLeft(value: number) { writes(value); } };
    const render = (changes: Partial<ComponentProps<typeof CalendarWeekView>> = {}) => {
      state.cursor = 0; state.layouts = [];
      const current = { ...props, ...changes };
      const tree = nodes(CalendarWeekView(current));
      const view = tree.find(node => node.props["aria-label"] === "Room and bed occupancy timeline")!.props;
      (tree.find(node => node.props.update && node.props.stop)!.props.update as { current: unknown }).current = presentation;
      cleanups.forEach(cleanup => cleanup());
      (view.ref as { current: unknown }).current = element;
      element.scrollWidth = 240 + current.days.length * 112;
      cleanups = state.layouts.map(effect => effect()).filter((value): value is () => void => typeof value === "function");
      return view;
    };
    const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
    const append = { to: calendarSegmentFor(props.to).to, days: calendarWindowDays([calendarSegmentFor(props.from), calendarSegmentFor(props.to)]) };
    return { props, element, reads, writes, frames, requestFrame, cancelFrame, presentation, render, flushFrames, append, physicalLeft: () => left,
      resetIo: () => { reads.mockClear(); writes.mockClear(); requestFrame.mockClear(); cancelFrame.mockClear(); presentation.mockClear(); },
      focusChild: (view: Record<string, unknown>) => (view.onFocusCapture as (event: unknown) => void)({ currentTarget: element, target: {} }),
      nativeScroll: (view: Record<string, unknown>, value: number) => { left = value; (view.onScroll as (event: unknown) => void)({ currentTarget: element }); },
      unmount: () => cleanups.forEach(cleanup => cleanup()),
    };
  }

  it("keeps initial clamping, then skips both getter and setter on a real right-edge append", () => {
    const s = setup({ viewport: { date: "2026-09-08", offset: 0 } });
    const view = s.render(); expect(s.writes).toHaveBeenCalledWith(1680); expect(s.reads).toHaveBeenCalledOnce(); expect(s.physicalLeft()).toBe(1490);
    s.flushFrames();
    (view.onWheel as (event: unknown) => void)({ currentTarget: s.element, deltaX: 224, deltaY: 0 });
    expect(s.props.onExtend).toHaveBeenCalledWith(1);
    s.resetIo(); s.render(s.append);
    expect(s.writes).not.toHaveBeenCalled(); expect(s.reads).not.toHaveBeenCalled(); expect(s.requestFrame).not.toHaveBeenCalled(); expect(s.physicalLeft()).toBe(1490);
  });
  it("cancels the previous frame and releases its restoration flag when append arrives before that frame", () => {
    const s = setup(); s.render(); expect(s.frames.size).toBe(1); s.resetIo();
    const view = s.render(s.append);
    expect(s.cancelFrame).toHaveBeenCalledOnce(); expect(s.frames.size).toBe(0);
    expect(s.writes).not.toHaveBeenCalled(); expect(s.reads).not.toHaveBeenCalled();
    s.nativeScroll(view, 1300); vi.advanceTimersByTime(180);
    expect(s.props.onViewport).toHaveBeenCalledWith(calendarViewportAt(s.props.from, 1300));
    s.unmount(); expect(s.frames.size).toBe(0);
  });
  it.each(["prepend", "left-edge eviction", "shrink", "explicit viewport", "selected day", "room state", "room count"])("retains restoration for %s", reason => {
    const s = setup(); s.render(); s.flushFrames();
    if (["prepend", "left-edge eviction", "shrink"].includes(reason)) { s.render(s.append); s.flushFrames(); }
    s.resetIo();
    const changes: Partial<ComponentProps<typeof CalendarWeekView>> = { ...s.append };
    if (reason === "prepend") changes.from = shiftDateKey(s.props.from, -21);
    if (reason === "left-edge eviction") changes.from = shiftDateKey(s.props.from, 21);
    if (reason === "shrink") { changes.to = s.props.to; changes.days = s.props.days; }
    if (reason === "explicit viewport") changes.viewport = { date: "2026-09-07", offset: 250 };
    if (reason === "selected day") changes.selectedDay = "2026-09-09";
    if (reason === "room state") changes.roomState = "stale";
    if (reason === "room count") changes.rooms = [...s.props.rooms, { ...s.props.rooms[0], roomId: "other-room" }];
    s.render(changes);
    const from = changes.from ?? s.props.from;
    const position = reason === "left-edge eviction" ? { date: from, offset: 0 } : changes.viewport ?? s.props.viewport!;
    expect(s.writes).toHaveBeenCalledWith(Math.max(0, calendarViewportScroll(from, position)));
    expect(s.reads).toHaveBeenCalledOnce(); expect(s.requestFrame).toHaveBeenCalledOnce();
    s.unmount(); expect(s.frames.size).toBe(0);
  });
  it("restores explicit viewport changes and the exact previous viewport on Back/Forward-style input", () => {
    const s = setup(); s.render(); s.flushFrames(); s.resetIo();
    const jumped = { date: "2026-09-07", offset: 250 };
    for (const viewport of [jumped, s.props.viewport!, jumped]) { s.render({ viewport }); s.flushFrames(); }
    expect(s.writes.mock.calls.map(([value]) => value)).toEqual([jumped, s.props.viewport!, jumped].map(viewport => calendarViewportScroll(s.props.from, viewport)));
    expect(s.reads).toHaveBeenCalledTimes(3);
  });
  it("does not skip a previously out-of-window requested viewport that becomes admitted on append", () => {
    const future = calendarSegmentFor(calendarSegmentFor("2026-09-03").to).from;
    const s = setup({ viewport: { date: future, offset: 125 } }); s.render(); s.flushFrames(); s.resetIo();
    s.render(s.append);
    expect(s.writes).toHaveBeenCalledWith(calendarViewportScroll(s.props.from, { date: future, offset: 125 })); expect(s.reads).toHaveBeenCalledOnce();
  });
  it("retains selected-day fallback when an out-of-window position is evicted", () => {
    const s = setup({ viewport: { date: "2026-09-02", offset: 500 }, selectedDay: "2026-09-08" }); s.render(); s.flushFrames(); s.resetIo();
    s.render({ from: "2026-09-07", ...s.append });
    expect(s.writes).toHaveBeenCalledWith(112); expect(s.reads).toHaveBeenCalledOnce();
  });

  it("persists actual focus-scroll through subsequent Tab focus, then consumes only its exact echo without scroll IO or presentation growth", () => {
    const s = setup(); const view = s.render(); s.flushFrames(); s.resetIo();
    s.focusChild(view); s.nativeScroll(view, 700);
    vi.advanceTimersByTime(100); s.focusChild(view); vi.advanceTimersByTime(80);
    const published = calendarViewportAt(s.props.from, 700);
    expect(s.props.onViewport).toHaveBeenCalledExactlyOnceWith(published);
    expect(s.props.onExtend).not.toHaveBeenCalled(); expect(s.presentation).not.toHaveBeenCalled();
    s.resetIo(); s.render({ viewport: published });
    expect(s.reads).not.toHaveBeenCalled(); expect(s.writes).not.toHaveBeenCalled();
    expect(s.presentation).not.toHaveBeenCalled(); expect(s.requestFrame).not.toHaveBeenCalled();
    expect(s.physicalLeft()).toBe(700);
    // The token is single-use: Back and then Forward to those same coordinates restore normally.
    s.render({ viewport: s.props.viewport }); s.flushFrames(); s.resetIo();
    s.render({ viewport: published });
    expect(s.writes).toHaveBeenCalledWith(calendarViewportScroll(s.props.from, published));
    expect(s.presentation).toHaveBeenCalledWith(true);
  });

  it.each(["viewport", "property", "range", "date", "selected day", "room state"])("does not suppress restoration for a divergent %s after a published focus update", boundary => {
    const s = setup(); const view = s.render(); s.flushFrames();
    s.focusChild(view); s.nativeScroll(view, 700); vi.advanceTimersByTime(180); s.resetIo();
    const published = calendarViewportAt(s.props.from, 700);
    const changes: Partial<ComponentProps<typeof CalendarWeekView>> = { viewport: published };
    if (boundary === "viewport") changes.viewport = { date: "2026-09-07", offset: 250 };
    if (boundary === "property") changes.propertyId = "different-property";
    if (boundary === "range") Object.assign(changes, s.append);
    if (boundary === "date") changes.dateKey = "2026-09-09";
    if (boundary === "selected day") changes.selectedDay = "2026-09-09";
    if (boundary === "room state") changes.roomState = "stale";
    s.render(changes);
    expect(s.writes).toHaveBeenCalledOnce(); expect(s.presentation).toHaveBeenCalledWith(true);
    s.flushFrames(); s.resetIo();
    s.render({ viewport: published });
    expect(s.writes).toHaveBeenCalledOnce(); // A mismatch consumed, not preserved, the old token.
  });

  it("cancels a queued pre-navigation focus write and ignores restoration-generated scroll", () => {
    const s = setup(); const view = s.render(); s.flushFrames();
    s.focusChild(view); s.nativeScroll(view, 700); vi.advanceTimersByTime(100);
    const next = s.render({ viewport: { date: "2026-09-07", offset: 250 } });
    s.nativeScroll(next, 1490); vi.advanceTimersByTime(180);
    expect(s.props.onViewport).not.toHaveBeenCalled();
    s.unmount(); expect(s.frames.size).toBe(0);
  });

  it("cannot consume a previous mount's published echo after remount", () => {
    const s = setup(); const view = s.render(); s.flushFrames();
    s.focusChild(view); s.nativeScroll(view, 700); vi.advanceTimersByTime(180);
    const published = calendarViewportAt(s.props.from, 700);
    s.unmount(); state.values = []; s.resetIo();
    s.render({ viewport: published });
    expect(s.writes).toHaveBeenCalledWith(calendarViewportScroll(s.props.from, published));
    expect(s.presentation).toHaveBeenCalledWith(true);
  });
});

describe("Calendar bounded native edge intent", () => {
  function setup() {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.useFakeTimers();
    const props = { ...weekProps(page()), onExtend: vi.fn(), onViewport: vi.fn() };
    state.values = [];
    const element = { scrollLeft: 1490, scrollWidth: 2592, clientWidth: 1102, scrollTo: vi.fn() };
    const render = (changes: Partial<ComponentProps<typeof CalendarWeekView>> = {}) => {
      state.cursor = 0;
      return nodes(CalendarWeekView({ ...props, ...changes })).find(node => node.props["aria-label"] === "Room and bed occupancy timeline")!.props;
    };
    const wheel = (view: ReturnType<typeof render>, deltaX = 224, deltaY = 0, modifiers = {}) => {
      const event = { currentTarget: element, deltaX, deltaY, preventDefault: vi.fn(), ...modifiers };
      (view.onWheel as (event: unknown) => void)(event); expect(event.preventDefault).not.toHaveBeenCalled();
    };
    const key = (view: ReturnType<typeof render>, key: string, extra = {}) => {
      const event = { currentTarget: element, target: element, key, preventDefault: vi.fn(), ...extra };
      (view.onKeyDown as (event: unknown) => void)(event); return event;
    };
    const scroll = (view: ReturnType<typeof render>, left: number) => {
      element.scrollLeft = left; (view.onScroll as (event: unknown) => void)({ currentTarget: element });
    };
    return { props, element, render, wheel, key, scroll };
  }

  it.each([-1, 1] as const)("extends initial clamp %s once across wheel, keyboard and scroll intent", direction => {
    const { props, element, render, wheel, key, scroll } = setup();
    element.scrollLeft = direction < 0 ? 0 : 1490;
    const view = render();
    for (let i = 0; i < 8; i++) wheel(view, direction * 224);
    key(view, direction < 0 ? "Home" : "End"); scroll(view, direction < 0 ? 10 : 1480);
    expect(props.onExtend.mock.calls).toEqual([[direction]]);
  });
  it.each(["ArrowLeft", "PageUp", "ArrowRight", "PageDown"])("recognizes %s at its clamp without waiting for a scroll event", command => {
    const { props, element, render, key } = setup();
    const direction = command === "ArrowLeft" || command === "PageUp" ? -1 : 1;
    element.scrollLeft = direction < 0 ? 0 : 1490;
    expect(key(render(), command).preventDefault).toHaveBeenCalledOnce();
    expect(props.onExtend.mock.calls).toEqual([[direction]]); expect(element.scrollTo).toHaveBeenCalledOnce();
  });
  it.each(["Home", "End"])("keeps %s within retained bounds even when its native scroll event follows", command => {
    const { props, render, key, scroll } = setup(); const view = render();
    expect(key(view, command).preventDefault).toHaveBeenCalledOnce();
    scroll(view, command === "Home" ? 0 : 1490);
    expect(props.onExtend).not.toHaveBeenCalled();
  });
  it("leaves vertical/modified wheels and child/modified keys alone, and does not fetch for ordinary interior keys", () => {
    const { props, element, render, wheel, key } = setup(); const view = render();
    wheel(view, 0, 224); wheel(view, 10, 224); wheel(view, 224, 224); wheel(view, 224, 0, { ctrlKey: true });
    expect(key(view, "End", { target: {} }).preventDefault).not.toHaveBeenCalled();
    expect(key(view, "End", { shiftKey: true }).preventDefault).not.toHaveBeenCalled();
    element.scrollLeft = 700; wheel(view); key(view, "ArrowRight");
    expect(props.onExtend).not.toHaveBeenCalled();
  });
  it("coalesces near-edge scroll with wheel and retains the debounced logical viewport callback", () => {
    const { props, render, wheel, scroll } = setup(); const view = render();
    scroll(view, 1300); scroll(view, 1490); wheel(view);
    expect(props.onExtend.mock.calls).toEqual([[1]]); expect(props.onViewport).not.toHaveBeenCalled();
    vi.advanceTimersByTime(180); expect(props.onViewport).toHaveBeenCalledOnce();
  });
  it("captures the actual clamped position rather than restoring the unreachable requested offset", () => {
    const { props, element, render, wheel } = setup();
    const actual = calendarViewportAt(props.from, element.scrollLeft);
    expect(actual).not.toEqual(props.viewport);
    wheel(render());
    state.cursor = 0;
    const row = nodes(CalendarWeekView(props)).find(node => node.props.onOpenReservation && node.props.onOpenBlock)!;
    const resource = { inventoryUnitId: unitId, roomId, roomName: "Dorm", label: "101-A", detail: "Bed", isPrivateRoom: false };
    (row.props.onOpenReservation as OpenHandler)({ reservationId, propertyId } as ReservationListItem, resource, "2026-09-03", { currentTarget: {} });
    expect(state.open.mock.calls[0][0].route.origin.viewport).toEqual(actual);
  });
  it("resets for range/property changes and owner freeze without poisoning ignored intent", () => {
    const { props, render, wheel } = setup();
    wheel(render()); wheel(render()); expect(props.onExtend).toHaveBeenCalledTimes(1);
    wheel(render({ viewportFrozen: true })); expect(props.onExtend).toHaveBeenCalledTimes(1);
    wheel(render()); expect(props.onExtend).toHaveBeenCalledTimes(2);
    wheel(render({ from: "2026-08-03", to: "2026-09-14" })); expect(props.onExtend).toHaveBeenCalledTimes(3);
    wheel(render({ propertyId: "other-property" })); expect(props.onExtend).toHaveBeenCalledTimes(4);
    wheel(render({ onExtend: undefined })); wheel(render()); expect(props.onExtend).toHaveBeenCalledTimes(5);
  });
  it("does not re-arm the same range when background renders replace the parent callback", () => {
    const { render, wheel } = setup(); const first = vi.fn(), refreshed = vi.fn();
    const view = render({ onExtend: first }); wheel(view); wheel(view);
    expect(first).toHaveBeenCalledOnce();
    wheel(render({ onExtend: refreshed })); expect(refreshed).not.toHaveBeenCalled();
    wheel(render({ onExtend: refreshed, to: "2026-10-05" })); expect(refreshed).toHaveBeenCalledOnce();
    // Read denial unmounts the Page child; authority keys also remount it.
    // Retained callbacks are not an extra authority or eligibility controller.
  });
});

describe("Calendar preview source continuity", () => {
  it("reuses dates, complete row models and callbacks across viewport-only renders, invalidating real row inputs", () => {
    const firstPage = weekProps(page());
    state.params.set("calViewOffset", "100");
    expect(weekProps(page()).days).toBe(firstPage.days);
    state.values = [];
    const render = (changes: Partial<ComponentProps<typeof CalendarWeekView>> = {}) => {
      state.cursor = 0; state.layouts = [];
      const tree = nodes(CalendarWeekView({ ...firstPage, ...changes }));
      state.layouts.forEach(effect => effect());
      return tree.find(node => node.props.dayStates)!.props;
    };
    const row = render(), panned = render({ viewport: { date: "2026-09-04", offset: 400 } });
    for (const key of ["days", "dayStates", "reservations", "blocks", "onOpenReservation", "onOpenBlock", "onBook"]) expect(panned[key]).toBe(row[key]);
    const changed = render({ reservations: [{ reservationId, propertyId, arrival: "2026-09-08", departure: "2026-09-10", holdsInventory: true, inventoryUnitIds: [unitId], status: 2 } as ReservationListItem] });
    expect(changed.dayStates).not.toBe(row.dayStates); expect(changed.reservations).not.toBe(row.reservations);
    const stale = render({ coverage: firstPage.coverage!.map(segment => ({ ...segment, current: false })), bookingEnabled: false });
    expect(stale.coverage).not.toBe(row.coverage); expect(stale.bookingEnabled).toBe(false);
    expect(render({ selectedDay: "2026-09-09" }).selectedDay).toBe("2026-09-09");
    expect(render({ todayKey: "2026-09-10" }).todayKey).toBe("2026-09-10");
    const topology = render({ rooms: firstPage.rooms.map(room => ({ ...room, units: room.units.map(unit => ({ ...unit, label: "Renamed" })) })) });
    expect(topology.resource).not.toBe(row.resource); expect(topology.dayStates).not.toBe(row.dayStates);
  });
  it("stable preview callbacks dispatch through the current provider, with current selection/property and actual panned origin", () => {
    const props = weekProps(page()); state.values = [];
    const render = (changes: Partial<ComponentProps<typeof CalendarWeekView>> = {}) => {
      state.cursor = 0; state.layouts = [];
      const tree = nodes(CalendarWeekView({ ...props, ...changes })); state.layouts.forEach(effect => effect());
      return { row: tree.find(node => node.props.dayStates)!.props, timeline: tree.find(node => node.props["aria-label"] === "Room and bed occupancy timeline")!.props };
    };
    const first = render(), original = state.open; state.open = vi.fn();
    const next = render(); expect(next.row.onOpenReservation).toBe(first.row.onOpenReservation);
    (next.timeline.onScroll as (event: unknown) => void)({ currentTarget: { scrollLeft: 900, scrollWidth: 4000, clientWidth: 1000 } });
    (next.row.onOpenReservation as OpenHandler)({ reservationId }, next.row.resource, "2026-09-03", { currentTarget: {} });
    expect(original).not.toHaveBeenCalled(); expect(state.open.mock.calls[0][0].route.origin.viewport).toEqual(calendarViewportAt(props.from, 900));
    const scoped = render({ propertyId: "new-property", dateKey: "2026-09-19", selectedDay: "2026-09-15" });
    (scoped.row.onOpenBlock as OpenHandler)({ blockId: "new-block" }, scoped.row.resource, "2026-09-15", { currentTarget: {} });
    expect(state.open.mock.calls[1][0].route).toMatchObject({ selection: { propertyId: "new-property", date: "2026-09-15" }, origin: { propertyId: "new-property", date: "2026-09-19", day: "2026-09-15" } });
  });
  it("a retained booking dispatcher uses the committed permission/currentness and origin, not its initial render", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    const initial = weekProps(page()); state.layouts.forEach(effect => effect()); state.layouts = [];
    const resource = { inventoryUnitId: unitId, roomId, roomName: "Dorm", label: "101-A", detail: "Bed", isPrivateRoom: false };
    state.fetching = true; const refreshing = weekProps(page()); state.layouts.forEach(effect => effect()); state.layouts = [];
    expect(refreshing.onBook).toBe(initial.onBook);
    initial.onBook!(resource, "2026-09-10"); expect(state.values.some(value => Boolean(value && typeof value === "object" && "context" in value))).toBe(false);
    state.fetching = false; state.params.set("date", "2026-09-11"); state.params.set("day", "2026-09-10"); page(); state.layouts.forEach(effect => effect());
    initial.onBook!(resource, "2026-09-10", { date: "2026-09-09", offset: 123 });
    const owned = state.values.find(value => Boolean(value && typeof value === "object" && "context" in value));
    expect(owned).toMatchObject({ context: { origin: { date: "2026-09-11", day: "2026-09-10", viewport: { date: "2026-09-09", offset: 123 } } } });
  });
  it.each(["reservation", "block"])("keeps source dates/viewport separate from clicked %s day", kind => {
    vi.useFakeTimers();
    const props = weekProps(page()); state.values = []; state.cursor = 0;
    const onViewport = vi.fn();
    const tree = nodes(CalendarWeekView({ ...props, onViewport }));
    const row = tree.find(node => node.props?.onOpenReservation && node.props?.onOpenBlock)!;
    const resource = { inventoryUnitId: unitId, roomId, roomName: "Dorm", label: "101-A", detail: "Bed", isPrivateRoom: false };
    const trigger = {};
    const view = tree.find(node => node.props["aria-label"] === "Room and bed occupancy timeline")!.props;
    const readLeft = vi.fn(() => calendarViewportScroll(props.from, props.viewport!));
    const timeline = { contains: (node: unknown) => node === trigger, get scrollLeft() { return readLeft(); }, scrollWidth: 4000, clientWidth: 1000 };
    (view.ref as { current: unknown }).current = timeline;
    (view.onScroll as (event: unknown) => void)({ currentTarget: { ...timeline, scrollLeft: readLeft() - 112 } });
    expect(vi.getTimerCount()).toBe(1); readLeft.mockClear();
    if (kind === "reservation") (row.props.onOpenReservation as OpenHandler)({ reservationId, propertyId } as ReservationListItem, resource, "2026-09-03", { currentTarget: trigger });
    else (row.props.onOpenBlock as OpenHandler)({ blockId: reservationId, blockGroupId: reservationId, propertyId } as ManualBlock, resource, "2026-09-03", { currentTarget: trigger });
    expect(readLeft).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(180); expect(onViewport).not.toHaveBeenCalled();
    const opened = state.open.mock.calls[0][0];
    expect(opened.route.origin).toEqual({ surface: "calendar", propertyId, date: "2026-09-12", day: "2026-09-08", viewport: { date: "2026-09-02", offset: 946 } });
    expect(opened.route.selection.date).toBe("2026-09-03"); expect(opened.trigger).toBe(trigger);
    const parsed = parseOperationalPreviewRoute(withOperationalPreviewRoute(state.params, opened.route)); expect(parsed).toEqual(opened.route);
    const back = new URL(operationalOriginHref(opened.route), "https://example.test");
    expect([...withoutOperationalPreviewRoute(back.searchParams)].sort()).toEqual([...state.params].sort());
  });
  it("preserves Calendar authority/query identity through open and close while retaining clicked-day ownership", () => {
    const before = page(), beforeView = weekProps(before), keys = state.checks, anchor = state.segmentOptions.anchor;
    const previewChecks = [permissions.reservationsRead, permissions.inventoryRead, permissions.propertiesRead, permissions.reservationsCheckIn, permissions.reservationsCheckOut].map(permission => ({ permission, scope: keys[0].scope }));
    expect(mergeAccessPermissionChecks([keys, previewChecks])).toEqual(mergeAccessPermissionChecks([keys]));
    state.route = { selection: { kind: "reservation", propertyId, reservationId, date: "2026-09-03" }, origin: { surface: "calendar", propertyId, date: "2026-09-12", day: "2026-09-08", viewport: { date: "2026-09-02", offset: 946 } } };
    const during = page(); expect(state.checks).toEqual(keys); expect(state.segmentOptions.anchor).toBe(anchor); expect(state.segmentOptions.ownedDay).toBe("2026-09-03"); expect(state.segmentOptions.frozen).toBe(true);
    expect(weekProps(during).dateKey).toBe(beforeView.dateKey); expect(weekProps(during).selectedDay).toBe(beforeView.selectedDay);
    state.route = null; const after = page(); expect(state.checks).toEqual(keys); expect(weekProps(after).dateKey).toBe(beforeView.dateKey); expect(state.segmentOptions.frozen).toBe(false);
  });
  it("shows the panned date in Jump without changing the selected/action day on scroll", () => {
    const tree = page(), picker = tree.find(node => node.type === DatePicker)!;
    expect(picker.props.value).toBe("2026-09-02"); expect(picker.props.ariaLabel).toBe("Jump timeline to date"); expect(weekProps(tree).selectedDay).toBe("2026-09-08");
    weekProps(tree).onViewport!({ date: "2026-08-24", offset: 0 });
    const next = state.setParams.mock.calls[0][0] as URLSearchParams; expect(next.get("date")).toBe("2026-09-12"); expect(next.get("day")).toBe("2026-09-08"); expect(next.get("calViewDate")).toBe("2026-08-24");
  });
  it.each(["denied", "not evaluated", "refreshing"])("does not turn preregistration into current booking authority: %s", condition => {
    state.denied = condition === "denied"; state.hasData = condition !== "not evaluated"; state.fetching = condition === "refreshing";
    const tree = page();
    if (condition === "refreshing") { expect(weekProps(tree).bookingEnabled).toBe(false); expect(state.segmentOptions.current).toBe(false); }
    else { expect(state.roomsEnabled).toBe(false); expect(tree.some(node => node.type === CalendarWeekView)).toBe(false); }
  });
  it.each(["visual", "operations"])("keeps Today %s evaluations equal to the preview union without changing current content", view => {
    state.params = new URLSearchParams({ property: propertyId, view });
    const child = view === "visual" ? TodayVisualView : TodayOperationsView;
    const render = () => { state.cursor = 0; return nodes(DashboardPage()); };
    const before = render(), keys = state.checks;
    expect(before.some(node => node.type === child)).toBe(true);
    const previewChecks = [permissions.reservationsRead, permissions.inventoryRead, permissions.propertiesRead, permissions.reservationsCheckIn, permissions.reservationsCheckOut].map(permission => ({ permission, scope: keys[0].scope }));
    expect(mergeAccessPermissionChecks([keys, previewChecks])).toEqual(mergeAccessPermissionChecks([keys]));
    state.route = { selection: { kind: "reservation", propertyId, reservationId, date: "2026-09-08" }, origin: { surface: "today", propertyId, view: view as "visual" | "operations" } };
    state.params = withOperationalPreviewRoute(state.params, state.route);
    expect(render().some(node => node.type === child)).toBe(true); expect(state.checks).toEqual(keys);
    state.params = withoutOperationalPreviewRoute(state.params); state.route = null;
    expect(render().some(node => node.type === child)).toBe(true); expect(state.checks).toEqual(keys);
    state.denied = true; expect(render().some(node => node.type === child)).toBe(false);
    state.denied = false; state.hasData = false; expect(render().some(node => node.type === child)).toBe(false);
  });
  it("keeps matching Today facts usable during routine data and permission refresh without claiming currentness", () => {
    state.params = new URLSearchParams({ property: propertyId, view: "visual" });
    const render = () => { state.cursor = 0; return nodes(DashboardPage()).find(node => node.type === TodayVisualView)!; };
    const before = render(); expect(before.props.current).toBe(true); expect(before.props.availabilityState).toBe("ready");
    state.todayFetching = true; state.fetching = true;
    const refreshing = render(); expect(refreshing.key).toBe(before.key); expect(refreshing.props.current).toBe(false);
    expect(refreshing.props.availabilityState).toBe("ready"); expect(refreshing.props.roomState).toBe("ready");
    expect(refreshing.props.reservationState).toBe("ready"); expect(refreshing.props.availability).toEqual(before.props.availability);
    state.todayFetching = false; state.fetching = false; expect(render().props.current).toBe(true);
  });
  it.each([["availability", "Availability"], ["reservations", "Reservations"], ["reservation-operations", "Summary"]])("qualifies only the actual %s refresh while retaining all currentness gates", (key, label) => {
    state.params = new URLSearchParams({ property: propertyId, view: "visual" });
    const render = () => { state.cursor = 0; return nodes(DashboardPage()).find(node => node.type === TodayVisualView)!; };
    const initial = render(); state.todayFetchingKey = key;
    const updating = render(); expect(updating.props.current).toBe(false); expect(updating.props.routineRefresh).toBe(true);
    expect(JSON.stringify(updating.props.sourceStatus)).toContain(`${label}: updating`);
    expect(updating.key).toBe(initial.key); expect(updating.props.reservations).toEqual(initial.props.reservations);
    state.todayPaused = true; expect(render().props.routineRefresh).toBe(false);
    state.todayPaused = false; state.todayFailureKey = key; expect(render().props.routineRefresh).toBe(false);
    state.todayFailureKey = ""; state.fetching = true; expect(render().props.routineRefresh).toBe(false);
    state.fetching = false; state.denied = true; expect(render()).toBeUndefined();
  });
});
