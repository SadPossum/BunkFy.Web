import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import { CompositeSourceNotice } from "../src/components/ui/CompositeSourceNotice";
import type { ReservationMutationReceipt } from "../src/api/types";
import { CreateReservationModal } from "../src/features/reservations/CreateReservationModal";
import { ReservationInventoryPicker } from "../src/features/reservations/ReservationInventoryPicker";
import { reservationCreateFingerprint, type ReservationCreatePayload } from "../src/features/reservations/reservationCreateAttempt";
import { newReservationRecoveryCoordinate, readReservationRecovery, type ReservationRecoverySnapshot } from "../src/features/reservations/reservationCreationRecovery";
import { reservationEditorIdentity } from "../src/features/reservations/reservationsMutationAuthority";

// Render the real creator, fields, local footer and recovery panel. Only external queries and creator hook state
// are deterministic doubles. The footer portal host is inlined for SSR; local action rendering remains real.
// Lifecycle/network, shared portal placement and native browser focus have separate regression gates.
const state = vi.hoisted(() => ({ creator: false, stateIndex: 0, refIndex: 0, snapshot: { kind: "none" } as ReservationRecoverySnapshot,
  step: "reservation", guestSave: false, units: [] as string[], name: "", owned: false, uncertain: false, pending: false, entered: false,
  availabilityError: null as unknown, attempt: null as unknown, request: vi.fn(), session: {} as Record<string, string>,
  emptyInventory: false, availabilityMode: "current", roomInventoryMode: "current",
  queryOptions: new Map<string, { queryKey: string[]; enabled: boolean }>(), availabilityRefetch: vi.fn(async () => undefined), roomRefetch: vi.fn(async () => undefined),
  range: { arrival: "2026-09-08", departure: "2026-09-10" }, responseRange: { arrival: "2026-09-08", departure: "2026-09-10" },
  sourceKind: "direct", sourceSystem: "", sourceReference: "", mutate: vi.fn(), includeUnavailable: false,
  picker: false, pickerIndex: 0, pickerSlots: [] as unknown[], setters: new Map<number, ReturnType<typeof vi.fn>>(),
  mutationOptions: null as unknown, refs: [] as { current: unknown }[] }));
vi.mock("react", async (load) => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => {
      if (state.picker) {
        const index = state.pickerIndex++;
        if (!(index in state.pickerSlots)) state.pickerSlots[index] = typeof initial === "function" ? initial() : initial;
        return [state.pickerSlots[index], (next: unknown) => { state.pickerSlots[index] = typeof next === "function" ? next(state.pickerSlots[index]) : next; }];
      }
      if (!state.creator) return actual.useState(initial);
      const index = state.stateIndex++;
      const overrides: Record<number, unknown> = { 0: state.step, 1: state.range, 2: state.units, 4: state.uncertain, 5: state.entered,
        6: state.sourceKind, 7: state.sourceSystem, 8: state.sourceReference, 10: state.name, 17: state.guestSave };
      const value = index in overrides ? overrides[index] : typeof initial === "function" ? initial() : initial;
      const setter = vi.fn((next: unknown) => {
        const updated = typeof next === "function" ? next(value) : next;
        if (index === 1) state.range = updated;
        if (index === 2) state.units = updated;
        if (index === 6) state.sourceKind = updated;
        if (index === 7) state.sourceSystem = updated;
        if (index === 8) state.sourceReference = updated;
      });
      state.setters.set(index, setter);
      return [value, setter];
    },
    useRef: (initial: unknown) => {
      if (!state.creator) return actual.useRef(initial);
      const index = state.refIndex++;
      const ref = { current: index === 0 ? state.owned ? operationId : null : index === 5 ? state.attempt : initial };
      state.refs[index] = ref; return ref;
    },
    useEffect: (effect: Parameters<typeof actual.useEffect>[0], deps: Parameters<typeof actual.useEffect>[1]) => { if (!state.creator) actual.useEffect(effect, deps); },
    useLayoutEffect: (effect: Parameters<typeof actual.useLayoutEffect>[0], deps: Parameters<typeof actual.useLayoutEffect>[1]) => { if (!state.creator) actual.useLayoutEffect(effect, deps); },
    useMemo: (factory: () => unknown, deps: unknown[]) => state.creator ? factory() : actual.useMemo(factory, deps),
  };
});
vi.mock("../src/app/session", () => ({ useSession: () => ({ session: state.session, request: state.request }) }));
vi.mock("../src/app/networkStatus", () => ({ useNetworkStatus: () => ({ isOnline: true, isOffline: false }) }));
vi.mock("../src/features/reservations/useReservationCreationRecovery", () => ({ useReservationCreationRecovery: () => ({ snapshot: state.snapshot, refresh: vi.fn() }) }));
vi.mock("../src/components/ui/primitives", async (load) => ({ ...await load<typeof import("../src/components/ui/primitives")>(),
  ModalActions: ({ children }: { children: ReactNode }) => createElement("footer", null, children),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), cancelQueries: vi.fn() }),
  useMutation: (options: unknown) => { state.mutationOptions = options; return { isPending: state.pending, error: null, mutate: state.mutate }; },
  useQuery: ({ queryKey, enabled }: { queryKey: string[]; enabled: boolean }) => {
    state.queryOptions.set(queryKey[0], { queryKey, enabled });
    const availability = queryKey[0] === "availability";
    const mode = availability ? state.availabilityMode : state.roomInventoryMode;
    const responseProperty = mode === "mismatch" ? id(9) : propertyId;
    return {
      data: mode === "disabled" || mode === "loading" || mode === "unavailable" ? undefined : availability
        ? { propertyId: responseProperty, ...state.responseRange, units: state.emptyInventory ? [] : [
          { unit, isAvailable: !state.availabilityError, activeBlockIds: [], activeAllocationIds: [] },
          ...(state.includeUnavailable ? [{ unit: { ...unit, inventoryUnitId: id(10), label: "104-E" }, isAvailable: false, activeBlockIds: [], activeAllocationIds: [] }] : []),
        ] }
        : { rooms: state.emptyInventory && mode !== "mismatch" ? [] : [{ ...room, propertyId: responseProperty }] },
      error: mode === "stale" || mode === "unavailable" ? new Error("Controlled inventory read failure") : availability ? state.availabilityError : null,
      isLoading: mode === "loading", isFetching: mode === "fetching", isPaused: mode === "paused", refetch: availability ? state.availabilityRefetch : state.roomRefetch,
    };
  },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const propertyId = id(4), operationId = id(5), unitId = id(6), roomId = id(7);
