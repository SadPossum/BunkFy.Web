import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomInventory } from "../src/api/types";
import { buildSpacesRooms, buildSpacesUnits } from "../src/features/spaces/spacesLayout";
import { buildSpacesAvailability, type SpacesAvailabilityRow } from "../src/features/spaces/spacesAvailability";
import type { SpacesBlockGroup } from "../src/features/spaces/spacesBlocks";
import { spacesBlockSuccessParams, spacesHasCurrentAllocation, spacesOverviewUnits, spacesRelevantHolds, spacesRoomSummary, spacesUnitAvailability } from "../src/features/spaces/spacesWorkspace";
import { SpacesRoomWorkspace } from "../src/features/spaces/SpacesRoomWorkspace";
import { buildBlockTargetOptions } from "../src/features/inventory/inventoryBlocking";

// Only the local state/reveal cases use hook and DOM doubles. The existing
// server-rendered composition cases still execute React's real hooks.
const local = vi.hoisted(() => ({ active: false, cursor: 0, slots: [] as unknown[], effects: [] as (() => void | (() => void))[], cleanup: [] as (() => void)[] }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => { if (!local.active) return actual.useState(initial); const i = local.cursor++; if (!(i in local.slots)) local.slots[i] = typeof initial === "function" ? initial() : initial; return [local.slots[i], (next: unknown) => { local.slots[i] = typeof next === "function" ? next(local.slots[i]) : next; }]; },
    useRef: (initial: unknown) => { if (!local.active) return actual.useRef(initial); const i = local.cursor++; return local.slots[i] ?? (local.slots[i] = { current: initial }); },
    useEffect: (...args: Parameters<typeof actual.useEffect>) => { if (!local.active) actual.useEffect(...args); },
    useLayoutEffect: (...args: Parameters<typeof actual.useLayoutEffect>) => { if (local.active) local.effects.push(args[0]); else actual.useLayoutEffect(...args); },
  };
});
afterEach(() => { local.cleanup.forEach(cleanup => cleanup()); local.cleanup = []; local.active = false; vi.unstubAllGlobals(); });

const range = { arrival: "2026-09-06", departure: "2026-09-08" };
const inventory: RoomInventory = { propertyId: "p", roomId: "r", roomName: "Dorm 104", buildingLabel: "Demo House", floorLabel: "1", salesMode: "bedLevel", version: 1,
  units: [
    { inventoryUnitId: "whole", propertyId: "p", roomId: "r", bedId: null, kind: "room", label: "Dorm 104", isSellable: false, isTopologyActive: true },
    ...["104-A", "104-B", "104-C", "104-D", "104-E", "104-F"].map((label, index) => ({ inventoryUnitId: `u${index}`, propertyId: "p", roomId: "r", bedId: `b${index}`, kind: "bed" as const, label, isSellable: true, isTopologyActive: true })),
  ] };
