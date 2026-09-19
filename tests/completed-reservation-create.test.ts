import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { InventoryAvailabilityResponse, Reservation, RoomInventory } from "../src/api/types";
import { CreateReservationModal } from "../src/features/reservations/CreateReservationModal";
import { ReservationCreationRecovery } from "../src/features/reservations/ReservationCreationRecovery";
import { ReservationInventoryPicker } from "../src/features/reservations/ReservationInventoryPicker";
import { completedReservationCreateHref, completedReservationPreselection, completedReservationReturnHref, completedReservationSeed, completedReservationStayRange, parseCompletedReservationCreateContext } from "../src/features/reservations/completedReservationCreate";
import { newReservationRecoveryCoordinate, readReservationRecovery, storeReservationRecovery } from "../src/features/reservations/reservationCreationRecovery";
import type { OperationalPreviewRoute } from "../src/features/operational-preview/operationalPreviewRoute";

// Actual creator/submit/effects with deterministic React/query doubles. Native focus/layout are separate gates.
const h = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], effects: [] as (() => void)[], cleanups: new Map<number, () => void>(), dirty: false,
  request: vi.fn(), invalidate: vi.fn(async (_options: { queryKey: unknown[] }) => undefined), mutate: vi.fn(), options: {} as Record<string, (...args: unknown[]) => unknown>,
  raw: null as string | null, unavailable: false, fetching: false, session: {} as Record<string, string> }));
