import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodayVisualView } from "../src/features/dashboard/TodayVisualView";
import { TodayOperationsView } from "../src/features/dashboard/TodayOperationsView";
import type { ReservationListItem, ReservationOperationsSnapshot, RoomInventory } from "../src/api/types";
import type { OperationalPreviewRoute } from "../src/features/operational-preview/operationalPreviewRoute";
import { reservationMatchesSelection } from "../src/features/operational-preview/operationalPreviewModel";

const state = vi.hoisted(() => ({ direct: false, cursor: 0, values: [] as unknown[], params: new URLSearchParams(), route: null as OperationalPreviewRoute | null, open: vi.fn(), setParams: vi.fn() }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual, useMemo: (fn: () => unknown, deps: unknown[]) => state.direct ? fn() : actual.useMemo(fn, deps), useState: (initial: unknown) => {
    if (!state.direct) return actual.useState(initial);
    const index = state.cursor++; if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  } };
});
vi.mock("react-router", async load => ({ ...await load<typeof import("react-router")>(), useSearchParams: () => [state.params, state.setParams] }));
vi.mock("../src/features/operational-preview/OperationalPreviewProvider", () => ({ useOperationalPreview: () => ({ activeRoute: state.route, openPreview: state.open }) }));
const propertyId = "11111111-1111-4111-8111-111111111111", roomId = "22222222-2222-4222-8222-222222222222", unitId = "33333333-3333-4333-8333-333333333333", date = "2026-09-08";
const room: RoomInventory = { propertyId, roomId, roomName: "101", buildingLabel: "Main", floorLabel: "1", salesMode: "bedLevel", version: 1, units: [{ propertyId, roomId, inventoryUnitId: unitId, bedId: roomId, kind: "bed", label: "A", isSellable: true, isTopologyActive: true }] };
const stay = (id = "44444444-4444-4444-8444-444444444444", changes: Partial<ReservationListItem> = {}): ReservationListItem => ({ propertyId, reservationId: id, arrival: "2026-09-05", departure: date, expectedArrivalTime: null, expectedDepartureTime: null, primaryGuestName: "Élodie QA", guestCount: 1, inventoryUnitCount: 1, inventoryUnitIds: [unitId], holdsInventory: true, sourceKind: "direct", status: "checkedIn", ...changes });
const base: ComponentProps<typeof TodayVisualView> = { propertyId, propertyName: "QA property", rooms: [room], roomState: "ready", availability: { propertyId, arrival: date, departure: "2026-09-09", units: [{ unit: room.units[0]!, isAvailable: true, activeAllocationIds: [], activeBlockIds: [] }] }, availabilityState: "ready", reservations: [stay()], reservationState: "ready", blocks: [], blockState: "ready", localDate: date, current: true, reservationCurrent: true, canOpenSpaces: true };
type Node = ReactElement<Record<string, unknown> & { children?: unknown }>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object") return []; const node = value as Node; return [node, ...nodes(node.props?.children)]; }
function render(changes: Partial<typeof base> = {}) {
  state.direct = true; state.cursor = 0; const tree = TodayVisualView({ ...base, ...changes }); state.direct = false;
  return { nodes: nodes(tree), html: renderToStaticMarkup(createElement(MemoryRouter, null, tree)) };
}
beforeEach(() => { state.direct = false; state.values = []; state.params = new URLSearchParams({ property: propertyId, view: "visual" }); state.route = null; state.open.mockReset(); state.setParams.mockImplementation((params: URLSearchParams) => { state.params = params; }); });