const stay = { arrival: "2026-09-08", departure: "2026-09-10" };
const unit = { propertyId, roomId, inventoryUnitId: unitId, bedId: id(8), kind: "bed", label: "104-D", isSellable: true, isTopologyActive: true };
const room = { propertyId, roomId, roomName: "Dorm 104", units: [unit] };
const session = { tenantId: id(1), subjectId: id(2), sessionId: id(3), accessToken: "not-a-token", username: "synthetic" };
const record = () => newReservationRecoveryCoordinate(session, propertyId, operationId, false);
function creatorTree(props: Partial<ComponentProps<typeof CreateReservationModal>> = {}) {
  state.creator = true; state.stateIndex = 0; state.refIndex = 0;
  const tree = CreateReservationModal({ propertyId, propertyTimeZoneId: "Europe/London", permissionSource: { label: "Permissions", state: "ready", isFetching: false, refetch: vi.fn() },
    canCreateReservation: true, canReadInventory: true, canReadReservations: true, canReadGuests: false, canCreateGuests: true, canManageGuests: true,
    onClose: vi.fn(), onCreated: vi.fn(), ...props });
  state.creator = false;
  return tree;
}
function render(props: Partial<ComponentProps<typeof CreateReservationModal>> = {}) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, creatorTree(props)));
}
type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
// Preserve null/false sibling slots and ancestor type/key identities, as React reconciliation does.
// This is a focused element/hook-state contract, not a browser renderer or focus simulation.
function elements(node: ReactNode, path = ""): { element: Element; path: string }[] {
  if (Array.isArray(node)) return node.flatMap((child, index) => elements(child, `${path}/${index}`));
  if (!isValidElement<Element["props"]>(node)) return [];
  const type = typeof node.type === "string" ? node.type : typeof node.type === "function" ? node.type.name : String(node.type);
  const next = `${path}/${type}:${node.key ?? ""}`;
  return [{ element: node, path: next }, ...elements(node.props.children, next)];
}
function pickerEntry(tree = creatorTree()) {
  return elements(tree).find(({ element }) => element.type === ReservationInventoryPicker);
}
function pickerTree(entry: NonNullable<ReturnType<typeof pickerEntry>>) {
  state.picker = true; state.pickerIndex = 0;
  const tree = ReservationInventoryPicker(entry.element.props as ComponentProps<typeof ReservationInventoryPicker>);
  state.picker = false;
  return tree;
}
function expectHiddenPicker(tree = creatorTree()) {
  const entry = pickerEntry(tree)!;
  const props = entry.element.props as ComponentProps<typeof ReservationInventoryPicker>;
  expect(props).toMatchObject({ visible: false, groups: [], selectedUnits: [], selectionEnabled: false, error: null });
  props.onToggle(unitId); expect(state.setters.get(2)).not.toHaveBeenCalled();
  expect(pickerTree(entry)).toBeNull(); expect(renderToStaticMarkup(pickerTree(entry))).toBe("");
  return entry;
}
function chooseSource(kind: string) {
  const radio = elements(creatorTree()).find(({ element }) => element.type === "input" && element.props.type === "radio" && element.props.value === kind)!.element;
  (radio.props.onChange as () => void)();
}
function submitTree() {
  const form = elements(creatorTree()).find(({ element }) => element.type === "form")!.element;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
}
const submitButtons = (html: string) => html.match(/<button\b[^>]*type="submit"[^>]*>/g) ?? [];
const cancelButton = (html: string) => html.match(/<button\b[^>]*>Cancel<\/button>/)?.[0];
beforeEach(() => { Object.assign(state, { creator: false, snapshot: { kind: "none" }, step: "reservation", guestSave: false, units: [], name: "", owned: false, uncertain: false, pending: false, entered: false, availabilityError: null, emptyInventory: false, availabilityMode: "current", roomInventoryMode: "current", attempt: null, session,
  sourceKind: "direct", sourceSystem: "", sourceReference: "", includeUnavailable: false, range: { ...stay }, responseRange: { ...stay }, picker: false, pickerIndex: 0, pickerSlots: [] });
  state.request.mockClear(); state.mutate.mockClear(); state.setters.clear(); state.queryOptions.clear(); state.availabilityRefetch.mockClear(); state.roomRefetch.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe("invalid reservation dates are validation, not failed availability", () => {
  const correction = "Choose a departure date after arrival to check available rooms and beds.";
  function changeDate(label: string, value: string) {
    const field = elements(creatorTree()).find(({ element }) => element.props.label === label && typeof element.props.onChange === "function")!.element;
    (field.props.onChange as (next: string) => void)(value);
  }
  function notice(tree = creatorTree()) {
    const entry = elements(tree).find(({ element }) => element.type === CompositeSourceNotice)!.element;
    // Real notice and retry callback, with only network status controlled online.
    return CompositeSourceNotice(entry.props as ComponentProps<typeof CompositeSourceNotice>);
  }
  function retry(tree: ReturnType<typeof notice>) {
    const button = elements(tree).find(({ element }) => element.type === "button")!.element;
    expect(button.props.disabled).toBe(false);
    (button.props.onClick as () => void)();
  }
  it.each([
    { arrival: "2026-09-10", departure: "2026-09-10" },
    { arrival: "2027-10-10", departure: "2026-09-22" },
    { arrival: "", departure: "2026-09-10" },
    { arrival: "2026-09-08", departure: "" },
  ])("corrects an initially invalid $arrival → $departure without a failed-source retry", (range) => {
    state.range = range; state.availabilityMode = "disabled"; state.name = "Retained date draft";
    const html = render();
    expect(state.queryOptions.get("availability")).toEqual({ queryKey: ["availability", propertyId, range.arrival, range.departure], enabled: false });
    expect(state.queryOptions.get("inventory-rooms")?.enabled).toBe(true);
    expect(html).toContain("Departure must be after arrival.");
    expect(html).toContain(correction); expect(html).not.toContain("Inventory is not currently confirmed");
    expect(html).not.toContain("Some reservation context is delayed"); expect(html).not.toContain("Availability could not be confirmed");
    expect(html).not.toContain("Try again"); expect(notice()).toBeNull();
    expectHiddenPicker(); expect(submitButtons(html)[0]).toContain('disabled=""'); submitTree();
    expect(state.request).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled(); expect(state.availabilityRefetch).not.toHaveBeenCalled();
  });
  it.each(["current", "stale", "mismatch"])("clears selection through the real date handler without trusting %s old-range cache", (mode) => {
    state.name = "Retained date draft"; state.units = [unitId]; state.sourceKind = "external"; state.sourceSystem = "Booking.com"; state.sourceReference = "RANGE-123";
    expect(submitButtons(render())[0]).not.toContain("disabled");
    changeDate("Arrival date", "2027-10-10");
    expect(state.units).toEqual([]); expect(state.setters.get(2)).toHaveBeenCalledWith([]);
    state.availabilityMode = mode;
    const html = render();
    expect(state.queryOptions.get("availability")?.enabled).toBe(false);
    expect(html).toContain('value="Retained date draft"'); expect(html).toContain('value="Booking.com"'); expect(html).toContain('value="RANGE-123"');
    expect(html).toContain(correction); expect(notice()).toBeNull(); expectHiddenPicker();
    expect(submitButtons(html)[0]).toContain('disabled=""'); submitTree();
    expect(state.mutate).not.toHaveBeenCalled(); expect(state.request).not.toHaveBeenCalled(); expect(state.availabilityRefetch).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "stale"])("retains genuine %s room failure and retries only rooms during invalid dates", (mode) => {
    state.range = { arrival: "2027-10-10", departure: stay.departure }; state.availabilityMode = "disabled"; state.roomInventoryMode = mode;
    const html = render();
    expect(html).toContain(mode === "stale" ? "Room labels is showing its last confirmed snapshot" : "Room labels could not be confirmed");
    expect(html).not.toContain("Availability could not be confirmed"); expect(html).toContain(correction);
    expect(html.match(/>Try again</g)).toHaveLength(1); retry(notice());
    expect(state.roomRefetch).toHaveBeenCalledOnce(); expect(state.availabilityRefetch).not.toHaveBeenCalled();
    expect(submitButtons(html)[0]).toContain('disabled=""'); expect(state.mutate).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "stale"] as const)("keeps %s permission recovery independent of disabled inventory", (permissionState) => {
    state.entered = true; state.name = "Permission-held draft"; state.range = { arrival: "2027-10-10", departure: stay.departure }; state.availabilityMode = "disabled"; state.roomInventoryMode = "unavailable";
    const refetch = vi.fn(async () => undefined);
    const props = { permissionSource: { label: "Permissions", state: permissionState, isFetching: false, refetch } };
    const html = render(props);
    expect(html).toContain("Permissions"); expect(html).not.toContain("Room labels could not be confirmed"); expect(html).not.toContain("Availability could not be confirmed");
    expect(state.queryOptions.get("availability")?.enabled).toBe(false); expect(state.queryOptions.get("inventory-rooms")?.enabled).toBe(false);
    expect(html).toContain('value="Permission-held draft"'); expect(submitButtons(html)[0]).toContain('disabled=""');
    retry(notice(creatorTree(props))); expect(refetch).toHaveBeenCalledOnce();
    expect(state.roomRefetch).not.toHaveBeenCalled(); expect(state.availabilityRefetch).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled();
  });
  it("restores the exact enabled query, truthful loading/503/retry and selectable inventory without old selections", () => {
    state.name = "Retained date draft"; state.units = [unitId];
    changeDate("Arrival date", "2027-10-10"); state.availabilityMode = "disabled";
    expect(notice()).toBeNull(); expect(state.units).toEqual([]);
    changeDate("Departure date", "2027-10-12"); state.availabilityMode = "loading";
    let html = render();
    expect(state.queryOptions.get("availability")).toEqual({ queryKey: ["availability", propertyId, "2027-10-10", "2027-10-12"], enabled: true });
    expect(html).not.toContain(correction); expect(html).not.toContain("Departure must be after arrival");
    expect(html).toContain("Inventory is not currently confirmed"); expect(notice()).toBeNull();
    expectHiddenPicker(); expect(submitButtons(html)[0]).toContain('disabled=""');
    state.availabilityMode = "unavailable"; html = render();
    expect(html).toContain("Availability could not be confirmed"); expect(html.match(/>Try again</g)).toHaveLength(1);
    retry(notice()); expect(state.availabilityRefetch).toHaveBeenCalledOnce(); expect(state.roomRefetch).not.toHaveBeenCalled();
    state.availabilityMode = "current";
    expectHiddenPicker(); // The old successful range is still not authority for the corrected stay.
    state.responseRange = { ...state.range }; html = render();
    expect(notice()).toBeNull(); expect(html).not.toContain("Inventory is not currently confirmed");
    expect(html).toContain('value="Retained date draft"'); expect(state.units).toEqual([]); expect(submitButtons(html)[0]).toContain('disabled=""');
    const picker = pickerEntry()!.element.props as ComponentProps<typeof ReservationInventoryPicker>;
    expect(picker.selectionEnabled).toBe(true); picker.onToggle(unitId);
    expect(state.units).toEqual([unitId]); expect(submitButtons(render())[0]).not.toContain("disabled");
    expect(state.request).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled();
  });
  it("does not allow an invalid form to bypass validation through exact saved-request replay", () => {
    state.snapshot = { kind: "record", record: record() }; state.owned = true; state.uncertain = true;
    state.range = { arrival: stay.departure, departure: stay.arrival }; state.name = "Synthetic booking"; state.units = [unitId]; state.availabilityMode = "disabled";
    state.attempt = { operationId, fingerprint: reservationCreateFingerprint({ ...state.range, expectedArrivalTime: null, expectedDepartureTime: null,
      inventoryUnitIds: [unitId], primaryGuestName: state.name, email: null, phone: null, guestCount: 1, sourceKind: 1, sourceSystem: null, sourceReference: null, notes: null }) };
    const html = render(); expect(html).toContain("Retry same reservation"); expect(submitButtons(html)[0]).toContain('disabled=""');
    expect(html).toContain(correction); expect(notice()).toBeNull(); submitTree();
    expect(state.request).not.toHaveBeenCalled(); expect(state.mutate).not.toHaveBeenCalled(); expect(state.availabilityRefetch).not.toHaveBeenCalled();
  });
});

describe("reservation form ownership renders one coherent footer", () => {
  it("renders one honest access reset, accessible retry and Cancel without fields or submit", () => {
    state.name = "Cleared guest";
    const html = render({ permissionSource: { label: "Permissions", state: "loading", isFetching: true, refetch: vi.fn() }, canCreateReservation: false,
      accessReset: { accessCurrent: false, canStartFresh: false, onRetry: vi.fn(), onStartFresh: vi.fn() } });
    expect(html).toContain("The form was reset and its guest details were cleared");
    expect(html).toContain(">Check access</button>"); expect(cancelButton(html)).not.toContain("disabled");
    expect(html).not.toContain("Your draft stays here"); expect(html).not.toContain("Some reservation context is delayed");
    expect(html).not.toContain("Cleared guest"); expect(html).not.toContain("Primary guest"); expect(submitButtons(html)).toHaveLength(0);
  });
  it("offers deliberate fresh entry after access recovers, then labels the empty form explicitly", () => {
    let html = render({ accessReset: { accessCurrent: true, canStartFresh: true, onRetry: vi.fn(), onStartFresh: vi.fn() } });
    expect(html).toContain("Start a fresh reservation"); expect(html).not.toContain("Primary guest"); expect(submitButtons(html)).toHaveLength(0);
    html = render({ freshAfterAccessReset: true }); expect(html).toContain("Fresh reservation form"); expect(html).toContain("Primary guest");
    expect(submitButtons(html)[0]).toContain('disabled=""');
  });
  it.each(["prepared", "primary-confirmed", "follow-on-unknown"] as const)("keeps %s save recovery ahead of fresh entry throughout an access reset", (phase) => {
    state.snapshot = { kind: "record", record: { ...record(), state: phase } };
    const html = render({ accessReset: { accessCurrent: true, canStartFresh: true, onRetry: vi.fn(), onStartFresh: vi.fn() } });
    expect(html).toContain("Check saved reservation"); expect(html).toContain("may already have created a reservation");
    expect(html).not.toContain("Start a fresh reservation"); expect(html).not.toContain("Primary guest"); expect(submitButtons(html)).toHaveLength(0);
    expect(state.snapshot).toMatchObject({ kind: "record", record: { state: phase } }); expect(state.request).not.toHaveBeenCalled();
  });
  it("keeps a save pending across a reset without exposing duplicate creation or marker removal", () => {
    state.snapshot = { kind: "record", record: record() };
    const html = render({ previousSavePending: true, accessReset: { accessCurrent: true, canStartFresh: false, onRetry: vi.fn(), onStartFresh: vi.fn() } });
    expect(html).toContain("Saving this reservation"); expect(cancelButton(html)).toContain('disabled=""');
    expect(html).toMatch(/disabled=""[^>]*>Stop recovery…<\/button>/); expect(submitButtons(html)).toHaveLength(0);
  });
  it("preserves the mounted draft on retryable currentness failure and keeps ordinary decision denial distinct", () => {
    state.name = "Retained guest"; state.entered = true;
    let html = render({ permissionSource: { label: "Permissions", state: "stale", isFetching: false, refetch: vi.fn() } });
    expect(html).toContain('value="Retained guest"'); expect(html).not.toContain("The form was reset"); expect(submitButtons(html)[0]).toContain('disabled=""');
    html = render({ canCreateReservation: false }); expect(html).toContain("Reservation creation and inventory access are required");
    expect(html).not.toContain("The form was reset"); expect(submitButtons(html)[0]).toContain('disabled=""');
  });
  it("retains the exact disabled draft during permission503 and restores inventory without a configuration-empty claim", () => {
    state.name = "Retained 503 guest"; state.entered = true; state.units = [unitId];
    const html = render({ permissionSource: { label: "Permissions", state: "stale", isFetching: false, refetch: vi.fn() } });
    expect(html).toContain('value="Retained 503 guest"');
    expect(html).toContain('aria-label="Arrival date: September 8, 2026"');
    expect(html).toContain('aria-label="Departure date: September 10, 2026"');
    expect(html).toMatch(/<fieldset[^>]*disabled=""/); expect(submitButtons(html)[0]).toContain('disabled=""');
    expect(html).toContain("Checking current access. Your draft stays here while access recovers.");
    expect(html).not.toContain("No sellable inventory"); expect(html).not.toContain("No units are available");
    expect(html).not.toContain("Fresh reservation form");
    const recovered = render();
    expect(recovered).toContain('value="Retained 503 guest"'); expect(recovered).toContain("104-D");
    expect(recovered).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(state.units).toEqual([unitId]); expect(state.request).not.toHaveBeenCalled();
  });
  it("keeps authoritative true-empty copy only when both inventory sources are current", () => {
    state.emptyInventory = true; state.entered = true;
    expect(render()).toContain("No sellable inventory is configured for this property.");
    expect(render()).not.toContain("Inventory is not currently confirmed");
    expect(submitButtons(render())[0]).toContain('disabled=""');
  });
  it.each(["availabilityMode", "roomInventoryMode"] as const)("keeps the exact populated picker slot and local controls through %s refresh/error/recovery", (source) => {
    state.includeUnavailable = true; state.name = "Retained picker guest"; state.units = [unitId];
    const initial = pickerEntry()!;
    const firstTree = pickerTree(initial);
    const toggle = elements(firstTree).find(({ element }) => element.props["aria-label"] === "Show unavailable inventory")!.element;
    (toggle.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const section = elements(pickerTree(initial)).find(({ element }) => typeof element.props.onCollapse === "function")!.element;
    (section.props.onCollapse as () => void)();
    expect(state.pickerSlots).toEqual([true, new Set([roomId])]);

    for (const mode of ["fetching", "stale", "paused", "current"]) {
      state[source] = mode;
      const entry = pickerEntry()!;
      expect(entry.path, mode).toBe(initial.path); expect(entry.element.type).toBe(initial.element.type);
      expect(entry.element.key, mode).toBe(initial.element.key);
      const props = entry.element.props as ComponentProps<typeof ReservationInventoryPicker>;
      expect(props.selectionEnabled).toBe(mode === "current"); expect(props.selectedUnits).toEqual([unitId]);
      expect(props.loading).toBe(false); expect(props.error).toBeNull();
      const localHtml = renderToStaticMarkup(pickerTree(entry));
      expect(localHtml).toMatch(/aria-label="Show unavailable inventory"[^>]*checked=""/);
      expect(localHtml).toContain('aria-expanded="false"');
      expect(state.pickerSlots).toEqual([true, new Set([roomId])]);
      const html = render();
      expect(html).toContain('value="Retained picker guest"');
      if (mode === "current") {
        expect(html).not.toContain("Inventory is not currently confirmed"); expect(submitButtons(html)[0]).not.toContain("disabled");
      } else {
        expect(html).toContain("from the last matching result"); expect(submitButtons(html)[0]).toContain('disabled=""');
        expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""[^>]*checked=""/);
        props.onToggle(unitId); expect(state.setters.get(2)).not.toHaveBeenCalled();
        submitTree(); expect(state.mutate).not.toHaveBeenCalled();
      }
    }
  });
  it.each(["availabilityMode", "roomInventoryMode"] as const)("withholds populated picker data when %s is missing or mismatched", (source) => {
    for (const mode of ["loading", "unavailable", "mismatch"]) {
      state[source] = mode;
      expectHiddenPicker();
      const html = render(); expect(html).not.toContain("104-D"); expect(html).toContain("Inventory is not currently confirmed");
      expect(html).not.toContain("No sellable inventory"); expect(submitButtons(html)[0]).toContain('disabled=""');
    }
  });
  it("retains only the preference owner through temporary permission/property currentness and unusable inventory", () => {
    state.entered = true; state.includeUnavailable = true; state.name = "Same editor guest"; state.units = [unitId];
    const initial = pickerEntry()!;
    const toggle = elements(pickerTree(initial)).find(({ element }) => element.props["aria-label"] === "Show unavailable inventory")!.element;
    (toggle.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    const section = elements(pickerTree(initial)).find(({ element }) => typeof element.props.onCollapse === "function")!.element;
    (section.props.onCollapse as () => void)();
    for (const sourceState of ["unavailable", "stale", "loading", "ready"] as const) {
      const props = { permissionSource: { label: "Permissions", state: sourceState, isFetching: sourceState === "ready", refetch: vi.fn() } };
      const entry = expectHiddenPicker(creatorTree(props));
      expect(entry.path).toBe(initial.path); expect(entry.element.key).toBe(initial.element.key);
      expect(state.pickerSlots).toEqual([true, new Set([roomId])]);
      const html = render(props);
      expect(html).toContain("Your draft stays here"); expect(html).toContain('value="Same editor guest"');
      expect(html).not.toContain("104-D"); expect(html).not.toContain("1 selected");
      expect(html).not.toContain("No sellable inventory"); expect(submitButtons(html)[0]).toContain('disabled=""');
    }
    expectHiddenPicker(creatorTree({ canReadInventory: false }));
    state.availabilityMode = "unavailable"; expectHiddenPicker();
    state.availabilityMode = "current"; state.roomInventoryMode = "loading"; expectHiddenPicker();
    state.roomInventoryMode = "current";
    const restored = pickerEntry()!; expect(restored.path).toBe(initial.path);
    const html = renderToStaticMarkup(pickerTree(restored));
    expect(html).toMatch(/aria-label="Show unavailable inventory"[^>]*checked=""/); expect(html).toContain('aria-expanded="false"');
    expect(state.pickerSlots).toEqual([true, new Set([roomId])]); expect(state.units).toEqual([unitId]);
    expect(restored.element.props.selectedUnits).toEqual([unitId]); expect(restored.element.props.selectionEnabled).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled(); expect(state.request).not.toHaveBeenCalled();
  });
  it("defaults the picker visible but never retains its owner across initial denial, access reset or foreign save recovery", () => {
    const props = pickerEntry()!.element.props as ComponentProps<typeof ReservationInventoryPicker>;
    expect(renderToStaticMarkup(createElement(ReservationInventoryPicker, { ...props, visible: undefined }))).toContain("104-D");
    expect(pickerEntry(creatorTree({ canCreateReservation: false }))).toBeUndefined();
    state.entered = true;
    expect(pickerEntry(creatorTree({ accessReset: { accessCurrent: false, canStartFresh: false, onRetry: vi.fn(), onStartFresh: vi.fn() } }))).toBeUndefined();
    state.snapshot = { kind: "record", record: record() };
    expect(pickerEntry()).toBeUndefined();
  });
  it("does not reuse old-date or foreign-property data and changes picker identity for a new stay or session", () => {
    const initial = pickerEntry()!;
    state.range = { arrival: "2026-09-11", departure: "2026-09-13" };
    const changedStay = expectHiddenPicker(); expect(changedStay.element.key).not.toBe(initial.element.key);
    state.responseRange = { ...state.range };
    const nextStay = pickerEntry()!; expect(nextStay.element.key).not.toBe(initial.element.key);
    const changedProperty = expectHiddenPicker(creatorTree({ propertyId: id(11) }));
    expect(changedProperty.element.key).not.toBe(nextStay.element.key);
    state.session = { ...session, sessionId: id(12) };
    expect(pickerEntry()!.element.key).not.toBe(nextStay.element.key);
    const nextSession = pickerEntry()!;
    state.session = { ...session, subjectId: id(13) };
    expect(pickerEntry()!.element.key).not.toBe(nextSession.element.key);
  });
  it("renders a named native radio fieldset with separated 44px-minimum checked and focus targets", () => {
    const html = render();
    const sourceGroup = html.match(/<fieldset class="min-w-0">[\s\S]*?<\/fieldset>/)![0];
    expect(sourceGroup).toContain("<legend"); expect(sourceGroup).toContain("Booking source</legend>");
    expect(sourceGroup).toContain("grid grid-cols-2 gap-2");
    expect(sourceGroup.match(/min-h-11/g)).toHaveLength(2);
    expect(sourceGroup.match(/focus-within:ring-2/g)).toHaveLength(2);
    expect(sourceGroup.match(/type="radio"/g)).toHaveLength(2);
    expect(sourceGroup.match(/name="reservation-booking-source"/g)).toHaveLength(2);
    expect(sourceGroup.match(/checked=""/g)).toHaveLength(1);
    expect(sourceGroup).toMatch(/checked=""[^>]*value="direct"/);
    expect(sourceGroup).toContain("border-primary bg-primary/10 text-primary");
    expect(sourceGroup).not.toContain("<button"); expect(sourceGroup).not.toContain('role="tab'); expect(sourceGroup).not.toContain('role="switch');
    chooseSource("external");
    expect(state.sourceKind).toBe("external"); expect(render()).toMatch(/checked=""[^>]*value="external"/);
  });
  it("retains unsent External fields, requires both, and sends null External details for Direct", () => {
    state.name = "Source guest"; state.units = [unitId];
    chooseSource("external");
    expect(submitButtons(render())[0]).toContain('disabled=""'); submitTree(); expect(state.mutate).not.toHaveBeenCalled();
    state.sourceSystem = "Booking.com";
    expect(submitButtons(render())[0]).toContain('disabled=""');
    state.sourceReference = "ABC-123";
    const externalHtml = render();
    expect(externalHtml).toMatch(/<input[^>]*required=""[^>]*value="Booking.com"/);
    expect(externalHtml).toMatch(/<input[^>]*required=""[^>]*value="ABC-123"/);
    expect(submitButtons(externalHtml)[0]).not.toContain("disabled");
    submitTree();
    const external = state.mutate.mock.calls.at(-1)![0].submittedPayload as ReservationCreatePayload;
    expect(external).toMatchObject({ sourceKind: 2, sourceSystem: "Booking.com", sourceReference: "ABC-123" });
    const externalFingerprint = reservationCreateFingerprint(external);
    chooseSource("direct");
    const directHtml = render(); expect(directHtml).not.toContain("Source system"); expect(directHtml).not.toContain("Source reference");
    submitTree();
    const direct = state.mutate.mock.calls.at(-1)![0].submittedPayload as ReservationCreatePayload;
    expect(direct).toMatchObject({ sourceKind: 1, sourceSystem: null, sourceReference: null });
    expect(reservationCreateFingerprint(direct)).not.toBe(externalFingerprint);
    chooseSource("external");
    expect(render()).toContain('value="ABC-123"'); expect(state.sourceSystem).toBe("Booking.com");
    submitTree(); expect(reservationCreateFingerprint(state.mutate.mock.calls.at(-1)![0].submittedPayload)).toBe(externalFingerprint);
  });
  it("keeps source radios inside the disabled draft fieldset during pending save or unavailable permission", () => {
    state.entered = true;
    for (const pending of [true, false]) {
      state.pending = pending;
      const tree = creatorTree(pending ? {} : { permissionSource: { label: "Permissions", state: "stale", isFetching: false, refetch: vi.fn() } });
      const disabledFieldset = elements(tree).find(({ element }) => element.type === "fieldset" && element.props.disabled)!.element;
      const radios = elements(disabledFieldset).filter(({ element }) => element.type === "input" && element.props.type === "radio");
      expect(radios).toHaveLength(2); expect(radios.filter(({ element }) => element.props.checked)).toHaveLength(1);
    }
  });
  it.each(["availabilityMode", "roomInventoryMode"] as const)("does not call empty inventory configured when %s is not current", (source) => {
    state.emptyInventory = true; state.entered = true; state.name = "Keep this draft";
    for (const mode of ["loading", "stale", "unavailable", "fetching", "paused", "mismatch"]) {
      state[source] = mode; const html = render();
      expect(html, mode).not.toContain("No sellable inventory is configured");
      expect(html, mode).toContain("Inventory is not currently confirmed");
      expect(html, mode).toContain('value="Keep this draft"');
      expect(submitButtons(html)[0], mode).toContain('disabled=""');
    }
    expect(state.request).not.toHaveBeenCalled();
  });
  it("shows the persistent cleared-details explanation on a blank recovered form, not lost PII or saved-operation actions", () => {
    state.entered = true;
    const html = render({ freshAfterAccessReset: true });
    expect(html).toContain("The previous guest details were cleared after reservation access changed");
    expect(html).toContain('placeholder="Guest name"'); expect(html).not.toContain("Retained 503 guest");
    expect(submitButtons(html)[0]).toContain('disabled=""');
    state.snapshot = { kind: "record", record: record() };
    const blocked = render({ freshAfterAccessReset: true });
    expect(blocked).not.toContain("Fresh reservation form"); expect(blocked).not.toContain("Primary guest");
    expect(blocked).toContain("Check saved reservation"); expect(submitButtons(blocked)).toHaveLength(0);
    expect(state.request).not.toHaveBeenCalled();
  });
  it("retains ordinary fields, validation and disabled Create until the booking is valid", () => {
    let html = render(); expect(html).toContain("Primary guest"); expect(html).toContain("Select at least one available unit.");
    expect(submitButtons(html)).toHaveLength(1); expect(submitButtons(html)[0]).toContain('disabled=""'); expect(html).toContain("Create reservation");
    state.units = [unitId]; state.name = "Synthetic booking"; html = render();
    expect(submitButtons(html)[0]).not.toContain("disabled"); expect(cancelButton(html)).not.toContain("disabled");
  });
  it("retains optional Guest Record Continue/progress and Back on the real guest step", () => {
    state.units = [unitId]; state.name = "Synthetic booking"; state.guestSave = true;
    let html = render(); expect(html).toContain("Continue"); expect(html).toContain('aria-label="Reservation creation progress"');
    state.step = "guest"; html = render(); expect(html).toContain("Back</button>"); expect(html).toContain("Legal name"); expect(submitButtons(html)).toHaveLength(1);
  });
  it.each(["prepared", "primary-confirmed", "follow-on-unknown"] as const)("remounted %s recovery removes ordinary fields, validation, progress, Back and submit but keeps recovery/Cancel", (phase) => {
    state.snapshot = { kind: "record", record: { ...record(), state: phase } };
    state.step = "guest"; state.guestSave = true;
    const html = render(); expect(html).toContain("Check saved reservation"); expect(html).toContain("Inspect Reservations"); expect(html).toContain("Stop recovery");
    expect(submitButtons(html)).toHaveLength(0); expect(html).not.toContain("Select at least one available unit.");
    expect(html).not.toContain('aria-label="Reservation creation progress"'); expect(html).not.toContain("Back</button>"); expect(html).not.toContain("Legal name");
    expect(cancelButton(html)).toBeDefined(); expect(cancelButton(html)).not.toContain("disabled"); expect(state.request).not.toHaveBeenCalled();
  });
  it.each(["malformed", "unavailable", "foreign"])("offers an honest recovery/close surface, never new-form actions, for %s metadata", (kind) => {
    state.snapshot = kind === "foreign" ? { kind: "record", record: { ...record(), sessionId: id(9) } } : { kind: kind as "malformed" | "unavailable" };
    const html = render(); expect(html).toContain('aria-label="Reservation save recovery"'); expect(submitButtons(html)).toHaveLength(0);
    expect(html).not.toContain("Primary guest"); expect(html).not.toContain("Select at least one available unit."); expect(cancelButton(html)).toBeDefined();
  });
  it("keeps the original mounted fields and enabled exact Retry even when its held bed is no longer current-free", () => {
    state.snapshot = { kind: "record", record: record() }; state.owned = true; state.uncertain = true;
    state.units = [unitId]; state.name = "Synthetic booking"; state.availabilityError = new Error("Controlled unavailable read");
    state.attempt = { operationId, fingerprint: reservationCreateFingerprint({ ...stay, expectedArrivalTime: null, expectedDepartureTime: null,
      inventoryUnitIds: [unitId], primaryGuestName: state.name, email: null, phone: null, guestCount: 1, sourceKind: 1, sourceSystem: null, sourceReference: null, notes: null }) };
    const html = render(); expect(html).toContain("Primary guest"); expect(html).toContain("Retry same reservation");
    expect(submitButtons(html)).toHaveLength(1); expect(submitButtons(html)[0]).not.toContain("disabled"); expect(state.request).not.toHaveBeenCalled();
  });
  it("explicit cleanup restores normal form actions and validation", () => {
    state.snapshot = { kind: "record", record: record() }; expect(submitButtons(render())).toHaveLength(0);
    state.snapshot = { kind: "none" }; const html = render(); expect(html).toContain("Primary guest"); expect(html).toContain("Select at least one available unit."); expect(submitButtons(html)).toHaveLength(1);
  });
  it("preserves pending close/submit locks for the owned form and pending recovery-only surface", () => {
    state.pending = true; state.snapshot = { kind: "record", record: record() }; state.owned = true;
    let html = render(); expect(cancelButton(html)).toContain('disabled=""'); expect(submitButtons(html)[0]).toContain('disabled=""'); expect(html).toMatch(/disabled=""[^>]*aria-label="Close dialog"/);
    state.owned = false; html = render(); expect(cancelButton(html)).toContain('disabled=""'); expect(submitButtons(html)).toHaveLength(0);
  });
});

type MutationVariables = { profileDetails: { legalName: string; dateOfBirth: string; nationalityCountryCode: string; preferredLanguageTag: string; notes: string } | null;
  selectedGuestId: string | null; submittedPayload: ReservationCreatePayload; operationId: string; editorIdentity: string; dispatched: boolean };
type MutationResult = { reservation: ReservationMutationReceipt; warning: string | null; guestCreated: boolean };
type MutationCallbacks = { onMutate: () => void; onSettled: () => void; mutationFn: (variables: MutationVariables) => Promise<MutationResult>;
  onSuccess: (result: MutationResult, variables: MutationVariables) => Promise<void>; onError: (error: unknown, variables: MutationVariables) => void };
function sentRequest() {
  let raw: string | null = null;
  vi.stubGlobal("window", { sessionStorage: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } }, dispatchEvent: vi.fn() });
  const submittedPayload: ReservationCreatePayload = { ...stay, inventoryUnitIds: [unitId], primaryGuestName: "Synthetic booking", guestCount: 1,
    email: null, phone: null, expectedArrivalTime: null, expectedDepartureTime: null, sourceKind: 1, sourceSystem: null, sourceReference: null, notes: null };
  state.units = [unitId]; state.name = submittedPayload.primaryGuestName; state.guestSave = true;
  const onSavePendingChange = vi.fn(), onCreated = vi.fn(); render({ onSavePendingChange, onCreated });
  const callbacks = state.mutationOptions as MutationCallbacks;
  const variables: MutationVariables = { submittedPayload, operationId, editorIdentity: reservationEditorIdentity(session, propertyId), dispatched: false,
    profileDetails: { legalName: "", dateOfBirth: "", nationalityCountryCode: "", preferredLanguageTag: "", notes: "" }, selectedGuestId: null };
  return { callbacks, variables, onSavePendingChange, onCreated };
}

describe("creator request ownership across access reset", () => {
  it("retains the opaque coordinate when a sent POST returns403 and releases only the pending lock", async () => {
    const { callbacks, variables, onSavePendingChange, onCreated } = sentRequest();
    const failure = new ApiError("Rejected", 403); state.request.mockRejectedValueOnce(failure);
    callbacks.onMutate(); await expect(callbacks.mutationFn(variables)).rejects.toBe(failure);
    callbacks.onError(failure, variables); callbacks.onSettled();
    expect(variables.dispatched).toBe(true); expect(onSavePendingChange.mock.calls).toEqual([[true], [false]]);
    expect(readReservationRecovery()).toMatchObject({ kind: "record", record: { operationId, propertyId, state: "prepared", followOnNeeded: true } });
    expect(onCreated).not.toHaveBeenCalled(); expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("records a late primary response but starts no Guest Record work and cannot navigate the replaced editor", async () => {
    const { callbacks, variables, onSavePendingChange, onCreated } = sentRequest();
    let complete!: (receipt: ReservationMutationReceipt) => void;
    state.request.mockImplementationOnce(() => new Promise<ReservationMutationReceipt>((resolve) => { complete = resolve; }));
    callbacks.onMutate(); const saving = callbacks.mutationFn(variables);
    const instance = state.refs[4].current as { mounted: boolean }; instance.mounted = false;
    complete({ propertyId, reservationId: operationId, version: 1, detailsRevision: 1, status: "confirmed" });
    const result = await saving; await callbacks.onSuccess(result, variables); callbacks.onSettled();
    expect(readReservationRecovery()).toMatchObject({ kind: "record", record: { state: "primary-confirmed", followOnNeeded: true } });
    expect(onSavePendingChange.mock.calls).toEqual([[true], [false]]); expect(onCreated).not.toHaveBeenCalled(); expect(state.request).toHaveBeenCalledTimes(1);
  });
});