function effect(fn: () => void | (() => void), deps?: unknown[]) { const i = h.cursor++, old = h.slots[i] as unknown[] | undefined;
  if (deps && old && deps.length === old.length && deps.every((v, j) => Object.is(v, old[j]))) return;
  h.slots[i] = deps; h.effects.push(() => { h.cleanups.get(i)?.(); const cleanup = fn(); if (cleanup) h.cleanups.set(i, cleanup); }); }
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === "function" ? initial() : initial;
    return [h.slots[i], (value: unknown) => { const next = typeof value === "function" ? value(h.slots[i]) : value; if (!Object.is(next, h.slots[i])) { h.slots[i] = next; h.dirty = true; } }]; },
  useRef: (initial: unknown) => { const i = h.cursor++; return h.slots[i] ?? (h.slots[i] = { current: initial }); },
  useMemo: (fn: () => unknown) => fn(), useEffect: effect, useLayoutEffect: effect,
}));
vi.mock("../src/app/session", () => ({ useSession: () => ({ session: h.session, request: h.request }) }));
vi.mock("../src/features/reservations/useReservationCreationRecovery", () => ({ useReservationCreationRecovery: () => ({ snapshot: readReservationRecovery(), refresh: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate, cancelQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "availability" ? availability(queryKey[2], queryKey[3]) : { rooms },
    error: null, isLoading: false, isFetching: h.fetching, isPaused: false, refetch: vi.fn() }),
  useMutation: (options: typeof h.options) => { h.options = options; return { isPending: false, error: null, mutate: h.mutate }; },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const property = id(4), oldId = id(5), unitId = id(6), second = id(7);
const session = { tenantId: id(1), subjectId: id(2), sessionId: id(3), generation: "one", accessToken: "synthetic", username: "synthetic" };
const route: OperationalPreviewRoute = { selection: { kind: "reservation", propertyId: property, reservationId: oldId, date: "2026-09-09" },
  origin: { surface: "calendar", propertyId: property, date: "2026-09-27", day: "2026-09-12", viewport: { date: "2026-09-09", offset: 18 } } };
const context = () => parseCompletedReservationCreateContext(new URLSearchParams(completedReservationCreateHref(route)!.split("?")[1]))!;
const record = () => ({ propertyId: property, reservationId: oldId, status: 10, holdsInventory: false, primaryGuestName: "QA returning guest", email: "qa@example.invalid", phone: "+44000", guestCount: 2,
  inventoryUnitIds: [unitId, second], sourceKind: "external", sourceSystem: "Old OTA", sourceReference: "DO NOT COPY", notes: "Do not copy", arrival: "2026-09-09", departure: "2026-09-16", guests: [{ guestId: id(99), role: "primary" }], version: 3, detailsRevision: 2 } as Reservation);
const rooms = [{ propertyId: property, roomId: id(8), roomName: "QA", units: [unitId, second].map(inventoryUnitId => ({ propertyId: property, roomId: id(8), inventoryUnitId, bedId: inventoryUnitId, label: inventoryUnitId === unitId ? "H1" : "H2", kind: "bed", isSellable: true, isTopologyActive: true })) }] as RoomInventory[];
function availability(arrival = "2026-09-12", departure = "2026-09-13") { return { propertyId: property, arrival, departure, units: rooms[0].units.map(unit => ({ unit, isAvailable: !h.unavailable || unit.inventoryUnitId === second, activeBlockIds: [], activeAllocationIds: [] })) } as InventoryAvailabilityResponse; }
type Props = ComponentProps<typeof CreateReservationModal>;
type Node = ReactElement<{ children?: unknown; label?: string; value?: string; onChange?: (value: string) => void; onSubmit?: (event: { preventDefault: () => void }) => void; disabled?: boolean }>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const n = value as Node; return [n, ...nodes(n.props.children)]; }
function props(): Props { return { propertyId: property, propertyTimeZoneId: "Europe/London", permissionSource: { label: "Permissions", state: "ready", isFetching: false, refetch: vi.fn() },
  canCreateReservation: true, canReadInventory: true, canReadReservations: true, canReadGuests: false, canCreateGuests: false, canManageGuests: false,
  completedSource: { context: context(), seed: completedReservationSeed(record(), property, oldId), source: { label: "Completed reservation", state: "ready", isFetching: false, refetch: vi.fn() } }, onClose: vi.fn(), onCreated: vi.fn() }; }
function render(p: Props) { for (let i = 0; i < 12; i++) { h.cursor = 0; h.effects = []; h.dirty = false; const tree = CreateReservationModal(p); h.effects.forEach(fn => fn()); if (!h.dirty) return nodes(tree); } throw new Error("Creator did not settle"); }
const field = (p: Props, label: string) => render(p).find(n => n.props.label === label)!;
const submit = (p: Props) => render(p).find(n => n.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() });
beforeEach(() => { h.cursor = 0; h.slots = []; h.cleanups.clear(); h.raw = null; h.unavailable = false; h.fetching = false; h.session = { ...session }; vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  vi.stubGlobal("window", { sessionStorage: { getItem: () => h.raw, setItem: (_key: string, value: string) => { h.raw = value; }, removeItem: () => { h.raw = null; } }, dispatchEvent: vi.fn() }); });
afterEach(() => { h.cleanups.forEach(fn => fn()); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("completed-source route and permitted defaults", () => {
  it("roundtrips only opaque identities and general divergent Calendar return coordinates", () => { const href = completedReservationCreateHref(route)!; expect(context().returnRoute).toEqual(route); expect(completedReservationReturnHref(context())).toContain("calViewDate=2026-09-09"); expect(href).not.toMatch(/guest|email|phone|bookingEntry|sourceReference/); });
  it.each(["extendFrom=bad", "extendFrom=" + id(9), "property=" + id(9), "email=leak", "new=0", "opReturnFromViewportOffset=bad"])("rejects malformed, foreign or personal parameters %s", part => { const p = new URLSearchParams(completedReservationCreateHref(route)!.split("?")[1]); const [key, value] = part.split("="); p.set(key, value); expect(parseCompletedReservationCreateContext(p)).toBeNull(); });
  it("rejects duplicate keys and nonreservation routes; retains Today return", () => { const p = new URLSearchParams(completedReservationCreateHref(route)!.split("?")[1]); p.append("new", "1"); expect(parseCompletedReservationCreateContext(p)).toBeNull(); const today = { ...route, origin: { surface: "today" as const, propertyId: property, view: "visual" as const } }; expect(completedReservationCreateHref(today)).toContain("opReturnFromView=visual"); });
  it("uses property-local today plus1, not old departure or host date", () => { expect(completedReservationStayRange("Pacific/Auckland", new Date("2026-09-12T12:30:00Z"))).toEqual({ arrival: "2026-09-13", departure: "2026-09-14" }); expect(completedReservationStayRange("invalid")).toBeNull(); });
  it.each<Partial<Reservation>>([{ status: 6 }, { holdsInventory: true }, { propertyId: id(9) }, { reservationId: id(9) }, { primaryGuestName: "" }, { primaryGuestName: "Anonymised guest" }, { guestCount: 0 }])("rejects ineligible full detail %s", change => { expect(completedReservationSeed({ ...record(), ...change }, property, oldId)).toBeNull(); });
  it("copies only allowed personal fields and recorded unit hints, not linkage/source/notes/lifecycle", () => { expect(Object.keys(completedReservationSeed(record(), property, oldId)!)).toEqual(["primaryGuestName", "email", "phone", "guestCount", "inventoryUnitIds"]); });
  it("preselects all or none with exact full-range/current/sellable topology", () => { const select = (r = rooms, a = availability(), current = true) => completedReservationPreselection([unitId, second], property, "2026-09-12", "2026-09-13", r, a, current);
    expect(select()).toEqual([unitId, second]); expect(select(rooms, availability(), false)).toEqual([]); h.unavailable = true; expect(select()).toEqual([]); h.unavailable = false;
    expect(select([], availability())).toEqual([]); expect(select(rooms, availability("2026-09-13", "2026-09-14"))).toEqual([]);
    expect(select([{ ...rooms[0], units: rooms[0].units.map(u => ({ ...u, isSellable: false })) }])).toEqual([]); });
});

describe("actual completed-source creator", () => {
  it("does not silently preselect the remaining free bed, while allowing an explicit different choice", () => {
    h.unavailable = true; const p = props();
    const picker = () => render(p).find(n => n.type === ReservationInventoryPicker) as ReactElement<ComponentProps<typeof ReservationInventoryPicker>>;
    expect(picker().props.selectedUnits).toEqual([]); submit(p); expect(h.mutate).not.toHaveBeenCalled();
    picker().props.onToggle(second); expect(picker().props.selectedUnits).toEqual([second]);
    p.completedSource!.seed = completedReservationSeed({ ...record(), version: 4 }, property, oldId);
    expect(picker().props.selectedUnits).toEqual([second]); expect(h.request).not.toHaveBeenCalled();
  });
  it("seeds once without a request, keeps editable defaults through source refresh/version changes", () => { const p = props(); expect(field(p, "Arrival date").props.value).toBe("2026-09-12"); expect(field(p, "Departure date").props.value).toBe("2026-09-13"); expect(field(p, "Primary guest").props.value).toBe("QA returning guest"); field(p, "Primary guest").props.onChange!("Edited guest");
    p.completedSource!.source.isFetching = true; expect(field(p, "Primary guest").props.value).toBe("Edited guest"); submit(p); expect(h.mutate).not.toHaveBeenCalled();
    p.completedSource!.source.isFetching = false; p.completedSource!.seed = completedReservationSeed({ ...record(), primaryGuestName: "Refetched source", version: 4 }, property, oldId); expect(field(p, "Primary guest").props.value).toBe("Edited guest"); p.onClose(); expect(h.request).not.toHaveBeenCalled(); });
  it("never exposes defaults before current detail or during failed/denied/missing source", () => { const p = props(); p.completedSource!.seed = null; p.completedSource!.source.state = "loading"; expect(render(p).some(n => n.props.label === "Primary guest")).toBe(false); submit(p); expect(h.mutate).not.toHaveBeenCalled(); p.completedSource!.source.state = "unavailable"; expect(render(p).some(n => n.props.label === "Email (optional)")).toBe(false); });
  it("submits Direct with a NEW operation, no copied old source/notes/guest link, and no source mutation", async () => { const p = props(), old = record(); submit(p); const vars = h.mutate.mock.calls[0][0]; expect(vars.operationId).not.toBe(oldId); expect(vars.submittedPayload).toMatchObject({ arrival: "2026-09-12", departure: "2026-09-13", inventoryUnitIds: [unitId, second], sourceKind: 1, sourceSystem: null, sourceReference: null, notes: null, expectedArrivalTime: null, expectedDepartureTime: null }); expect(vars.selectedGuestId).toBeNull(); expect(vars.profileDetails).toBeNull();
    h.request.mockResolvedValue({ propertyId: property, reservationId: vars.operationId, version: 1, detailsRevision: 1, status: 1 }); await h.options.mutationFn(vars); expect(h.request).toHaveBeenCalledTimes(1); expect(h.request.mock.calls[0][0]).toBe(`/api/reservations/properties/${property}`); expect(record()).toEqual(old); expect(h.invalidate.mock.calls.map(x => x[0])).toContainEqual({ queryKey: ["reservation-calendar", property] }); });
  it("keeps exact mounted replay ahead of source503 and changed availability; rejects edited uncertain payload", async () => { const p = props(); submit(p); const vars = h.mutate.mock.calls[0][0]; h.request.mockRejectedValue(new ApiError("Response lost", 503)); await expect(h.options.mutationFn(vars)).rejects.toThrow(); h.options.onError(new Error("lost"), vars); h.unavailable = true; p.completedSource!.seed = null; p.completedSource!.source.state = "unavailable"; submit(p); const retry = h.mutate.mock.calls[1][0]; expect(retry.operationId).toBe(vars.operationId); expect(retry.submittedPayload).toEqual(vars.submittedPayload);
    p.completedSource!.seed = completedReservationSeed(record(), property, oldId); p.completedSource!.source.state = "ready"; field(p, "Primary guest").props.onChange!("Changed uncertain request"); submit(p); expect(h.mutate).toHaveBeenCalledTimes(2); });
  it("gives reload GET recovery priority even when completed source is unavailable", async () => { const p = props(); storeReservationRecovery(newReservationRecoveryCoordinate(session, property, id(80), false)); p.completedSource!.seed = null; p.completedSource!.source.state = "unavailable"; const tree = render(p); expect(tree.some(n => n.props.label === "Primary guest")).toBe(false); const recovery = tree.find(n => n.type === ReservationCreationRecovery) as ReactElement<ComponentProps<typeof ReservationCreationRecovery>>; expect(recovery.props.autoCheck).toBe(true); expect(recovery.props.contextReady).toBe(true); expect(recovery.props.mayReadCurrent).toBe(true); submit(p); expect(h.mutate).not.toHaveBeenCalled(); await recovery.props.onRecovered({ ...record(), reservationId: id(80) }, null); expect(p.onCreated).toHaveBeenCalledWith(expect.objectContaining({ reservationId: id(80) }), null, true); });
});