describe("Today Rooms presentation and local event state (not browser geometry proof)", () => {
  it.each(["visual", "operations"] as const)("opens overdue and upcoming %s records without a Calendar date constraint", view => {
    for (const changes of [
      { arrival: "2026-09-01", departure: "2026-09-03", status: "checkedIn" },
      { arrival: "2026-09-01", departure: "2026-09-03", status: "confirmed" },
      { arrival: "2026-09-12", departure: "2026-09-15", status: "confirmed" },
    ] satisfies Partial<ReservationListItem>[]) {
      const item = stay(undefined, changes);
      let tree: Node[];
      if (view === "visual") {
        const rendered = render({ reservations: [item] });
        // Rooms shows today's work; future arrivals are offered by Operations.
        if (item.arrival > date) { expect(rendered.html).not.toContain(item.primaryGuestName); continue; }
        tree = rendered.nodes;
      }
      else {
        const count = { reservationCount: 0, guestCount: 0, inventoryUnitCount: 0 };
        const snapshot = { propertyId, localDate: date, timeZoneId: "UTC", cohorts: { confirmedArrivalsOnLocalDate: count, scheduledDeparturesOnLocalDate: count, currentlyInHouse: count }, attention: { total: count }, upcoming: [item] } as unknown as ReservationOperationsSnapshot;
        tree = nodes(TodayOperationsView({ propertyId, canOpenSpaces: true, snapshot, snapshotState: "ready", inventory: [room], inventoryState: "ready", blocks: [], blockState: "ready", reservations: [item], reservationState: "ready" }));
      }
      state.open.mockClear();
      if (view === "visual") {
        const button = tree.find(node => node.type === "button" && String(node.props["data-operational-preview-trigger"]).includes(":reservation:"))!;
        expect(button).toBeDefined(); (button.props.onClick as (event: unknown) => void)({ currentTarget: {} });
      } else {
        const row = tree.find(node => node.props.onOpen && (node.props.reservation === item || (node.props.items as ReservationListItem[] | undefined)?.includes(item)))!;
        expect(row).toBeDefined(); (row.props.onOpen as (record: ReservationListItem, event: unknown) => void)(item, { currentTarget: {} });
      }
      const selected = state.open.mock.calls[0]![0].route as OperationalPreviewRoute;
      expect(selected.selection).toMatchObject({ propertyId, reservationId: item.reservationId, inventoryUnitId: unitId, roomId });
      expect(selected.selection.date).toBeUndefined();
      expect(selected.origin).toEqual({ surface: "today", propertyId, view });
      if (selected.selection.kind !== "reservation") throw new Error("Wrong selection kind");
      expect(reservationMatchesSelection(item, selected.selection)).toBe(true);
      expect(reservationMatchesSelection({ ...item, propertyId: roomId }, selected.selection)).toBe(false);
      expect(reservationMatchesSelection({ ...item, inventoryUnitIds: [] }, selected.selection)).toBe(false);
      expect(reservationMatchesSelection(item, { ...selected.selection, date })).toBe(false);
    }
  });
  it("shows grouped identity, guest lifecycle and independent Tonight truth with existing preview keys", () => {
    const { html } = render();
    expect(html).toContain("Today Rooms"); expect(html).toContain("Élodie QA"); expect(html).toContain("Departure today"); expect(html).toContain("Available tonight");
    expect(html).toContain("Main · 1"); expect(html).toContain("today:visual:reservation:"); expect(html).toContain("today:visual:inventoryUnit:");
    expect(html).not.toContain('role="grid"'); expect(html).not.toContain("Occupied"); expect(html).toContain("min-h-[44px]"); expect(html).toContain("text-[13px]");
  });
  it.each([{}, { availabilityState: "stale" as const }, { roomState: "stale" as const }, { reservationState: "stale" as const }])("retains cached label and control identity while genuinely unconfirmed, qualified as Last known: %j", changes => {
    const before = render().nodes.filter(node => node.props["data-operational-preview-trigger"]).map(node => node.props["data-operational-preview-trigger"]);
    const after = render({ ...changes, current: false, reservationCurrent: false });
    expect(after.html).toContain("Available tonight"); expect(after.html).toContain("Last known availability");
    expect(after.nodes.filter(node => node.props["data-operational-preview-trigger"]).map(node => node.props["data-operational-preview-trigger"])).toEqual(before);
  });
  it.each(["Availability", "Reservations", "Summary", "2 sources"])("changes only the stable status contents for routine %s refresh, including empty rows", source => {
    const withoutStatus = (html: string) => html.replace(/(<p id="today-source-status"[^>]*>)[\s\S]*?(<\/p>)/, "$1$2");
    for (const reservations of [base.reservations, []]) {
      const before = render({ reservations });
      const after = render({ reservations, current: false, reservationCurrent: false, routineRefresh: true, sourceStatus: `${source}: updating` });
      expect(withoutStatus(after.html)).toBe(withoutStatus(before.html));
      expect(after.html).not.toContain("Last known ·"); expect(after.html).not.toContain("Current coverage is unconfirmed");
      expect(after.html).toContain(`${source}: updating`);
      const status = after.nodes.find(node => node.props.id === "today-source-status")!;
      expect(status.props.className).toContain("min-h-[20px]");
      expect(after.nodes.filter(node => node.props["data-operational-preview-trigger"]).every(node => node.props["aria-describedby"] === "today-source-status")).toBe(true);
    }
  });
  it("retains real failure/conflict/unknown warnings even if a routine flag is incorrectly present", () => {
    for (const change of [{ roomState: "unavailable" as const, rooms: [] }, { reservationState: "stale" as const }, { conflictCount: 1 }]) {
      const html = render({ ...change, current: false, routineRefresh: true }).html;
      expect(html).toContain("coverage is unconfirmed"); expect(html).toContain("Coverage incomplete");
    }
  });
  it("keeps Clear with result/manage actions, one ordered wide label group and accessible date/movement context", () => {
    const { nodes: tree, html } = render();
    const actions = tree.find(node => "data-today-result-actions" in node.props)!;
    expect(nodes(actions).some(node => node.type === "button" && node.props.children === "Clear")).toBe(true);
    expect(nodes(actions).some(node => String(node.props.to).startsWith("/spaces"))).toBe(true);
    expect(tree.filter(node => "data-today-room-columns" in node.props)).toHaveLength(1);
    const columns = tree.find(node => "data-today-room-columns" in node.props)!;
    expect(nodes(columns).filter(node => node.type === "span").map(node => renderToStaticMarkup(node))).toEqual([
      "<span>Space</span>", expect.stringContaining("Tonight · "), "<span>Guest movements</span>",
    ]);
    expect(tree.some(node => node.type === "p" && node.props.className === "sr-only" && node.props.children === "Guest movements")).toBe(true);
    expect(html).toContain("Tonight · "); expect(html).toContain("2026");
    const previewKinds = tree.filter(node => node.props["data-operational-preview-trigger"]).map(node => node.props["data-operational-preview-trigger"]);
    expect(previewKinds[0]).toContain(":inventoryUnit:"); expect(previewKinds[1]).toContain(":reservation:");
    expect(tree.find(node => node.type === "input")!.props.className).toContain("min-h-[44px]");
    expect(html).toContain("text-[14px]"); expect(html).toContain("Tonight’s availability is not presence or cleanliness");
  });
  it("keeps one labelled secondary filter set and explicit focus-latched disclosure without changing structural context", () => {
    const first = render(), disclosure = first.nodes.find(node => node.type === "button" && node.props["aria-controls"] !== "operational-preview" && "aria-expanded" in node.props)!;
    expect(disclosure.props["aria-expanded"]).toBe(false);
    const controls = first.nodes.find(node => node.props.id === disclosure.props["aria-controls"])!;
    expect(nodes(controls).filter(node => node.type === "select")).toHaveLength(2);
    (controls.props.onFocusCapture as () => void)();
    const focused = render().nodes.find(node => node.props["aria-controls"] === controls.props.id)!;
    expect(focused.props["aria-expanded"]).toBe(true);
    const focus = vi.fn(); (focused.props.onClick as (event: unknown) => void)({ currentTarget: { focus } });
    expect(focus).toHaveBeenCalledOnce(); expect(render().nodes.find(node => node.props["aria-controls"] === controls.props.id)!.props["aria-expanded"]).toBe(false);
    expect(state.setParams).not.toHaveBeenCalled();
  });
  it.each(["loading", "unavailable"] as const)("never turns missing rooms into zero or available data: %s", roomState => {
    const html = render({ rooms: [], roomState, current: false }).html;
    expect(html).not.toContain("0 spaces shown"); expect(html).not.toContain("No rooms configured"); expect(html).toContain("unconfirmed");
  });
  it("hides unusable availability and conflict gaps instead of claiming Free", () => {
    for (const changes of [{ availability: undefined, availabilityState: "unavailable" as const }, { conflictCount: 1, reservations: [] }]) {
      const html = render({ ...changes, current: false }).html;
      expect(html).toContain("Tonight unconfirmed"); expect(html).not.toContain('>Available tonight</span>');
    }
  });
  it("keeps guest search ephemeral across preview open/close and propagates only room/filter structural context", () => {
    state.params.set("todayRoom", roomId); state.params.set("todayFilter", "movements");
    const input = render().nodes.find(node => node.type === "input")!;
    (input.props.onChange as (event: unknown) => void)({ target: { value: "elodie" } });
    const first = render(); expect(first.html).toContain('value="elodie"');
    const button = first.nodes.find(node => String(node.props["data-operational-preview-trigger"]).includes(":reservation:"))!;
    (button.props.onClick as (event: unknown) => void)({ currentTarget: {} });
    state.route = state.open.mock.calls[0]![0].route;
    expect(state.route!.origin).toMatchObject({ rooms: { roomId, filter: "movements" } });
    expect(JSON.stringify(state.route)).not.toContain("elodie"); expect(state.params.toString()).not.toContain("elodie");
    expect(render().html).toContain('value="elodie"'); state.route = null; expect(render().html).toContain('value="elodie"');
    expect(first.html).toContain("surfaceReturnTodayRoom"); expect(first.html).toContain("surfaceReturnTodayFilter");
    state.values = []; expect(render().html).not.toContain('value="elodie"'); // New owner after leaving Today.
  });
  it("filters unassigned records by actual attention and describes partial assignments honestly", () => {
    state.params.set("todayFilter", "attention");
    const normal = stay("normal", { arrival: date, departure: "2026-09-10", status: "confirmed", inventoryUnitIds: ["missing"], primaryGuestName: "Not attention" });
    const pending = stay("pending", { status: "pendingAllocation", holdsInventory: false, primaryGuestName: "Needs review" });
    const html = render({ reservations: [normal, pending] }).html;
    expect(html).toContain("Needs review"); expect(html).not.toContain("Not attention"); expect(html).toContain("Requested, not held");
    expect(html).toContain("Some requested rooms or beds could not be confirmed here");
  });
  it("rejects foreign/invalid structural room filters rather than silently showing a different property", () => {
    state.params.set("todayRoom", propertyId); expect(render().html).toContain("This room or filter is not available");
    state.params.set("todayFilter", "guest-secret"); expect(render().html).not.toContain("Élodie QA");
  });
  it("qualifies Operations denominator drift and empty unavailable sections", () => {
    const count = { reservationCount: 0, guestCount: 0, inventoryUnitCount: 0 };
    const snapshot = { propertyId, localDate: date, timeZoneId: "UTC", cohorts: { confirmedArrivalsOnLocalDate: count, scheduledDeparturesOnLocalDate: count, currentlyInHouse: count }, attention: { total: { ...count, reservationCount: 17 } }, upcoming: [] } as unknown as ReservationOperationsSnapshot;
    const props: ComponentProps<typeof TodayOperationsView> = { propertyId, canOpenSpaces: false, snapshot, snapshotState: "ready", inventory: [room], inventoryState: "ready", blocks: [], blockState: "ready", reservations: [], reservationState: "ready" };
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TodayOperationsView, props)));
    expect(html).toContain("were read separately and currently differ");
    const unknown = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TodayOperationsView, { ...props, reservationCurrent: false, snapshotCurrent: false })));
    expect(unknown).not.toContain("No decisions waiting"); expect(unknown).not.toContain("No later arrivals queued"); expect(unknown).toContain("Current records are unconfirmed");
    const refreshed = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TodayOperationsView, { ...props, routineRefresh: true, reservationCurrent: false, snapshotCurrent: false, sourceStatus: "Reservations: updating" })));
    const withoutStatus = (value: string) => value.replace(/(<p id="today-source-status"[^>]*>)[\s\S]*?(<\/p>)/, "$1$2");
    expect(withoutStatus(refreshed)).toBe(withoutStatus(html));
    expect(refreshed).toContain("were read separately and currently differ");
  });
});
