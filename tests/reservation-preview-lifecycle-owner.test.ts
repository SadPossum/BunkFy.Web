import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reservation, RoomInventoryListResponse } from "../src/api/types";
import { ApiError } from "../src/api/client";
import { OperationalPreviewHost } from "../src/features/operational-preview/OperationalPreviewHost";
import { OperationalPreviewContent } from "../src/features/operational-preview/OperationalPreviewContent";
import { ReservationPreviewLifecycleAction } from "../src/features/operational-preview/ReservationPreviewLifecycleAction";
import type { OperationalPreviewRoute } from "../src/features/operational-preview/operationalPreviewRoute";
import { operationalOriginHref } from "../src/features/operational-preview/operationalPreviewRoute";
import { reservationEditorIdentity } from "../src/features/reservations/reservationsMutationAuthority";

// Actual Host handlers/effects with deterministic React/query/DOM doubles. This
// proves request and owner transitions, not browser rendering or provider timing.
const h = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], dirty: false, pending: [] as (() => void)[], cleanups: new Map<number, () => void>() }));
const env = vi.hoisted(() => ({ route: null as OperationalPreviewRoute | null, record: undefined as Reservation | undefined, queryError: null as unknown, fetching: false, paused: false, dataUpdatedAt: 1,
  inventory: undefined as RoomInventoryListResponse | undefined, inventoryFetching: false, inventoryError: null as unknown, inventoryRead: true,
  permissionError: null as unknown, permissionComplete: true, permissionFetching: false, read: true, create: true, checkIn: true, checkOut: true, propertiesFetching: false, workspacesFetching: false, propertyId: "p", timeZoneId: "Europe/London",
  location: { pathname: "/", search: "", key: "test", state: null as unknown },
  session: { tenantId: "tenant", subjectId: "actor", sessionId: "session", generation: "1" },
  request: vi.fn(), close: vi.fn(), discard: vi.fn(), suppress: vi.fn(), findTrigger: vi.fn(() => null), navigate: vi.fn(), invalidate: vi.fn(async (_filter: { queryKey: unknown[]; exact?: boolean }, _options?: unknown) => undefined), refetch: vi.fn(), queryOptions: [] as Record<string, unknown>[],
}));
function effect(effect: () => void | (() => void), deps?: unknown[]) {
  const i = h.cursor++, previous = h.slots[i] as unknown[] | undefined;
  if (deps && previous && deps.length === previous.length && deps.every((v, j) => Object.is(v, previous[j]))) return;
  h.slots[i] = deps; h.pending.push(() => { h.cleanups.get(i)?.(); h.cleanups.delete(i); const cleanup = effect(); if (cleanup) h.cleanups.set(i, cleanup); });
}
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ?? (h.slots[i] = { current: initial }); },
  useId: () => "preview-test-id",
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
    return [h.slots[i], (value: unknown) => { const next = typeof value === "function" ? value(h.slots[i]) : value; if (!Object.is(next, h.slots[i])) { h.slots[i] = next; h.dirty = true; } }]; },
  useMemo: (factory: () => unknown, deps: unknown[]) => { const i = h.cursor++, previous = h.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (previous && deps.every((v, j) => Object.is(v, previous.deps[j]))) return previous.value;
    const value = factory(); h.slots[i] = { deps, value }; return value; },
  useCallback: (callback: unknown, deps: unknown[]) => { const i = h.cursor++, previous = h.slots[i] as { deps: unknown[]; value: unknown } | undefined;
    if (previous && deps.every((v, j) => Object.is(v, previous.deps[j]))) return previous.value;
    h.slots[i] = { deps, value: callback }; return callback; },
  useEffect: (callback: () => void | (() => void), deps?: unknown[]) => effect(callback, deps),
  useLayoutEffect: (callback: () => void | (() => void), deps?: unknown[]) => effect(callback, deps),
}));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("react-router", async original => ({ ...await original<typeof import("react-router")>(), useNavigate: () => env.navigate, useLocation: () => env.location }));
vi.mock("../src/app/session", () => ({ useSession: () => ({ session: env.session, request: env.request }) }));
vi.mock("../src/app/workspace", () => ({ useWorkspace: () => ({ selectedPropertyId: env.propertyId, selectedWorkspaceId: "tenant", selectedProperty: { propertyId: env.propertyId, timeZoneId: env.timeZoneId }, properties: [{ propertyId: env.propertyId }], propertiesLoaded: true, propertiesFetching: env.propertiesFetching, propertiesError: null, workspacesLoaded: true, workspacesFetching: env.workspacesFetching, workspacesError: null, setSelectedPropertyId: vi.fn() }) }));
vi.mock("../src/app/permissions", async original => ({ ...await original<typeof import("../src/app/permissions")>(), usePermissions: () => ({ hasData: env.permissionComplete, isFetching: env.permissionFetching, error: env.permissionError, refetch: vi.fn(), allows: (permission: string) => permission === "inventory.read" ? env.inventoryRead : permission === "reservations.read" ? env.read : permission === "reservations.create" ? env.create : permission === "reservations.check-in" ? env.checkIn : permission === "reservations.check-out" ? env.checkOut : true }) }));
vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({ useOperationalPreview: () => ({ activeRoute: env.route, activeSeed: null, closePreview: env.close, discardPreview: env.discard, findActiveTrigger: env.findTrigger, suppressNextFocusRestore: env.suppress }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: env.invalidate }), useQuery: (options: { queryKey: string[] }) => {
  env.queryOptions.push(options);
  return options.queryKey[3] === "reservation" ? { data: env.record, dataUpdatedAt: env.dataUpdatedAt, error: env.queryError, isFetching: env.fetching, isPaused: env.paused, isLoading: !env.record, refetch: env.refetch }
    : options.queryKey[3] === "inventory" ? { data: env.inventory, error: env.inventoryError, isFetching: env.inventoryFetching, isPaused: false, isLoading: false, refetch: vi.fn() }
    : { data: undefined, error: null, isFetching: false, isPaused: false, isLoading: false, refetch: vi.fn() };
} }));
type Tree = ReactElement<{ children?: unknown; ref?: { current: unknown } }>;
const listeners = new Map<string, Set<(event: unknown) => void>>();
class NodeDouble { contains(node: unknown) { return node === this; } focus = vi.fn(); querySelector: (selector?: string) => NodeDouble | null = () => null; getBoundingClientRect = () => ({ x: 16, y: 80, left: 16, right: 368, top: 80, bottom: 600, width: 352, height: 520 }); }
const panel = new NodeDouble();
function elements(value: unknown): Tree[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Tree; return [node, ...elements(node.props.children)];
}
let content: ComponentProps<typeof OperationalPreviewContent> | null;
function render() {
  for (let pass = 0; pass < 10; pass++) {
    h.cursor = 0; h.pending = []; h.dirty = false; env.queryOptions = [];
    const tree = OperationalPreviewHost();
    const nodes = elements(tree); for (const node of nodes) if (node.props.ref) node.props.ref.current = panel;
    content = (nodes.find(node => node.type === OperationalPreviewContent)?.props as ComponentProps<typeof OperationalPreviewContent> | undefined) ?? null;
    h.pending.forEach(run => run()); if (!h.dirty) return content;
  }
  throw new Error("Host did not settle in ten deterministic renders");
}
function command() {
  const node = render()?.reservationCommand as ReactElement<ComponentProps<typeof ReservationPreviewLifecycleAction>> | undefined;
  return node?.type === ReservationPreviewLifecycleAction ? node.props : undefined;
}
async function flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const initial = () => ({ propertyId: "p", reservationId: "r", arrival: "2026-09-07", departure: "2026-09-09", inventoryUnitIds: ["unit"], primaryGuestName: "QA guest", guestCount: 1, guests: [], sourceKind: "direct", status: "confirmed", holdsInventory: true, allocationId: "allocation", allocationVersion: 1, allocationRequestId: "allocation-request", version: 3, detailsRevision: 1, checkedInBusinessDate: null } as unknown as Reservation);
const route = (): OperationalPreviewRoute => ({ selection: { kind: "reservation", propertyId: "p", reservationId: "r", date: "2026-09-07" }, origin: { surface: "today", propertyId: "p", view: "visual" } });
beforeEach(() => {
  h.slots = []; h.cleanups.clear(); listeners.clear(); vi.clearAllMocks();
  panel.querySelector = () => null;
  Object.assign(env, { route: route(), record: initial(), queryError: null, fetching: false, paused: false, dataUpdatedAt: 1, permissionError: null, permissionComplete: true, read: true, checkIn: true, checkOut: true, propertiesFetching: false, workspacesFetching: false, propertyId: "p", timeZoneId: "Europe/London", session: { tenantId: "tenant", subjectId: "actor", sessionId: "session", generation: "1" } });
  Object.assign(env, { inventory: undefined, inventoryFetching: false, inventoryError: null, inventoryRead: true });
  Object.assign(env, { create: true, permissionFetching: false, location: { pathname: "/", search: "", key: "test", state: null } });
  env.request.mockReset(); env.refetch.mockReset(); env.refetch.mockImplementation(async () => ({ data: env.record, dataUpdatedAt: ++env.dataUpdatedAt, error: env.queryError, isPaused: env.paused }));
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  vi.stubGlobal("Node", NodeDouble); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("window", { innerWidth: 1440, innerHeight: 1000, requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), setInterval: () => 1, clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.stubGlobal("document", { body: { style: { overflow: "" } }, querySelector: () => null, addEventListener: (name: string, callback: (event: unknown) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); }, removeEventListener: (name: string, callback: (event: unknown) => void) => listeners.get(name)?.delete(callback) });
});
afterEach(() => { h.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("completed preview Extend CTA and exact return focus", () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  function setup(returning = false) {
    env.propertyId = uuid(4); env.route = { selection: { kind: "reservation", propertyId: uuid(4), reservationId: uuid(19), date: "2026-09-09" }, origin: { surface: "calendar", propertyId: uuid(4), date: "2026-09-27", day: "2026-09-12", viewport: { date: "2026-09-09", offset: 18 } } };
    env.record = { ...initial(), propertyId: uuid(4), reservationId: uuid(19), status: 10, holdsInventory: false };
    const href = operationalOriginHref(env.route), [pathname, search] = href.split("?");
    env.location = { pathname, search: "?" + search, key: "return-1", state: returning ? { completedCreateReturn: { identity: reservationEditorIdentity({ ...env.session, generation: String(env.session.generation), username: "synthetic", accessToken: "synthetic" }, uuid(4)), propertyId: uuid(4), reservationId: uuid(19), href } } : null };
    const target = Object.assign(new NodeDouble(), { isConnected: true, getClientRects: () => [{}], closest: (): NodeDouble | null => null });
    panel.querySelector = selector => selector === "[data-completed-create-action]" ? target : null;
    vi.stubGlobal("document", { ...document, activeElement: document.body }); vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
    target.focus.mockImplementation(() => { Object.defineProperty(document, "activeElement", { value: target, configurable: true }); });
    return target;
  }
  const cta = () => elements(render()?.reservationCommand).find(n => "data-completed-create-action" in n.props) as ReactElement<{ to: string; onClick: (e: { preventDefault: () => void }) => void }> | undefined;
  it("offers only the current completed record and serializes no guest values or Calendar booking target", () => { const target = setup(); expect(cta()?.props.to).toContain("extendFrom=" + uuid(19)); expect(cta()?.props.to).toContain("opReturnFromViewportDate=2026-09-09"); expect(cta()?.props.to).not.toMatch(/QA|bookingEntry|guest|email/); cta()!.props.onClick({ preventDefault: vi.fn() }); expect(env.suppress).toHaveBeenCalled(); expect(target.focus).not.toHaveBeenCalled(); expect(env.request).not.toHaveBeenCalled(); });
  it.each(["read", "create", "permissionFetching", "fetching", "paused", "503", "property", "status", "anonymised", "blank"])("does not expose a CTA for %s", kind => { setup(); if (kind === "read" || kind === "create") env[kind] = false; if (kind === "permissionFetching" || kind === "fetching" || kind === "paused") env[kind] = true; if (kind === "503") env.queryError = new ApiError("503", 503); if (kind === "property") env.record = { ...env.record!, propertyId: uuid(5) }; if (kind === "status") env.record = { ...env.record!, status: 6 }; if (kind === "anonymised" || kind === "blank") env.record = { ...env.record!, primaryGuestName: kind === "blank" ? "" : "Anonymised guest" }; expect(cta()).toBeUndefined(); });
  it("returns only owned current Cancel intent to the exact CTA once without scrolling", () => { const target = setup(true); cta(); expect(target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); render(); expect(target.focus).toHaveBeenCalledOnce(); });
  it.each(["Tab", "pointerdown", "focusin", "identity", "route", "denial", "inert", "hidden"])("does not steal focus after %s", kind => { const target = setup(true); env.fetching = true; render(); if (["Tab", "pointerdown", "focusin"].includes(kind)) for (const listener of listeners.get(kind === "Tab" ? "keydown" : kind) ?? []) listener({ key: kind, target: new NodeDouble(), preventDefault: vi.fn(), stopPropagation: vi.fn() }); if (kind === "identity") env.session = { ...env.session, generation: "2" }; if (kind === "route") env.location.search += "&date=other"; if (kind === "denial") env.create = false; if (kind === "inert") target.closest = () => target; if (kind === "hidden") target.getClientRects = () => []; env.fetching = false; render(); expect(target.focus).not.toHaveBeenCalled(); });
});

describe("actual shared-preview lifecycle owner", () => {
  it("resolves exact former whole/retired labels from current authorized inventory without inventing selection or stale labels", () => {
    env.record = { ...initial(), status: 10, holdsInventory: false, inventoryUnitIds: ['whole', 'retired', 'missing'] };
    env.inventory = { rooms: [{ propertyId: 'p', roomId: 'room', roomName: 'Former room', units: [
      { propertyId: 'p', roomId: 'room', inventoryUnitId: 'whole', kind: 'room', label: 'Former room', isSellable: false, isTopologyActive: true },
      { propertyId: 'p', roomId: 'room', inventoryUnitId: 'retired', kind: 'bed', bedId: 'retired', label: 'H-3', isSellable: false, isTopologyActive: false },
    ] }] } as RoomInventoryListResponse;
    const recorded = () => render()!.model.details.find(detail => detail.label === 'Recorded room or bed')!.value;
    expect(recorded()).toBe('Former room · Whole room; Former room · H-3; Recorded space label unavailable');
    expect(env.route!.selection.inventoryUnitId).toBeUndefined(); expect(command()).toBeUndefined();
    env.inventoryFetching = true; expect(recorded()).toBe('Recorded space labels unconfirmed');
    env.inventoryFetching = false; env.inventoryError = new ApiError('503', 503); expect(recorded()).toBe('Recorded space labels unconfirmed');
    env.inventoryError = null; env.inventoryRead = false; expect(recorded()).toBe('Recorded space labels unconfirmed');
    env.inventoryRead = true; expect(recorded()).toContain('Former room · Whole room');
    env.inventory = { rooms: [], page: 1, pageSize: 100, hasMore: false }; expect(recorded()).toBe('Recorded space label unavailable; Recorded space label unavailable; Recorded space label unavailable');
    expect(env.request).not.toHaveBeenCalled();
  });
  it("opens completed history with authoritative actual checkout and no terminal lifecycle command", () => {
    env.record = { ...initial(), status: 10, holdsInventory: false, checkedOutBusinessDate: "2026-09-06" };
    const page = render()!;
    expect(page.model.kindLabel).toBe("Completed booking");
    expect(page.model.details[0].label).toBe("Scheduled dates");
    expect(page.model.details.find(detail => detail.label === "Actual checkout")?.value).toContain("6");
    expect(command()).toBeUndefined();
    expect(env.request).not.toHaveBeenCalled();
  });
  it("opens and cancels confirmation with zero POSTs", () => {
    command()!.onBegin(); expect(command()!.owner?.phase).toBe("confirm"); expect(env.request).not.toHaveBeenCalled();
    command()!.onCancel(); expect(command()!.owner).toBeNull(); expect(env.request).not.toHaveBeenCalled();
  });
  it("dispatches once, guards Close/Escape/outside/links, and offers deferred navigation without executing it", async () => {
    const sent = deferred<unknown>(); env.request.mockReturnValue(sent.promise);
    command()!.onBegin(); command()!.onConfirm(); command()!.onConfirm(); await flush();
    expect(env.request).toHaveBeenCalledTimes(1); expect(command()!.owner?.phase).toBe("sending");
    const page = render()!; page.onClose(); expect(env.close).not.toHaveBeenCalled();
    for (const callback of listeners.get("keydown") ?? []) callback({ key: "Escape", preventDefault: vi.fn() });
    for (const callback of listeners.get("pointerdown") ?? []) callback({ target: new NodeDouble(), preventDefault: vi.fn(), stopPropagation: vi.fn() });
    const href = page.model.actions[0].href; expect(page.onNavigate(href)).toBe(false); expect(env.navigate).not.toHaveBeenCalled();
    env.record = { ...env.record!, status: "checkedIn", checkedInBusinessDate: "2026-09-07", version: 4 };
    sent.resolve({ propertyId: "p", reservationId: "r", status: "checkedIn", version: 4, detailsRevision: 1 }); await flush();
    expect(command()!.owner?.phase).toBe("success"); expect(command()!.owner?.deferred).toBe(href);
    expect(env.navigate).not.toHaveBeenCalled(); command()!.onContinue(); expect(env.navigate).toHaveBeenCalledWith(href);
    expect(env.invalidate).toHaveBeenCalledWith({ queryKey: ["reservation-calendar", "p"] }, { cancelRefetch: false });
  });
  it.each([new ApiError("503", 503), new ApiError("403", 403), new Error("offline")])("retains exact operation after %s and version drift", async error => {
    env.request.mockRejectedValue(error); command()!.onBegin(); command()!.onConfirm(); await flush();
    const original = command()!.owner!.attempt; expect(command()!.owner?.phase).toBe("unknown");
    env.record = { ...env.record!, version: 9 }; command()!.onRetry(); await flush();
    expect(env.request).toHaveBeenCalledTimes(2); expect(command()!.owner!.attempt).toBe(original);
    expect(JSON.parse(env.request.mock.calls[1][1].body)).toEqual(JSON.parse(env.request.mock.calls[0][1].body));
    expect(JSON.parse(env.request.mock.calls[1][1].body).expectedVersion).toBe(3);
  });
  it("keeps native Back late success off the new route and recovers on exact reopen", async () => {
    const sent = deferred<unknown>(); env.request.mockReturnValue(sent.promise); command()!.onBegin(); command()!.onConfirm(); await flush();
    const original = command()!.owner!.attempt; env.route = null; expect(render()).toBeNull();
    sent.resolve({ propertyId: "p", reservationId: "r", status: "checkedIn", version: 4, detailsRevision: 1 }); await flush();
    expect(env.invalidate).not.toHaveBeenCalled(); expect(env.navigate).not.toHaveBeenCalled();
    env.route = route(); env.record = { ...env.record!, status: "checkedIn", checkedInBusinessDate: "2026-09-07", version: 4 };
    expect(command()!.owner!.attempt).toBe(original); expect(command()!.owner?.phase).toBe("unknown");
    command()!.onCheck(); await flush(); expect(command()!.owner?.phase).toBe("success"); expect(env.request).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite the unresolved coordinate for another reservation", async () => {
    env.request.mockRejectedValue(new Error("lost")); command()!.onBegin(); command()!.onConfirm(); await flush();
    const original = command()!.owner!.attempt; env.route = { ...route(), selection: { ...route().selection, kind: "reservation", reservationId: "other" } }; env.record = { ...initial(), reservationId: "other" };
    expect(command()).toBeUndefined();
    const recovery = elements(render()!.reservationCommand).find(node => node.type === "button") as ReactElement<{ onClick: () => void }>;
    expect(recovery).toBeDefined(); recovery.props.onClick(); expect(env.navigate).toHaveBeenCalledWith(expect.stringContaining("opReservation=r"));
    env.read = false; render(); env.navigate.mockClear(); recovery.props.onClick(); expect(env.navigate).not.toHaveBeenCalled();
    env.read = true; env.route = route(); env.record = initial(); expect(command()!.owner!.attempt).toBe(original);
  });
  it("drops never-sent confirmation on selection exit and fences its stale callbacks", () => {
    command()!.onBegin(); const old = command()!; env.route = null; render();
    env.route = { ...route(), selection: { ...route().selection, kind: "reservation", reservationId: "other" } }; env.record = { ...initial(), reservationId: "other" };
    expect(command()!.owner).toBeNull(); command()!.onBegin(); old.onConfirm(); old.onCancel();
    expect(command()!.owner?.intent.reservationId).toBe("other"); expect(env.request).not.toHaveBeenCalled();
  });
  it("releases a resolved result on selection exit without blocking the next stay", async () => {
    env.request.mockImplementation(async () => { env.record = { ...initial(), status: "checkedIn", checkedInBusinessDate: "2026-09-07", version: 4 }; return { propertyId: "p", reservationId: "r", version: 4, detailsRevision: 1, status: "checkedIn" }; });
    command()!.onBegin(); command()!.onConfirm(); await flush(); expect(command()!.owner?.phase).toBe("success");
    env.route = { ...route(), selection: { ...route().selection, kind: "reservation", reservationId: "other" } }; env.record = { ...initial(), reservationId: "other" };
    expect(command()!.owner).toBeNull(); expect(command()!.action).toBe("check-in");
  });
  it("keys only the Action focus lifetime by current authority and reservation", () => {
    const key = () => (render()!.reservationCommand as ReactElement).key;
    const first = key(); command()!.onBegin(); expect(key()).toBe(first); command()!.onCancel(); expect(key()).toBe(first);
    env.route = { ...route(), selection: { ...route().selection, kind: "reservation", reservationId: "other" } }; env.record = { ...initial(), reservationId: "other" };
    const other = key(); expect(other).not.toBe(first); env.session = { ...env.session, subjectId: "other-actor" }; expect(key()).not.toBe(other);
  });
  it.each(["action-denied", "currentness"])("confirmation Cancel falls back to Close after %s removes eligibility", boundary => {
    command()!.onBegin();
    if (boundary === "action-denied") env.checkIn = false; else env.fetching = true;
    expect(command()!.action).toBeNull(); expect(command()!.owner?.phase).toBe("confirm");
    const keep = new NodeDouble(), close = new NodeDouble(), frames: FrameRequestCallback[] = [];
    panel.querySelector = selector => selector === "[data-reservation-preview-lifecycle]" ? keep : selector?.includes("Close operational preview") ? close : null;
    vi.stubGlobal("document", { ...document, activeElement: keep });
    vi.stubGlobal("window", { ...window, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } });
    command()!.onCancel(); expect(command()).toBeUndefined(); expect(frames).toHaveLength(1);
    vi.stubGlobal("document", { ...document, activeElement: document.body }); frames[0](0);
    expect(close.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true }); expect(env.request).not.toHaveBeenCalled();
  });
  it.each(["same-context", "external-focus", "selection", "actor", "read-denied"])("terminal Done fallback respects %s before focusing existing Close", async boundary => {
    env.request.mockImplementation(async () => { env.record = { ...initial(), status: "checkedIn", checkedInBusinessDate: "2026-09-07", version: 4 }; return { propertyId: "p", reservationId: "r", version: 4, detailsRevision: 1, status: "checkedIn" }; });
    command()!.onBegin(); command()!.onConfirm(); await flush(); expect(command()!.owner?.phase).toBe("success");
    const done = new NodeDouble(), close = new NodeDouble(), frames: FrameRequestCallback[] = [];
    panel.querySelector = selector => selector === "[data-reservation-preview-lifecycle]" ? done : selector?.includes("Close operational preview") ? close : null;
    vi.stubGlobal("document", { ...document, activeElement: done });
    vi.stubGlobal("window", { ...window, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } });
    command()!.onCancel(); render(); expect(frames).toHaveLength(1);
    vi.stubGlobal("document", { ...document, activeElement: boundary === "external-focus" ? new NodeDouble() : document.body });
    if (boundary === "selection") { env.route = { ...route(), selection: { ...route().selection, kind: "reservation", reservationId: "other" } }; env.record = { ...initial(), reservationId: "other" }; }
    if (boundary === "actor") env.session = { ...env.session, subjectId: "other-actor" };
    if (boundary === "read-denied") env.read = false;
    render(); frames[0](0);
    if (boundary === "same-context") expect(close.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    else expect(close.focus).not.toHaveBeenCalled();
    expect(env.request).toHaveBeenCalledTimes(1);
  });
  it("rechecks authority at the queued request boundary before forwarding POST", async () => {
    command()!.onBegin(); command()!.onConfirm(); env.checkIn = false; render(); await flush();
    expect(env.request).not.toHaveBeenCalled(); expect(command()!.owner?.attempt).toBeNull();
  });
  it.each(["propertiesFetching", "workspacesFetching"] as const)("keeps nonprivate pending truth and guarded controls during %s", async source => {
    const sent = deferred<unknown>(); env.request.mockReturnValue(sent.promise); command()!.onBegin(); command()!.onConfirm(); await flush();
    const original = command()!.owner!.attempt; env[source] = true;
    const page = render()!, notice = page.reservationCommand as ReactElement<{ children: string; "data-reservation-request-pending": string }>;
    expect(notice.props["data-reservation-request-pending"]).toBe("true"); expect(notice.props.children).toContain("request is still pending");
    expect(notice.props.children).not.toContain("QA guest"); expect(page.navigationPending).toBe(true); page.onClose(); expect(env.close).not.toHaveBeenCalled();
    env.read = false; expect(render()!.reservationCommand).toBeUndefined(); env.read = true; env[source] = false;
    expect(command()!.owner!.attempt).toBe(original); sent.reject(new Error("lost")); await flush(); expect(command()!.owner?.phase).toBe("unknown");
  });
  it.each(["denied", "error", "incomplete"])("allows hidden pending navigation during read %s and retains exact-operation recovery", async boundary => {
    const sent = deferred<unknown>(); env.request.mockReturnValue(sent.promise);
    command()!.onBegin(); command()!.onConfirm(); await flush();
    const original = command()!.owner!.attempt, previousPage = render()!;
    if (boundary === "denied") env.read = false;
    if (boundary === "error") env.permissionError = new Error("503");
    if (boundary === "incomplete") env.permissionComplete = false;
    const hiddenPage = render()!;
    expect(hiddenPage.reservationCommand).toBeUndefined(); expect(hiddenPage.navigationPending).toBe(false);
    previousPage.onClose(); expect(env.close).toHaveBeenCalledTimes(1);
    for (const callback of listeners.get("keydown") ?? []) callback({ key: "Escape", preventDefault: vi.fn() });
    expect(env.close).toHaveBeenCalledTimes(2);
    const destination = previousPage.model.actions[0].href;
    expect(hiddenPage.onNavigate(destination)).toBe(true); expect(env.suppress).toHaveBeenCalledTimes(1);
    env.route = null; expect(render()).toBeNull();
    sent.resolve({ propertyId: "p", reservationId: "r", status: "checkedIn", version: 4, detailsRevision: 1 }); await flush();
    expect(env.invalidate).not.toHaveBeenCalled(); expect(env.navigate).not.toHaveBeenCalled();
    env.read = true; env.permissionError = null; env.permissionComplete = true;
    env.route = route(); env.record = { ...initial(), status: "checkedIn", checkedInBusinessDate: "2026-09-07", version: 4 };
    expect(command()!.owner!.attempt).toBe(original); expect(command()!.owner?.phase).toBe("unknown");
    command()!.onCheck(); await flush(); expect(command()!.owner?.phase).toBe("success");
    expect(env.request).toHaveBeenCalledTimes(1);
  });
  it.each(["actor", "generation", "property"])("scrubs private owner and ignores late completion on %s change", async boundary => {
    const sent = deferred<unknown>(); env.request.mockReturnValue(sent.promise); command()!.onBegin(); command()!.onConfirm(); await flush();
    if (boundary === "actor") env.session = { ...env.session, subjectId: "different" };
    if (boundary === "generation") env.session = { ...env.session, generation: "2" };
    if (boundary === "property") env.propertyId = "other-property";
    render(); sent.resolve({ propertyId: "p", reservationId: "r", status: "checkedIn", version: 4, detailsRevision: 1 }); await flush();
    expect(command()?.owner ?? null).toBeNull(); expect(env.invalidate).not.toHaveBeenCalled();
  });
  it("fails closed for refreshing/paused/error/mismatched full data and incomplete permission", () => {
    env.fetching = true; expect(command()).toBeUndefined(); env.fetching = false;
    env.paused = true; expect(command()).toBeUndefined(); env.paused = false;
    env.queryError = new Error("503"); expect(command()).toBeUndefined(); env.queryError = null;
    env.record = { ...initial(), reservationId: "other" }; expect(command()).toBeUndefined(); env.record = initial();
    env.permissionComplete = false; expect(command()).toBeUndefined(); env.permissionComplete = true;
    env.propertiesFetching = true; expect(command()).toBeUndefined(); env.propertiesFetching = false;
    env.timeZoneId = "invalid/timezone"; expect(command()).toBeUndefined(); expect(env.request).not.toHaveBeenCalled();
  });
  it("disables action-only 200-false without erasing an uncertain operation; read recovery remains", async () => {
    env.request.mockRejectedValue(new Error("lost")); command()!.onBegin(); command()!.onConfirm(); await flush();
    const original = command()!.owner!.attempt; env.checkIn = false; expect(command()!.recoveryAllowed).toBe(false);
    command()!.onRetry(); await flush(); expect(env.request).toHaveBeenCalledTimes(1); expect(command()!.owner!.attempt).toBe(original);
    env.read = false; expect(command()).toBeUndefined(); env.read = true; env.permissionError = new Error("503"); expect(command()).toBeUndefined();
    env.permissionError = null; env.checkIn = true; expect(command()!.owner!.attempt).toBe(original);
  });
  it("rechecks real date and version at confirmation without minting a request", async () => {
    command()!.onBegin(); const staleConfirm = command()!.onConfirm; env.record = { ...initial(), version: 4 }; render(); staleConfirm(); await flush();
    expect(env.request).not.toHaveBeenCalled(); expect(command()!.owner?.phase).toBe("changed");
    command()!.onCancel(); command()!.onBegin(); const confirm = command()!.onConfirm; vi.setSystemTime(new Date("2026-09-09T12:00:00Z")); confirm(); await flush(); expect(env.request).not.toHaveBeenCalled();
  });
  it("keeps checkout pending through worker completion and invalidates the actual prefixes again", async () => {
    env.record = { ...initial(), arrival: "2026-09-06", departure: "2026-09-07", status: "checkedIn", checkedInBusinessDate: "2026-09-06" };
    env.request.mockImplementation(async () => { env.record = { ...env.record!, version: 4, status: "checkoutPending", pendingStayBusinessDate: "2026-09-07" }; return { propertyId: "p", reservationId: "r", version: 4, detailsRevision: 1, status: "checkoutPending" }; });
    command()!.onBegin(); command()!.onConfirm(); await flush(); expect(command()!.owner?.phase).toBe("pending"); expect(render()!.navigationPending).toBe(true);
    const options = env.queryOptions.find(option => (option.queryKey as string[])[3] === "reservation")!;
    expect((options.refetchInterval as (query: unknown) => unknown)({ state: { data: env.record } })).toBe(2000);
    env.record = { ...env.record!, status: "checkedOut", checkedOutBusinessDate: "2026-09-07", version: 5, holdsInventory: false }; env.dataUpdatedAt++;
    expect(command()!.owner?.phase).toBe("success"); expect(render()!.navigationPending).toBe(false);
    expect(env.invalidate.mock.calls.filter(([filter]) => filter.queryKey[0] === "reservation-calendar")).toHaveLength(2);
  });
  it("does not accept a foreign or malformed success receipt", async () => {
    env.request.mockResolvedValue({ propertyId: "other", reservationId: "r", version: 4, detailsRevision: 1, status: "checkedIn" }); command()!.onBegin(); command()!.onConfirm(); await flush();
    expect(command()!.owner?.phase).toBe("unknown"); expect(env.invalidate).not.toHaveBeenCalled(); expect(env.refetch).not.toHaveBeenCalled();
  });
});