const room = buildSpacesRooms({ propertyId: "p", inventoryRooms: [inventory], physicalEvidence: "current", inventoryEvidence: "current" }).rooms[0];
const units = spacesOverviewUnits(room);
const row: SpacesAvailabilityRow = { inventoryUnitId: "u2", roomId: "r", bedId: "b2", roomLabel: "Dorm 104", roomDetail: "Demo House", unitLabel: "104-C", unitKind: "bed", targetResolved: true, state: "blocked", lastReportedState: "blocked", activeBlockCount: 1, activeAllocationCount: 0 };
const group: SpacesBlockGroup = { blockGroupId: "g", label: "104-C", detail: "Dorm 104 · bed", targetResolved: true, targetEvidence: "resolved", inventoryUnitIds: ["u2"], intervals: [range], reasons: ["Deep clean"], status: "active", blockCount: 1 };
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("Spaces local expansion and selected reveal (not browser geometry)", () => {
  type Node = ReactElement<Record<string, unknown> & { children?: unknown }>;
  const nodes = (value: unknown): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === "object" && "props" in value ? [value as Node, ...nodes((value as Node).props.children)] : [];
  const properties = (): ComponentProps<typeof SpacesRoomWorkspace> => ({ rooms: [room, { ...room, roomId: "r2", name: "Dorm 105", inventoryUnits: [] }, { ...room, roomId: "r3", name: "Dorm 106", inventoryUnits: [] }],
    selectedRoom: room, selectedUnit: units[2], selectedUnits: units, physicalBedCount: 6, availability: { rows: [row], total: 1, reportedAvailable: 0, reportedUnavailable: 1, unresolvedTargets: 0, contextMismatch: false },
    inventoryCurrent: true, mayReadInventory: true, range, timeZoneId: "Europe/London", locked: false, onRangeChange: vi.fn(), onSelectRoom: vi.fn(), onSelectUnit: vi.fn(), inspector: null, sourceNotice: null, filter: "", onFilterChange: vi.fn() });
  function start() { local.active = true; local.cursor = 0; local.slots = []; local.effects = []; local.cleanup = []; }
  function render(props: ComponentProps<typeof SpacesRoomWorkspace>) { local.cursor = 0; local.effects = []; return nodes(SpacesRoomWorkspace(props)); }
  const children = (tree: Node[], id: string) => tree.find(node => node.props.id === "spaces-room-children-" + id)!;
  it("keeps several rooms expanded independently and preserves the selected room through search", () => {
    start(); const props = properties(); let tree = render(props);
    expect(children(tree, "r").props.hidden).toBe(false); expect(children(tree, "r2").props.hidden).toBe(true);
    (tree.find(node => node.props["aria-label"] === "Show spaces in Dorm 105")!.props.onClick as () => void)();
    tree = render(props); (tree.find(node => node.props["aria-label"] === "Show spaces in Dorm 106")!.props.onClick as () => void)();
    tree = render(props); expect(children(tree, "r2").props.hidden).toBe(false); expect(children(tree, "r3").props.hidden).toBe(false);
    tree = render({ ...props, filter: "Dorm" }); expect(children(tree, "r").props.hidden).toBe(false);
    tree = render(props); expect(children(tree, "r2").props.hidden).toBe(false); expect(props.onSelectRoom).not.toHaveBeenCalled();
  });
  it("shows search results in the narrow navigator without changing the retained selection", () => {
    start(); const props = properties(); let tree = render(props);
    (tree.find(node => node.props.type === "search")!.props.onChange as (event: unknown) => void)({ target: { value: "105" } });
    tree = render({ ...props, filter: "105" }); expect(tree.find(node => node.props["data-spaces-view"])!.props["data-spaces-view"]).toBe("navigator");
    expect(props.onFilterChange).toHaveBeenCalledWith("105"); expect(props.onSelectRoom).not.toHaveBeenCalled(); expect(props.onSelectUnit).not.toHaveBeenCalled();
    expect(tree.some(node => node.props["data-space-selection"] === units[2].key)).toBe(true);
  });
  it("reveals a late exact target once in the local pane without focus or refetch recenter", () => {
    start(); const props = properties(); let available = false, mode = "wide";
    const target = { dataset: { spaceSelection: units[2].key }, getClientRects: () => available ? [{}] : [], getBoundingClientRect: () => ({ top: 650, bottom: 694 }), focus: vi.fn() };
    const navigator = { scrollTop: 0, querySelectorAll: () => [target], querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 140 }) }), getBoundingClientRect: () => ({ top: 100, bottom: 600 }) };
    const listeners = new Set<() => void>();
    const resize = () => listeners.forEach(fn => fn());
    vi.stubGlobal("window", { addEventListener: (_event: string, fn: () => void) => listeners.add(fn), removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn) });
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => mode }));
    const tree = render(props);
    (tree.find(node => node.props["aria-label"] === "Rooms and beds comparison")!.props.ref as { current: unknown }).current = { closest: () => null };
    (tree.find(node => node.props["aria-label"] === "Rooms and beds navigator")!.props.ref as { current: unknown }).current = navigator;
    for (const effect of local.effects) { const cleanup = effect(); if (cleanup) local.cleanup.push(cleanup); }
    expect(navigator.scrollTop).toBe(0); available = true; resize(); expect(navigator.scrollTop).toBe(102);
    navigator.scrollTop = 40; resize(); expect(navigator.scrollTop).toBe(40); expect(target.focus).not.toHaveBeenCalled();
    mode = "narrow"; resize(); expect(navigator.scrollTop).toBe(40);
  });
  function resizeEditor() {
    start(); const props = properties(); const listeners = new Set<() => void>(), frames = new Map<number, () => void>(); let next = 0;
    const state = { top: 820, bottom: 860, overflowY: "visible", clipTop: 180, clipBottom: 600, footer: true, connected: true, hidden: false, inert: false, disabled: false, editorCurrent: true, visibility: "visible" };
    const editor = { isConnected: true, getClientRects: () => [{}], matches: () => false, closest: () => null };
    const node = { isConnected: true, getClientRects: () => state.hidden ? [] : [{}], matches: () => state.disabled,
      closest: (selector: string) => selector === "[data-topology-editor]" ? state.editorCurrent ? editor : null : state.inert ? {} : null,
      getBoundingClientRect: () => ({ top: state.top, bottom: state.bottom }), focus: vi.fn(), scrollIntoView: vi.fn(() => { state.top = 300; state.bottom = 340; }) };
    const pane = { contains: (target: unknown) => state.editorCurrent && target === editor, getBoundingClientRect: () => ({ top: state.clipTop, bottom: state.clipBottom }) };
    const doc = { activeElement: node as unknown, querySelector: (selector: string) => selector === ".app-topbar"
      ? { getClientRects: () => [{}], getBoundingClientRect: () => ({ bottom: 64 }) }
      : { getClientRects: () => state.footer ? [{}] : [], getBoundingClientRect: () => ({ top: 736 }) } };
    const cancel = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal("window", { innerHeight: 800, addEventListener: (_event: string, fn: () => void) => listeners.add(fn), removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn) });
    vi.stubGlobal("document", doc); vi.stubGlobal("requestAnimationFrame", (fn: () => void) => { frames.set(++next, fn); return next; }); vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.stubGlobal("getComputedStyle", (target: unknown) => ({ visibility: target === node ? state.visibility : "visible", overflowY: state.overflowY }));
    function mount(nextProps = props) {
      const tree = render(nextProps);
      (tree.find(n => n.props.id === "spaces-selection-inspector")!.props.ref as { current: unknown }).current = pane;
      for (const effect of local.effects) { const cleanup = effect(); if (cleanup) local.cleanup.push(cleanup); }
    }
    const cleanup = () => { local.cleanup.forEach(fn => fn()); local.cleanup = []; };
    const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
    mount();
    return { state, node, doc, props, pane, editor, frames, listeners, cancel, cleanup, mount, flush,
      resize: () => { node.isConnected = state.connected; listeners.forEach(fn => fn()); } };
  }
  it("reveals the same focused editor after wide-to-narrow resize only once, without focus or refetch scrolling", () => {
    const h = resizeEditor(); expect(h.frames.size).toBe(0); expect(h.node.scrollIntoView).not.toHaveBeenCalled();
    h.resize(); expect(h.frames.size).toBe(1); h.flush();
    expect(h.node.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "nearest", inline: "nearest", behavior: "instant" });
    expect(h.doc.activeElement).toBe(h.node); expect(h.node.focus).not.toHaveBeenCalled();
    h.resize(); h.flush(); expect(h.node.scrollIntoView).toHaveBeenCalledTimes(1);
    h.cleanup(); h.state.top = 820; h.state.bottom = 860; h.mount({ ...h.props, inventoryCurrent: false }); h.flush();
    expect(h.node.scrollIntoView).toHaveBeenCalledTimes(1);
  });
  it.each(["bottom", "top"])("uses the current wide inspector %s clip rather than the absent mobile footer", edge => {
    const h = resizeEditor(); h.state.overflowY = "auto"; h.state.footer = false;
    h.state.top = edge === "bottom" ? 620 : 140; h.state.bottom = h.state.top + 40;
    h.resize(); h.flush(); expect(h.node.scrollIntoView).toHaveBeenCalledTimes(1); expect(h.node.focus).not.toHaveBeenCalled();
  });
  it.each(["visible", "outside", "hidden", "inert", "disabled", "detached", "editor-replaced", "visibility-hidden"])("does not scroll for %s controls or changed ownership", condition => {
    const h = resizeEditor(); h.resize();
    if (condition === "visible") { h.state.top = 300; h.state.bottom = 340; }
    if (condition === "outside") h.doc.activeElement = {};
    if (condition === "hidden") h.state.hidden = true;
    if (condition === "inert") h.state.inert = true;
    if (condition === "disabled") h.state.disabled = true;
    if (condition === "detached") h.node.isConnected = false;
    if (condition === "editor-replaced") h.state.editorCurrent = false;
    if (condition === "visibility-hidden") h.state.visibility = "hidden";
    h.flush(); expect(h.node.scrollIntoView).not.toHaveBeenCalled(); expect(h.node.focus).not.toHaveBeenCalled();
  });
  it("ignores unrelated active controls and coalesces newer resize frames", () => {
    const h = resizeEditor(); h.doc.activeElement = null; h.resize(); expect(h.frames.size).toBe(0);
    h.doc.activeElement = h.node; h.state.editorCurrent = false; h.resize(); expect(h.frames.size).toBe(0);
    h.state.editorCurrent = true; h.resize(); const stale = [...h.frames.values()][0]; h.resize(); expect(h.cancel).toHaveBeenCalled(); expect(h.frames.size).toBe(1);
    h.flush(); expect(h.node.scrollIntoView).toHaveBeenCalledTimes(1);
    h.cleanup(); h.state.top = 820; h.state.bottom = 860; stale(); expect(h.node.scrollIntoView).toHaveBeenCalledTimes(1);
  });
  it.each(["selection", "hide", "editor-close", "identity-unmount"])("cancels queued work on %s and never restores its old node", change => {
    const h = resizeEditor(); h.resize(); const stale = [...h.frames.values()][0]; h.cleanup(); expect(h.frames.size).toBe(0);
    if (change === "selection") h.mount({ ...h.props, selectionKey: "another" });
    if (change === "hide") h.mount({ ...h.props, visible: false });
    if (change === "editor-close") { h.state.editorCurrent = false; h.mount({ ...h.props, inspector: createElement("p", null, "Saved") }); }
    stale(); expect(h.node.scrollIntoView).not.toHaveBeenCalled(); expect(h.node.focus).not.toHaveBeenCalled();
    if (change === "hide") { h.resize(); expect(h.frames.size).toBe(0); }
    if (change === "identity-unmount") expect(h.listeners.size).toBe(0);
  });
});

