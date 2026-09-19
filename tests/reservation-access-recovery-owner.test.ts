import { useEffect, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { Reservation, ReservationListItem, ReservationListResponse } from "../src/api/types";
import { ReservationsPage } from "../src/features/reservations/ReservationsPage";
import { CreateReservationModal } from "../src/features/reservations/CreateReservationModal";
import { ReservationDetail } from "../src/features/reservations/ReservationDetail";
import { CompositeSourceNotice } from "../src/components/ui/CompositeSourceNotice";
import { compositeSourceCurrent } from "../src/app/compositeSourceState";
import { newReservationRecoveryCoordinate, type ReservationRecoverySnapshot } from "../src/features/reservations/reservationCreationRecovery";
import { calendarBookingHref, calendarBookingReturnHref, type CalendarBookingContext } from "../src/features/calendar/calendarBookingRoute";
import { completedReservationCreateHref, completedReservationReturnHref, parseCompletedReservationCreateContext } from "../src/features/reservations/completedReservationCreate";

// Run the real page owner through render transitions with deterministic hooks and
// query/router doubles. The real creator/reset markup is tested separately; browser
// layout, provider network timing and native focus remain independent review gates.
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], changed: false,
  layouts: [] as (() => unknown)[], leaseKey: 0,
  error: null as unknown, loaded: true, fetching: false, allowed: true, propertyId: "",
  accessComplete: true, accessLoading: false, accessFetching: false, inventoryAllowed: true, readAllowed: true,
  session: {} as Record<string, string | number>, params: new URLSearchParams(),
  directory: undefined as ReservationListResponse | undefined, operatingDate: undefined as string | undefined, completed: undefined as Reservation | undefined,
  completedFetching: false, completedFetched: true, completedError: null as unknown, queryOptions: [] as { queryKey: unknown[]; enabled?: boolean; queryFn?: (options: { signal: AbortSignal }) => unknown }[],
  queryState: {} as Record<string, { error?: unknown; isLoading?: boolean; isFetching?: boolean; isPaused?: boolean; errorUpdatedAt?: number }>,
  affected: [] as { error?: unknown; isLoading?: boolean; isFetching?: boolean; isPaused?: boolean; errorUpdatedAt?: number }[],
  snapshot: { kind: "none" } as ReservationRecoverySnapshot, raw: null as string | null,
  navigate: vi.fn(), setParams: vi.fn(), cancelQueries: vi.fn(async () => undefined), accessRetry: vi.fn(async () => undefined), propertyRetry: vi.fn(async () => undefined), request: vi.fn(),
}));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => { const index = hooks.cursor++; return hooks.slots[index] ?? (hooks.slots[index] = { current: initial }); },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: unknown) => {
      const next = typeof value === "function" ? value(hooks.slots[index]) : value;
      if (!Object.is(next, hooks.slots[index])) { hooks.slots[index] = next; hooks.changed = true; }
    }];
  },
  useMemo: (factory: () => unknown) => factory(), useDeferredValue: (value: unknown) => value,
  useEffect: vi.fn(), useLayoutEffect: (effect: () => unknown) => { hooks.layouts.push(effect); },
}));
vi.mock("react-router", async (original) => ({ ...await original<typeof import("react-router")>(),
  useNavigate: () => hooks.navigate, useSearchParams: () => [hooks.params, hooks.setParams],
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ session: hooks.session, request: hooks.request }) }));
vi.mock("../src/app/routeNavigationLease", () => ({ useCurrentRouteNavigationLease: () => ({ editorKey: hooks.leaseKey, reportOwner: vi.fn() }) }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({
  selectedPropertyId: hooks.propertyId, selectedProperty: hooks.loaded ? property() : null,
  properties: hooks.loaded ? [property()] : [], propertiesLoaded: hooks.loaded, propertiesLoading: !hooks.loaded,
  propertiesFetching: hooks.fetching, propertiesError: null, refetchProperties: hooks.propertyRetry,
}) }));
vi.mock("../src/app/permissions", async (original) => ({ ...await original<typeof import("../src/app/permissions")>(),
  usePermissions: () => ({ hasData: hooks.accessComplete, isLoading: hooks.accessLoading, isFetching: hooks.accessFetching, error: hooks.error, refetch: hooks.accessRetry,
    allows: (permission: string) => permission === "reservations.create" ? hooks.allowed : permission === "reservations.read" ? hooks.readAllowed : permission === "inventory.read" ? hooks.inventoryAllowed : true }),
}));
vi.mock("../src/app/resourceFocus", async (original) => ({ ...await original<typeof import("../src/app/resourceFocus")>(), useTargetProperty: vi.fn(), useTransientResourceFocus: () => null }));
vi.mock("../src/features/reservations/useReservationCreationRecovery", () => ({ useReservationCreationRecovery: () => ({ snapshot: hooks.snapshot, refresh: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined), cancelQueries: hooks.cancelQueries }),
  useQuery: (options: { queryKey: unknown[]; enabled?: boolean; queryFn?: (options: { signal: AbortSignal }) => unknown }) => { const { queryKey } = options; hooks.queryOptions.push(options); return ({
    data: queryKey[2] === "completed-create" ? hooks.completed : queryKey[0] === "reservations" && queryKey[2] === "directory" ? hooks.directory
      : queryKey[0] === "reservation-operations" && hooks.operatingDate ? { localDate: hooks.operatingDate } : undefined,
    error: null, isLoading: false, isFetching: false, isPaused: false, errorUpdatedAt: 0, refetch: vi.fn(),
    ...hooks.queryState[String(queryKey[0])],
    ...(queryKey[2] === "completed-create" ? { isFetchedAfterMount: hooks.completedFetched, isFetching: hooks.completedFetching, error: hooks.completedError } : {}),
  }); }, useQueries: () => hooks.affected.map(query => ({ data: undefined, error: null, isLoading: false,
    isFetching: false, isPaused: false, errorUpdatedAt: 0, refetch: vi.fn(), ...query })),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = { tenantId: id(1), subjectId: id(2), sessionId: id(3), generation: "generation-1", username: "synthetic", accessToken: "not-a-token" };
function property() { return { propertyId: hooks.propertyId, name: "Synthetic property", timeZoneId: "Europe/London" }; }
type Creator = ReactElement<ComponentProps<typeof CreateReservationModal>>;
function elements(value: unknown): ReactElement<{ children?: unknown }>[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object") return [];
  const node = value as ReactElement<{ children?: unknown }>; return [node, ...elements(node.props?.children)];
}
function renderTree() {
  let tree: ReturnType<typeof ReservationsPage>;
  let renders = 0;
  do { hooks.cursor = 0; hooks.changed = false; hooks.layouts = []; tree = ReservationsPage(); if (++renders > 5) throw new Error("Owner did not settle"); } while (hooks.changed);
  return elements(tree);
}
function render() { return renderTree().find((element) => element.type === CreateReservationModal) as Creator | undefined; }
function detail() { return renderTree().find((element) => element.type === ReservationDetail) as ReactElement<ComponentProps<typeof ReservationDetail>>; }
beforeEach(() => {
  Object.assign(hooks, { cursor: 0, slots: [], changed: false, error: null, loaded: true, fetching: false, allowed: true,
    accessComplete: true, accessLoading: false, accessFetching: false, inventoryAllowed: true, readAllowed: true,
    directory: undefined, operatingDate: undefined, queryState: {}, affected: [], layouts: [], leaseKey: 0,
    completed: undefined, completedFetching: false, completedFetched: true, completedError: null, queryOptions: [],
    propertyId: id(4), session: { ...session }, params: new URLSearchParams({ property: id(4), new: "1" }), snapshot: { kind: "none" }, raw: null });
  vi.clearAllMocks(); vi.stubGlobal("window", { sessionStorage: { getItem: () => hooks.raw } });
});
afterEach(() => vi.unstubAllGlobals());

describe("completed reservation fresh create entry through the real Page", () => {
  function setup() {
    const href = completedReservationCreateHref({ selection: { kind: "reservation", propertyId: id(4), reservationId: id(19), date: "2026-09-09" }, origin: { surface: "calendar", propertyId: id(4), date: "2026-09-27", day: "2026-09-12", viewport: { date: "2026-09-09", offset: 18 } } })!;
    hooks.params = new URLSearchParams(href.split("?")[1]);
    hooks.completed = { propertyId: id(4), reservationId: id(19), status: 10, holdsInventory: false, primaryGuestName: "QA completed", email: null, phone: null, guestCount: 2, inventoryUnitIds: [id(7)], version: 1 } as Reservation;
    return parseCompletedReservationCreateContext(hooks.params)!;
  }
  const query = () => hooks.queryOptions.filter(q => q.queryKey[2] === "completed-create").at(-1)!;
  it("requires a fresh authorized exact detail after entry/reload and preserves creator identity on refetch/version advance", () => {
    setup(); hooks.completedFetched = false; const initial = render()!; expect(initial.props.completedSource?.seed).toBeNull(); expect(query().enabled).toBe(true);
    hooks.completedFetched = true; const current = render()!; expect(current.props.completedSource?.seed?.primaryGuestName).toBe("QA completed"); expect(current.key).toBe(initial.key);
    hooks.completedFetching = true; expect(render()!.props.completedSource?.seed?.primaryGuestName).toBe("QA completed"); expect(compositeSourceCurrent(render()!.props.completedSource!.source)).toBe(false); hooks.completedFetching = false;
    hooks.completed = { ...hooks.completed!, version: 9 }; expect(render()!.key).toBe(initial.key);
    hooks.completedError = new ApiError("503", 503); expect(render()!.props.completedSource?.seed).toBeNull();
  });
  it("uses the exact GET and abort signal, cancels on read denial/unmount, and changes the key with identity", async () => {
    setup(); render(); const original = query(), controller = new AbortController();
    await original.queryFn!({ signal: controller.signal }); expect(hooks.request).toHaveBeenCalledWith(`/api/reservations/properties/${id(4)}/${id(19)}`, { signal: controller.signal });
    // Invoke the actual query-custody effect, selected by its exact query-key dependency.
    const custody = vi.mocked(useEffect).mock.calls.find(([, deps]) => deps?.some(dep => Array.isArray(dep) && dep[2] === "completed-create"))!;
    const cleanup = custody[0](); expect(typeof cleanup).toBe("function"); if (typeof cleanup === "function") cleanup();
    expect(hooks.cancelQueries).toHaveBeenCalledWith({ queryKey: original.queryKey, exact: true });
    hooks.readAllowed = false; vi.mocked(useEffect).mockClear(); expect(render()!.props.completedSource?.seed).toBeNull(); expect(query().enabled).toBe(false);
    const denied = vi.mocked(useEffect).mock.calls.find(([, deps]) => deps?.some(dep => Array.isArray(dep) && dep[2] === "completed-create"))!; denied[0]();
    expect(hooks.cancelQueries).toHaveBeenCalledTimes(2);
    hooks.session = { ...hooks.session, generation: "next" }; render(); expect(query().queryKey).not.toEqual(original.queryKey);
    hooks.readAllowed = true; hooks.completedFetched = false; expect(render()!.props.completedSource?.seed).toBeNull();
  });
  it("gives an existing operation reload priority over the source query and tolerates a damaged extension context for GET recovery", () => {
    setup(); hooks.snapshot = { kind: "record", record: newReservationRecoveryCoordinate(session, id(4), id(80), false) };
    hooks.completedError = new ApiError("503", 503); expect(render()!.props.completedSource?.seed).toBeNull(); expect(query().enabled).toBe(false);
    hooks.params.set("extendFrom", "bad"); expect(render()).toBeDefined(); expect(query().enabled).toBe(false);
    hooks.snapshot = { kind: "none" }; expect(render()).toBeUndefined();
  });
  it("returns Cancel to the exact general preview with only opaque focus intent and removes the seed coordinate after success", async () => {
    const context = setup(), creator = render()!; creator.props.onClose();
    expect(hooks.navigate).toHaveBeenCalledWith(completedReservationReturnHref(context), { replace: true, state: { completedCreateReturn: expect.objectContaining({ propertyId: id(4), reservationId: id(19), href: completedReservationReturnHref(context) }) } });
    expect(JSON.stringify(hooks.navigate.mock.calls[0])).not.toContain("QA completed");
    await creator.props.onCreated({ ...hooks.completed!, reservationId: id(80) }, null, true);
    const params = hooks.setParams.mock.calls.at(-1)![0] as URLSearchParams; expect(params.get("extendFrom")).toBeNull(); expect(params.get("new")).toBeNull(); expect(params.get("reservation")).toBe(id(80)); expect(params.get("opReturnReservation")).toBe(id(19));
  });
});

describe("Reservations first-load retry source continuity", () => {
  it.each(["reservation-operations", "reservations", "affected"])("keeps %s unconfirmed through pending/repeated/offline reads", key => {
    hooks.params = new URLSearchParams({ property: id(4), ...(key === "reservation-operations" ? { status: "attention" } : {}) });
    if (key === "affected") hooks.params.set("affected", id(19));
    const query = { isLoading: true, isFetching: true, isPaused: false, errorUpdatedAt: 0, error: null as unknown };
    if (key === "affected") hooks.affected = [query]; else hooks.queryState[key] = query;
    const source = () => {
      const notices = renderTree().filter(node => node.type === CompositeSourceNotice) as ReactElement<ComponentProps<typeof CompositeSourceNotice>>[];
      expect(notices.every(node => node.props.keepRetryFocusable)).toBe(true);
      return key === "reservation-operations" ? notices[0].props.sources.find(item => item.label === "Property operating date")! : notices[1].props.sources[0];
    };
    expect(source().state).toBe("loading");
    Object.assign(query, { isLoading: false, isFetching: false, errorUpdatedAt: 10, error: new ApiError("Unavailable", 503) });
    expect(source().state).toBe("unavailable");
    Object.assign(query, { isLoading: true, isFetching: true, error: null });
    expect(source()).toMatchObject({ state: "unavailable", isFetching: true });
    expect(compositeSourceCurrent(source())).toBe(false);
    Object.assign(query, { isLoading: false, isFetching: false, isPaused: true });
    expect(source()).toMatchObject({ state: "unavailable", isFetching: true });
    Object.assign(query, { isPaused: false, error: new ApiError("Still unavailable", 503) });
    expect(source().state).toBe("unavailable");
    Object.assign(query, { isLoading: true, isFetching: true, errorUpdatedAt: 0, error: null });
    expect(source().state).toBe("loading");
  });
});

describe("Reservations owned keyboard retry focus (native focus remains an aftergate)", () => {
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
    hooks.params = new URLSearchParams({ property: id(4), status: "attention" });
    hooks.operatingDate = "2026-09-12";
    const directory: ReservationListResponse = { reservations: [{
      reservationId: id(19), propertyId: id(4), primaryGuestName: "Synthetic overdue stay", guestCount: 1,
      arrival: "2026-09-08", departure: "2026-09-09", expectedArrivalTime: null, expectedDepartureTime: null,
      inventoryUnitCount: 1, inventoryUnitIds: [id(7)], sourceKind: "direct", status: "checkedIn", holdsInventory: true,
    }], page: 1, pageSize: 30, hasMore: false };
    hooks.directory = directory;
    const query = { isLoading: false, isFetching: false, isPaused: false, errorUpdatedAt: 10, error: new ApiError("Unavailable", 503) as unknown };
    hooks.queryState.reservations = query;
    let capture: (event: unknown) => void, unmount: () => void;
    let tree: ReactElement<Record<string, unknown>>[];
    const selector = vi.fn(() => tab);
    const renderPage = () => {
      tree = renderTree() as typeof tree;
      const controls = tree.find(node => node.type === "div" && node.props.ref);
      if (controls) (controls.props.ref as { current: unknown }).current = { querySelector: selector };
      capture = tree.filter(node => node.props.onClickCapture).at(-1)?.props.onClickCapture as typeof capture;
      for (const effect of hooks.layouts.slice(0, -1)) effect();
      unmount = hooks.layouts.at(-1)!() as () => void;
    };
    renderPage();
    return { doc, retry, tab, query, selector, render: renderPage,
      activate: (detail = 0) => capture({ target: retry, detail }),
      recover: () => { hooks.directory = directory; Object.assign(query, { error: null, isLoading: false, isFetching: false, isPaused: false }); retry.isConnected = false; doc.activeElement = doc.body; renderPage(); },
      cancel: (type: string, key?: string, target?: unknown) => { const event = new Event(type); if (key) Object.defineProperty(event, "key", { value: key }); if (target) Object.defineProperty(event, "target", { value: target }); doc.dispatchEvent(event); },
      changeControl: (kind: "search" | "page") => {
        const node = tree.find(node => kind === "search" ? node.props["aria-label"] === "Search reservations" : typeof node.props.onPageChange === "function")!;
        if (kind === "search") (node.props.onChange as (event: unknown) => void)({ target: { value: "changed" } });
        else (node.props.onPageChange as (page: number) => void)(2);
      },
      unmount: () => unmount(),
    };
  }
  it.each([false, true])("hands cached=%s keyboard recovery to the selected status once, without scrolling", cached => {
    const s = setup(); if (!cached) hooks.directory = undefined;
    s.render(); s.activate(); Object.assign(s.query, { isFetching: true, isLoading: !cached, error: cached ? s.query.error : null }); s.render();
    expect(s.tab.focus).not.toHaveBeenCalled();
    Object.assign(s.query, { isFetching: false, isLoading: false, error: new ApiError("Repeat failure", 503) }); s.render();
    expect(s.tab.focus).not.toHaveBeenCalled(); s.recover();
    expect(s.selector).toHaveBeenCalledWith('[role="tab"][aria-selected="true"]');
    expect(s.tab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); s.render();
    expect(s.tab.focus).toHaveBeenCalledOnce(); s.unmount();
  });
  it.each(["background", "pointer", "unfocused", "disabled", "aria-disabled"])("does not create a handoff for %s", kind => {
    const s = setup();
    if (kind === "unfocused") s.doc.activeElement = s.doc.body;
    if (kind === "disabled") s.retry.disabled = true;
    if (kind === "aria-disabled") s.retry.getAttribute.mockReturnValue("true");
    if (kind !== "background") s.activate(kind === "pointer" ? 1 : 0);
    s.recover(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it.each(["focusin", "pointerdown", "Tab"])("cancels deliberate %s movement even if focus later falls to BODY", kind => {
    const s = setup(); s.activate(); s.cancel(kind === "Tab" ? "keydown" : kind, kind === "Tab" ? "Tab" : undefined);
    s.recover(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it("retains the same intent for an inactive Retry pointer/keyboard repeat", () => {
    const s = setup(); s.activate(); s.query.isFetching = true; s.retry.getAttribute.mockReturnValue("true"); s.render();
    s.cancel("pointerdown", undefined, s.retry); s.activate(1); s.activate();
    s.recover(); expect(s.tab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); s.unmount();
  });
  it.each(["partial", "paused", "permission refresh", "property refresh"])("waits while %s is not current", kind => {
    const s = setup(); s.activate();
    if (kind === "partial") hooks.queryState["reservation-operations"] = { error: new ApiError("Other source unavailable", 503) };
    if (kind === "paused") hooks.queryState["reservation-operations"] = { isPaused: true };
    if (kind === "permission refresh") hooks.accessFetching = true;
    if (kind === "property refresh") hooks.fetching = true;
    s.recover(); expect(s.tab.focus).not.toHaveBeenCalled();
    hooks.queryState["reservation-operations"] = {}; hooks.accessFetching = false; hooks.fetching = false; s.render();
    expect(s.tab.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); s.unmount();
  });
  it.each(["tenantId", "subjectId", "sessionId", "generation", "property", "route", "filter", "search", "page", "selected", "new", "lease", "denial", "401", "403", "unmount"])("cancels the old intent on %s", kind => {
    const s = setup(); s.activate();
    if (["tenantId", "subjectId", "sessionId", "generation"].includes(kind)) hooks.session[kind] = "changed";
    if (kind === "property") { hooks.propertyId = id(5); hooks.params.set("property", id(5)); }
    if (kind === "route") hooks.params.set("section", "guest");
    if (kind === "filter") hooks.params.set("status", "all");
    if (kind === "search" || kind === "page") s.changeControl(kind);
    if (kind === "selected") hooks.params.set("reservation", id(19));
    if (kind === "new") hooks.params.set("new", "1");
    if (kind === "lease") hooks.leaseKey++;
    if (kind === "denial") hooks.readAllowed = false;
    if (kind === "401" || kind === "403") s.query.error = new ApiError("Denied", Number(kind));
    if (kind === "unmount") s.unmount(); else s.render();
    hooks.readAllowed = true; s.recover(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
  it.each(["connected retry", "disconnected target", "disabled", "hidden", "inert", "visibility", "other focus"])("does not focus an invalid target or override %s", kind => {
    const s = setup(); s.activate(); s.query.error = null; s.retry.isConnected = false; s.doc.activeElement = s.doc.body;
    if (kind === "connected retry") s.retry.isConnected = true;
    if (kind === "disconnected target") s.tab.isConnected = false;
    if (kind === "disabled") s.tab.disabled = true;
    if (kind === "hidden") s.tab.getClientRects.mockReturnValue([]);
    if (kind === "inert") s.tab.closest.mockReturnValue(s.tab);
    if (kind === "visibility") vi.stubGlobal("getComputedStyle", () => ({ visibility: "hidden" }));
    if (kind === "other focus") s.doc.activeElement = {};
    s.render(); expect(s.tab.focus).not.toHaveBeenCalled(); s.unmount();
  });
});

describe("reservation directory presentation through the real page owner", () => {
  it.each([
    ["confirmed", true, "1 unit held", "confirmed"],
    ["checkedIn", true, "1 unit held", "checked in"],
    ["pendingAllocation", false, "Requested · not held", "pending allocation"],
    ["checkedOut", false, "Inventory released", "checked out"],
  ] as const)("retains complete facts and exact navigation for %s in both row presentations", (status, holdsInventory, inventory, label) => {
    hooks.params.delete("new");
    const reservation: ReservationListItem = {
      reservationId: id(19), propertyId: id(4), primaryGuestName: "Maya Alexandra Patel — long complete guest identity",
      guestCount: 2, arrival: "2026-09-08", departure: "2026-09-11", expectedArrivalTime: "14:30:00", expectedDepartureTime: "10:15:00",
      inventoryUnitCount: 1, inventoryUnitIds: [id(7)], sourceKind: "external", status, holdsInventory,
    };
    hooks.directory = { reservations: [reservation], hasMore: false, page: 1, pageSize: 30 };
    const tree = renderTree();
    const rows = tree.filter(node => (node.props as { reservation?: ReservationListItem }).reservation?.reservationId === id(19)) as ReactElement<{ reservation: ReservationListItem; onOpen: () => void }>[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const html = renderToStaticMarkup(row);
      expect(html).toContain(reservation.primaryGuestName);
      expect(html).toContain("2 guests");
      expect(html).toContain("3 nights");
      expect(html).toContain(inventory);
      expect(html).toContain(label);
      expect(html).toContain("external");
      for (const value of ["Sep 8, 2026", "Sep 11, 2026", "2:30 PM", "10:15 AM"]) expect(html).toContain(value);
      expect(html).not.toContain("truncate");
      row.props.onOpen();
      expect((hooks.setParams.mock.lastCall![0] as URLSearchParams).get("reservation")).toBe(id(19));
    }
    const wrappers = tree.filter(node => typeof (node.props as { className?: string }).className === "string");
    expect(wrappers.some(node => (node.props as { className: string }).className === "hidden overflow-x-auto lg:block")).toBe(true);
    expect(wrappers.some(node => (node.props as { className: string }).className === "divide-y divide-base-300 lg:hidden")).toBe(true);
  });
});

describe("selected stay owner admission", () => {
  it("keeps one keyed detail through same-identity permission/property refresh and 503 without claiming current access", () => {
    hooks.params.delete("new"); hooks.params.set("reservation", id(9));
    const initial = detail(); expect(initial.props.reservationId).toBe(id(9));
    hooks.accessFetching = true; hooks.readAllowed = false;
    let pending = detail(); expect(pending.key).toBe(initial.key); expect(pending.props.reservationId).toBe(id(9)); expect(pending.props.permissionSource.isFetching).toBe(true);
    hooks.error = new ApiError("Temporary", 503); hooks.loaded = false; hooks.accessComplete = false;
    pending = detail(); expect(pending.key).toBe(initial.key); expect(pending.props.reservationId).toBe(id(9));
    hooks.loaded = true; hooks.error = null; hooks.accessComplete = true; hooks.accessFetching = false; hooks.readAllowed = true;
    expect(detail().key).toBe(initial.key);
  });
  it.each(["complete denial", "endpoint403", "identity"])("does not retain private detail after %s", boundary => {
    hooks.params.delete("new"); hooks.params.set("reservation", id(9)); const initial = detail();
    if (boundary === "complete denial") hooks.readAllowed = false;
    if (boundary === "endpoint403") hooks.error = new ApiError("Denied", 403);
    if (boundary === "identity") { hooks.session = { ...session, generation: "new-generation" }; hooks.readAllowed = false; }
    expect(detail().props.reservationId).toBeNull(); if (boundary === "identity") expect(detail().key).not.toBe(initial.key);
  });
  it("does not admit an initial fetching or denied editor from cached detail alone", () => {
    hooks.params.delete("new"); hooks.params.set("reservation", id(9)); hooks.accessFetching = true;
    expect(detail().props.reservationId).toBeNull(); hooks.accessFetching = false; hooks.readAllowed = false;
    expect(detail().props.reservationId).toBeNull();
  });
});

describe("reservation page access-reset ownership", () => {
  it("preserves exact Calendar room, bed, dates and Cancel origin while the property cache is absent", () => {
    const context: CalendarBookingContext = { origin: { surface: "calendar", propertyId: id(4), date: "2026-09-07", day: "2026-09-08" },
      target: { roomId: id(6), inventoryUnitId: id(7), bedId: id(8), arrival: "2026-09-08", departure: "2026-09-10" } };
    hooks.params = new URLSearchParams(calendarBookingHref(context).split("?")[1]); render();
    hooks.error = new ApiError("Rejected", 403); render(); hooks.loaded = false; hooks.error = null;
    const reset = render()!; expect(reset.props.requestedTarget).toEqual(context.target);
    expect((reset.props.originLink as ReactElement<{ to: string }>).props.to).toBe(calendarBookingReturnHref(context));
    reset.props.onClose(); expect(hooks.navigate).toHaveBeenCalledWith(calendarBookingReturnHref(context), { replace: true });
  });
  it("latches endpoint403 before property removal and keeps the same reset editor through loading and recovery", async () => {
    const original = render()!; hooks.error = new ApiError("Rejected", 403); const rejected = render()!;
    expect(rejected.key).not.toBe(original.key); expect(rejected.props.accessReset?.canStartFresh).toBe(false);
    hooks.loaded = false; hooks.error = null; const scrubbed = render()!;
    expect(scrubbed.key).toBe(rejected.key); expect(scrubbed.props.propertyId).toBe(id(4)); expect(scrubbed.props.accessReset?.canStartFresh).toBe(false);
    await scrubbed.props.accessReset!.onRetry(); expect(hooks.accessRetry).toHaveBeenCalledTimes(1); expect(hooks.propertyRetry).toHaveBeenCalledTimes(1);
    hooks.loaded = true; hooks.fetching = true; expect(render()!.props.accessReset?.canStartFresh).toBe(false);
    hooks.fetching = false; const recovered = render()!; expect(recovered.key).toBe(rejected.key); expect(recovered.props.accessReset?.canStartFresh).toBe(true);
    recovered.props.accessReset!.onStartFresh(); const fresh = render()!;
    expect(fresh.key).not.toBe(recovered.key); expect(fresh.props.accessReset).toBeUndefined(); expect(fresh.props.freshAfterAccessReset).toBe(true);
    expect(hooks.request).not.toHaveBeenCalled(); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each([new ApiError("Unavailable", 503), new Error("Offline")])("does not reset a mounted editor for %s even when allows is false", (error) => {
    const original = render()!; hooks.error = error; hooks.allowed = false; const delayed = render()!;
    expect(delayed.key).toBe(original.key); expect(delayed.props.accessReset).toBeUndefined(); expect(delayed.props.canCreateReservation).toBe(false);
  });
  it("latches an admitted editor's complete create-only denial before the property scrub, then requires deliberate empty re-entry", async () => {
    const original = render()!;
    hooks.allowed = false; hooks.fetching = true;
    const denied = render()!;
    expect(denied.key).not.toBe(original.key); expect(denied.props.accessReset?.canStartFresh).toBe(false);
    expect(denied.props.canReadInventory).toBe(true);
    hooks.loaded = false; hooks.accessComplete = false;
    const scrubbed = render()!;
    expect(scrubbed.key).toBe(denied.key); expect(scrubbed.props.propertyId).toBe(id(4));
    await scrubbed.props.accessReset!.onRetry(); expect(hooks.accessRetry).toHaveBeenCalledTimes(1); expect(hooks.propertyRetry).toHaveBeenCalledTimes(1);
    hooks.loaded = true; hooks.accessComplete = true; hooks.allowed = true;
    expect(render()!.props.accessReset?.canStartFresh).toBe(false);
    hooks.fetching = false;
    const recovered = render()!;
    expect(recovered.key).toBe(denied.key); expect(recovered.props.accessReset?.canStartFresh).toBe(true);
    recovered.props.accessReset!.onStartFresh();
    const fresh = render()!;
    expect(fresh.key).not.toBe(original.key); expect(fresh.key).not.toBe(denied.key);
    expect(fresh.props.accessReset).toBeUndefined(); expect(fresh.props.freshAfterAccessReset).toBe(true);
    hooks.fetching = true; expect(render()!.props.freshAfterAccessReset).toBe(true);
    hooks.fetching = false; expect(render()!.key).toBe(fresh.key);
    hooks.params.delete("new"); expect(render()).toBeUndefined(); hooks.params.set("new", "1");
    expect(render()!.props.freshAfterAccessReset).toBe(false);
    expect(hooks.request).not.toHaveBeenCalled(); expect(hooks.setParams).not.toHaveBeenCalled();
  });
  it.each(["initial denial", "inventory not admitted", "property not current", "marker owns editor"])("does not invent a cleared draft for %s", (state) => {
    if (state === "initial denial") hooks.allowed = false;
    if (state === "inventory not admitted") hooks.inventoryAllowed = false;
    if (state === "property not current") hooks.fetching = true;
    if (state === "marker owns editor") hooks.snapshot = { kind: "record", record: newReservationRecoveryCoordinate(session, id(4), id(5), false) };
    const original = render()!; hooks.allowed = false;
    const denied = render()!; expect(denied.key).toBe(original.key); expect(denied.props.accessReset).toBeUndefined();
    expect(denied.props.freshAfterAccessReset).toBe(false);
  });
  it.each(["accessLoading", "accessFetching"] as const)("does not classify an %s transition as a denial", (field) => {
    const original = render()!; hooks[field] = true; hooks.allowed = false;
    expect(render()!.key).toBe(original.key); expect(render()!.props.accessReset).toBeUndefined();
    hooks.allowed = true; hooks[field] = false;
    expect(render()!.key).toBe(original.key); expect(render()!.props.freshAfterAccessReset).toBe(false);
  });
  it("requires a new admission after registration loses complete response coverage", () => {
    const original = render()!; hooks.accessComplete = false; hooks.allowed = false;
    expect(render()!.key).toBe(original.key);
    hooks.accessComplete = true; expect(render()!.props.accessReset).toBeUndefined();
    hooks.allowed = true; render(); hooks.allowed = false; expect(render()!.props.accessReset).toBeDefined();
  });
  it.each(["tenantId", "subjectId", "sessionId", "generation", "property", "close"])("does not transfer prior admission into a denied %s identity", (change) => {
    render(); hooks.allowed = false;
    if (change === "property") { hooks.propertyId = id(8); hooks.params.set("property", id(8)); }
    else if (change === "close") { hooks.params.delete("new"); render(); hooks.params.set("new", "1"); }
    else hooks.session[change] = change === "generation" ? "generation-2" : id(8);
    expect(render()!.props.accessReset).toBeUndefined(); expect(render()!.props.freshAfterAccessReset).toBe(false);
  });
  it("does not treat an unbound requested property as denial of the old editor", () => {
    render(); hooks.params.set("property", id(8)); hooks.allowed = false;
    expect(render()).toBeUndefined();
    hooks.propertyId = id(8); expect(render()!.props.accessReset).toBeUndefined();
  });
  it("never freshens while a recovery marker exists, including one written after the last render", () => {
    render(); hooks.error = new ApiError("Rejected", 403); render(); hooks.error = null;
    const recovered = render()!;
    const record = newReservationRecoveryCoordinate(session, id(4), id(5), true);
    hooks.raw = JSON.stringify(record); recovered.props.accessReset!.onStartFresh();
    expect(render()!.props.accessReset).toBeDefined(); expect(hooks.raw).toBe(JSON.stringify(record));
    hooks.snapshot = { kind: "record", record }; expect(render()!.props.accessReset?.canStartFresh).toBe(false);
  });
  it("keeps the original pending request fenced across reset and discards its late completion navigation", async () => {
    const original = render()!; original.props.onSavePendingChange!(true); render();
    hooks.error = new ApiError("Rejected", 403); expect(render()!.props.previousSavePending).toBe(true);
    hooks.error = null; const recovered = render()!; recovered.props.accessReset!.onStartFresh(); expect(render()!.props.accessReset).toBeDefined();
    await original.props.onCreated({ propertyId: id(4), reservationId: id(5), version: 1, detailsRevision: 1, status: "confirmed" }, null);
    expect(hooks.setParams).not.toHaveBeenCalled(); original.props.onSavePendingChange!(false);
    const settled = render()!; expect(settled.props.previousSavePending).toBe(false);
    settled.props.accessReset!.onStartFresh(); expect(render()!.props.freshAfterAccessReset).toBe(true);
  });
  it("preserves a pending operation and a late-written marker across explicit denial without freshening", async () => {
    const original = render()!; original.props.onSavePendingChange!(true); render();
    hooks.allowed = false; expect(render()!.props.previousSavePending).toBe(true);
    hooks.allowed = true; const recovered = render()!;
    recovered.props.accessReset!.onStartFresh(); expect(render()!.props.accessReset).toBeDefined();
    await original.props.onCreated({ propertyId: id(4), reservationId: id(5), version: 1, detailsRevision: 1, status: "confirmed" }, null);
    expect(hooks.setParams).not.toHaveBeenCalled();
    const raw = JSON.stringify(newReservationRecoveryCoordinate(session, id(4), id(5), true)); hooks.raw = raw;
    original.props.onSavePendingChange!(false); const settled = render()!;
    expect(settled.props.previousSavePending).toBe(false); settled.props.accessReset!.onStartFresh();
    expect(render()!.props.accessReset).toBeDefined(); expect(hooks.raw).toBe(raw); expect(hooks.request).not.toHaveBeenCalled();
  });
  it.each(["tenantId", "subjectId", "sessionId", "generation", "property", "close"])("fences reset/fresh callbacks after %s replacement", (change) => {
    render(); hooks.error = new ApiError("Rejected", 403); render(); hooks.error = null; const previous = render()!;
    if (change === "property") { hooks.propertyId = id(8); hooks.params.set("property", id(8)); }
    else if (change === "close") hooks.params.delete("new");
    else hooks.session[change] = change === "generation" ? "generation-2" : id(8);
    const replacement = render(); previous.props.accessReset!.onStartFresh();
    expect(render()?.key).toBe(replacement?.key); expect(render()?.props.freshAfterAccessReset).not.toBe(true);
    if (change === "close") { hooks.params.set("new", "1"); expect(render()!.props.accessReset).toBeUndefined(); }
  });
});