describe("unified Rooms & beds composition (not rendered browser evidence)", () => {
  it("distinguishes inventory-derived bed spaces from the selected physical-bed count", () => {
    expect(spacesRoomSummary(room)).toBe("6 bed spaces · sold by bed");
    expect(spacesRoomSummary(room, 6)).toBe("6 beds · sold by bed");
    expect(spacesRoomSummary(room, 5)).toBe("5 beds · Selling setup unconfirmed");
    expect(spacesRoomSummary(room, 6, false)).toBe("6 beds · Selling setup unconfirmed");
    expect(spacesRoomSummary({ ...room, inventoryState: "unknown" })).toBe("Selling setup unconfirmed");
  });
  it("moves the unsellable whole-room option without deleting its stable identity", () => {
    expect(units.map((unit) => unit.inventoryUnitId)).toEqual(["u0", "u1", "u2", "u3", "u4", "u5"]);
    expect(room.inventoryUnits.find((unit) => unit.inventoryUnitId === "whole")).toMatchObject({ isSellable: false, bedId: null });
    const selected = buildSpacesUnits({ propertyId: "p", room, physicalEvidence: "current", inventoryEvidence: "current", physicalBeds: [] });
    expect(selected.units.find((unit) => unit.inventoryUnitId === "whole")).toBeDefined();
    const page = source("features/spaces/SpacesPage.tsx");
    expect(page).toContain('units.filter((unit) => unit.kind === "room")');
    expect(page).toContain("Whole room not offered separately");
    expect(page).toContain("Inspect whole-room option");
    expect(page).toContain('onClick={() => onSelectUnit(unit)}>Inspect whole-room option</button>');
  });
  it("keeps sellable whole-room, retired and unsellable bed rows operationally reachable", () => {
    const changed = { ...room, inventoryUnits: room.inventoryUnits.map((unit) => ({ ...unit, isSellable: unit.inventoryUnitId !== "u0", isTopologyActive: unit.inventoryUnitId !== "u1" })) };
    const visible = spacesOverviewUnits(changed);
    expect(visible).toHaveLength(7);
    expect(spacesUnitAvailability(visible.find((unit) => unit.inventoryUnitId === "u0")!, [], true).label).toBe("Not offered for sale");
    expect(spacesUnitAvailability(visible.find((unit) => unit.inventoryUnitId === "u1")!, [], true).label).toBe("Retired / inactive");
  });
  it.each(["available", "blocked", "occupied", "unavailable"] as const)("never re-asserts cached %s after availability failure", (state) => {
    expect(spacesUnitAvailability(units[2], [{ ...row, state: "unconfirmed", lastReportedState: state }], true).label).toBe("Unconfirmed");
    expect(spacesUnitAvailability(units[2], [{ ...row, state }], false).label).toBe("Unconfirmed");
  });
  it("keeps no-cache, identity mismatch and unresolved evidence unknown", () => {
    expect(spacesUnitAvailability(units[2], [], true).label).toBe("Unknown");
    for (const changed of [{ ...row, roomId: "other" }, { ...row, bedId: "other" }, { ...row, targetResolved: false }]) {
      expect(spacesUnitAvailability(units[2], [changed], true).label).toBe("Unknown");
    }
  });
  it("does not infer guests, reservation identity or check-in status from allocations", () => {
    expect(spacesUnitAvailability(units[2], [{ ...row, state: "occupied", activeBlockCount: 0, activeAllocationCount: 1 }], true).label).toBe("Reserved / occupied");
    expect(spacesUnitAvailability(units[2], [{ ...row, state: "available", activeBlockCount: 0 }], true).label).toBe("Available");
  });
  it("never turns cached, mismatched or unauthorized allocation counts into a current occupancy claim", () => {
    const held = { ...row, state: "occupied" as const, activeAllocationCount: 1 };
    expect(spacesHasCurrentAllocation(units[2], [held], true)).toBe(true);
    expect(spacesHasCurrentAllocation(units[2], [{ ...held, state: "unconfirmed" }], true)).toBe(false);
    expect(spacesHasCurrentAllocation(units[2], [held], false)).toBe(false);
    expect(spacesHasCurrentAllocation(units[2], [], true)).toBe(false);
    for (const changed of [{ ...held, roomId: "other" }, { ...held, bedId: "other" }, { ...held, targetResolved: false }]) {
      expect(spacesHasCurrentAllocation(units[2], [changed], true)).toBe(false);
    }
    expect(source("features/spaces/SpacesPage.tsx")).toContain("spacesHasCurrentAllocation(selectedUnit, availabilityModel.rows, inventoryCurrent)");
  });
  it("does not imply a whole-room product has zero sleeping capacity when there are no separate physical-bed records", () => {
    expect(spacesRoomSummary({ ...room, salesMode: "roomLevel", inventoryUnits: [inventory.units[0]] }, 0)).toBe("sold as a room");
  });
  it.each(["property", "arrival", "departure", "unit-property"])("rejects %s drift before availability can paint", (change) => {
    const response = { propertyId: "p", ...range, units: [{ unit: inventory.units[3], isAvailable: true, activeBlockIds: [], activeAllocationIds: [] }] };
    if (change === "property") response.propertyId = "other";
    if (change === "arrival") response.arrival = "2026-09-05";
    if (change === "departure") response.departure = "2026-09-09";
    if (change === "unit-property") response.units[0].unit = { ...response.units[0].unit, propertyId: "other" };
    expect(buildSpacesAvailability([inventory], response, "current", { propertyId: "p", ...range })).toMatchObject({ rows: [], contextMismatch: true });
  });
  it("correlates holds by exact unit and half-open overlap, not names or released history", () => {
    const released = { ...group, blockGroupId: "released", status: "released" as const };
    const departed = { ...group, blockGroupId: "past", intervals: [{ arrival: "2026-09-04", departure: range.arrival }] };
    expect(spacesRelevantHolds([group, released, departed], ["u2"], range)).toEqual([group]);
    expect(spacesRelevantHolds([group], ["u3"], range)).toEqual([]);
    expect(spacesRelevantHolds([released], ["u2"], range, "released")).toEqual([released]);
    expect(spacesRelevantHolds([released], ["wrong"], range, "released")).toEqual([]);
  });
  it("keeps the six source/authority gates and cancellation ahead of reads and actions", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    expect(page).toContain("&& permissionCurrent\n    && mayReadProperties");
    expect(page).toContain("mayReadInventory && availabilityOpen && availabilityRangeValid");
    expect(page).toContain("const availabilityCurrent = inventoryCurrent && compositeSourceCurrent(availabilitySource)");
    expect(page).toContain("const blockCurrent = inventoryCurrent && compositeSourceCurrent(blockSource)");
    expect(page).toContain("const blockEvidenceCurrent = blockCurrent && !blockModel.contextMismatch");
    expect(page).toContain("roomInventoryMatchesProperty(inventoryQuery.data.rooms, targetPropertyId)");
    expect(page).toContain("manualBlockListMatchesProperty(blocksQuery.data.blocks, targetPropertyId)");
    expect(page.match(/loadAllBeds\(/g)).toHaveLength(1);
    expect(page.match(/context.signal/g)).toHaveLength(5);
    expect(page).not.toContain("refetchInterval");
    expect(page).not.toContain('role="grid"');
    expect(page).not.toContain("<SegmentedTabs");
  });
  it("keeps the exact creation scope and edited dates after success, with Calendar origin untouched", () => {
    const before = new URLSearchParams("section=layout&property=p&room=r&bed=b2&unit=u2&opReturnFrom=calendar&arrival=2026-09-06&departure=2026-09-08");
    const target = buildBlockTargetOptions("Demo", [inventory]).find((option) => option.id === "unit:u3")!;
    const next = spacesBlockSuccessParams(before, { action: "created", receipt: { propertyId: "p", blockGroupId: "new", affectedBlockCount: 1 }, createdTarget: target, createdRange: { arrival: "2026-09-09", departure: "2026-09-10" } });
    expect(next.get("unit")).toBe("u3"); expect(next.has("bed")).toBe(false); expect(next.has("room")).toBe(false);
    expect(next.get("arrival")).toBe("2026-09-09"); expect(next.get("departure")).toBe("2026-09-10");
    expect(next.get("opReturnFrom")).toBe("calendar"); expect(next.get("blockGroup")).toBe("new"); expect(next.get("history")).toBe("all");
    expect(before.get("unit")).toBe("u2");
  });
  it("loads the exact released receipt without widening selected-space display", () => {
    const before = new URLSearchParams("property=p&room=r&bed=b2&unit=u2&arrival=2026-09-06&departure=2026-09-08");
    const next = spacesBlockSuccessParams(before, { action: "released", receipt: { propertyId: "p", blockGroupId: "g", affectedBlockCount: 1 } });
    for (const key of ["room", "bed", "unit", "arrival", "departure"]) expect(next.get(key)).toBe(before.get(key));
    expect(next.get("history")).toBe("all");
    expect(next.has("section")).toBe(false);
    expect(source("features/spaces/SpacesPage.tsx")).toContain('const visibleGroups = holdsOpen ? blockModel.groups');
    const foreign = { ...group, blockGroupId: "foreign", inventoryUnitIds: ["other"] };
    const released = { ...group, blockGroupId: "released", status: "released" as const };
    expect(spacesRelevantHolds([group, released, foreign], ["u2"], range, null, "all")).toEqual([group, released]);
  });
  it("renders semantic row headers, full labels and exactly one stable inspector", () => {
    const html = renderToStaticMarkup(createElement(SpacesRoomWorkspace, { rooms: [room], selectedRoom: room, selectedUnit: units[2], selectedUnits: units,
      physicalBedCount: 6, availability: { rows: [row], total: 1, reportedAvailable: 0, reportedUnavailable: 1, unresolvedTargets: 0, contextMismatch: false }, inventoryCurrent: true,
      mayReadInventory: false, range, timeZoneId: "Europe/London", locked: false, onRangeChange: () => {}, onSelectRoom: () => {}, onSelectUnit: () => {},
      inspector: createElement("h3", null, "104-C inspector"), sourceNotice: null, filter: "", onFilterChange: () => {} }));
    expect(html).toContain('scope="row"'); expect(html).toContain("104-C"); expect(html).toContain("6 beds · sold by bed");
    expect(html.match(/id="spaces-selection-inspector"/g)).toHaveLength(1);
    expect(html).not.toContain('role="grid"'); expect(html).not.toContain("6/7"); expect(html).not.toContain("Whole room");
  });
  it("seeds only an exact current form option and keeps all original submit authority checks", () => {
    const form = source("features/inventory/BlockInventoryModal.tsx");
    expect(form).toContain("options.find((option) => option.id === initialTargetId) ?? null");
    expect(form).toContain("editor.createCanSubmit(selected) && selectedVisible && rangeValid");
    expect(form).toContain("selectedBlockTargetCurrent(options, selected)");
    const controller = source("features/inventory/useManualBlockEditor.ts");
    expect(controller).toContain('input.selectionKey ?? ""');
    expect(controller).toContain('scopeCurrent(candidate) && authorityCurrent("create-block") && targetCurrent(candidate.selected)');
    expect(controller).toContain('scopeCurrent(candidate) && authorityCurrent("release-block")');
  });
  it("does not allow settings and an operational editor to compete in the same workspace", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    expect(page).toContain("const workspaceLocked = propertyEditorEngaged || Boolean(");
    expect(page).toContain("otherEditorOpen={propertyEditorEngaged || Boolean(blockEditor.editor)}");
    expect(page).toContain("otherEditorOpen={propertyEditorEngaged || Boolean(topologyEditor.target || salesEditor.target || retirementEditor.target)}");
    const property = source("features/spaces/SpacesPropertySection.tsx");
    expect(property).toContain('property.status === "active" && !actionsDisabled');
    expect(property).toContain("actionsDisabled={retirementEngaged || actionsDisabled || editor.busy || Boolean(editor.propertyForm || editor.timeZoneTarget)}");
    const holds = source("features/spaces/SpacesBlocksSection.tsx");
    expect(holds).toContain("const viewLocked = editor.busy || Boolean(editor.editor) || otherEditorOpen");
    expect(holds.match(/disabled: viewLocked/g)).toHaveLength(2);
  });
  it("keeps the one workspace and editor anchor mounted through layout loss and recovery", () => {
    const page = source("features/spaces/SpacesPage.tsx");
    expect(page.match(/<SpacesRoomWorkspace /g)).toHaveLength(1);
    expect(page).toContain("sourceNotice={<>{layoutFeedback}{availabilityNotice}</>}");
    expect(page).not.toContain(": <SpacesRoomWorkspace");
    expect(source("features/spaces/SpacesRoomWorkspace.tsx")).toContain("rooms.length > 0 && !visibleRooms.length");
  });
  it("contains the wide comparison scroll and heading focus locally without changing narrow document flow", () => {
    const css = source("styles.css");
    const wide = css.slice(css.indexOf("@media (width >= 64rem)"), css.indexOf("/* Inline editors"));
    expect(wide).toContain("height: var(--spaces-comparison-height)");
    expect(wide).toContain("overflow-y: auto");
    expect(wide).toContain("top: 0");
    expect(wide).not.toContain("top: 5rem");
    expect(css.slice(0, css.indexOf("@media (width >= 64rem)"))).not.toContain("--spaces-comparison-height");
    const workspace = source("features/spaces/SpacesRoomWorkspace.tsx");
    expect(wide).toContain('@container spaces-frame (width >= 48rem)');
    expect(wide).toContain('grid-template-columns: clamp(16rem, 28%, 20rem) minmax(0, 1fr)');
    expect(wide).toContain('clamp(30rem, calc(100dvh - 18rem), 52rem)');
    expect(wide).toContain('.spaces-room-back { display: none; }');
    expect(workspace).toContain('getPropertyValue("--spaces-comparison-mode")');
    expect(workspace).toContain("heading?.focus({ preventScroll: true })");
    expect(workspace).toContain("trigger.focus({ preventScroll: true })");
    expect(workspace).toContain("comparison.scrollTop += row.top - searchBottom - 8");
    expect(workspace).toContain('trigger.scrollIntoView({ block: "nearest" })');
    expect(workspace).toContain('candidate.dataset.spaceSelection === exactKey');
    expect(workspace).toContain('navigatorStatus.current?.focus({ preventScroll: true })');
    expect(workspace.indexOf('ariaLabel="Arrival date"')).toBeLessThan(workspace.indexOf('ref={workspaceElement}'));
  });
});
