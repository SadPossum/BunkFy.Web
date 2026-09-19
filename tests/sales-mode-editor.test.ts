import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { RoomInventory, RoomInventoryChangeImpact } from "../src/api/types";
import { activeSalesBeds, canonicalSalesMode, salesAttemptCurrent, salesBlockerSummary, salesChangeAllowed, salesImpactMatches, salesKnownRejection, salesReceiptMatches, salesRoomCurrent, salesRoomEditable, type SalesModeEvidence } from "../src/features/inventory/salesModeEditorModel";
import { resolveSalesModeMutationAttempt } from "../src/features/inventory/salesModeMutationAttempt";
import { affectedSalesReservationsUrl, inventorySalesSetupUrl } from "../src/features/inventory/salesModeRoutes";
import { parseSpacesReturnRoute, spacesReturnHref, withSpacesReturnRoute } from "../src/features/spaces/spacesReturnRoute";
import { withOperationalSurfaceReturn } from "../src/features/operational-preview/operationalSurfaceReturn";
import { SalesModeChangeModal } from "../src/features/inventory/SalesModeChangeModal";
import type { SalesModeEditor } from "../src/features/inventory/useSalesModeEditor";

vi.mock("../src/app/session", () => ({ useSession: () => ({ stepUpWithPassword: async () => {} }) }));

const propertyId = "693a6fc9-71e0-4987-b27c-790eaf4f3cef", roomId = "234f6d3f-59ad-456f-8eee-50bd4a640e07", bedId = "f069d803-3816-463b-acf8-b5b6d5800433";
const room: RoomInventory = { propertyId, roomId, roomName: "Block QA 402", buildingLabel: "Main", floorLabel: "4", salesMode: 2, version: 4,
  units: [{ inventoryUnitId: bedId, propertyId, roomId, bedId, kind: 2, label: "Window", isTopologyActive: true, isSellable: false }] };
const evidence: SalesModeEvidence = { propertyId, rooms: [room], permissionsCurrent: true, propertyCurrent: true, inventoryCurrent: true, mayRead: true, mayConfigure: true };
const impact: RoomInventoryChangeImpact = { propertyId, roomId, activeAllocationCount: 0, activeManualBlockCount: 0, activeBedRetirementCount: 0, activeRoomRetirementCount: 0, affectedReservationIds: [], affectedReservationIdsTruncated: false, canChangeSalesMode: true };
const target = { room, salesMode: "bedLevel" as const };
const input = { propertyId, roomId, salesMode: "bedLevel" as const, expectedVersion: 4 };
const source = (file: string) => readFileSync(`src/${file}`, "utf8");

describe("shared selling setup authority and exact attempts", () => {
  it("keeps read/configure/current-source gates independent and unchanged mode disabled", () => {
    expect(salesChangeAllowed(target, evidence, impact, true)).toBe(true);
    for (const key of ["mayRead", "mayConfigure", "permissionsCurrent", "propertyCurrent", "inventoryCurrent"] as const) {
      expect(salesRoomEditable(room, { ...evidence, [key]: false })).toBe(false);
      expect(salesRoomCurrent(room, { ...evidence, [key]: false }, true)).toBe(false);
    }
    expect(salesChangeAllowed({ room, salesMode: "roomLevel" }, evidence, impact, true)).toBe(false);
    expect(salesChangeAllowed({ room, salesMode: "unconfigured" }, evidence, impact, true)).toBe(false);
    expect(salesChangeAllowed(target, evidence, impact, false)).toBe(false);
    expect(salesChangeAllowed(target, { ...evidence, propertyId: "other" }, impact, true)).toBe(false);
    expect(salesRoomCurrent(room, { ...evidence, rooms: [] }, true)).toBe(false);
  });
  it("requires active physical bed inventory, not beds currently sellable under whole-room setup", () => {
    expect(activeSalesBeds(room)).toBe(1);
    expect(room.units[0].isSellable).toBe(false);
    const zeroBed = { ...room, units: [{ ...room.units[0], kind: "room" as const }] };
    expect(salesChangeAllowed({ ...target, room: zeroBed }, { ...evidence, rooms: [zeroBed] }, impact, true)).toBe(false);
    expect(salesChangeAllowed(target, { ...evidence, rooms: [zeroBed] }, impact, true)).toBe(false);
    expect(salesRoomEditable({ ...room, units: [{ ...room.units[0], isTopologyActive: false }] }, evidence)).toBe(false);
    expect(salesRoomEditable({ ...room, version: 0 }, { ...evidence, rooms: [{ ...room, version: 0 }] })).toBe(false);
  });
  it.each(["activeAllocationCount", "activeManualBlockCount", "activeBedRetirementCount", "activeRoomRetirementCount"] as const)("requires resolution of %s despite a contradictory clear flag", (key) => {
    expect(salesChangeAllowed(target, evidence, { ...impact, [key]: 1 }, true)).toBe(false);
  });
  it("rejects wrong-room, malformed and unavailable impact", () => {
    for (const invalid of [undefined, { ...impact, propertyId: "other" }, { ...impact, roomId: "other" }, { ...impact, activeManualBlockCount: -1 }, { ...impact, activeAllocationCount: 1.5 }, { ...impact, affectedReservationIds: ["------------------------------------"] }]) {
      expect(salesImpactMatches(invalid, room)).toBe(false);
      expect(salesChangeAllowed(target, evidence, invalid, true)).toBe(false);
    }
  });
  it("replays the original hidden-success operation/version without treating newer room evidence as a new attempt", () => {
    const first = resolveSalesModeMutationAttempt(null, input, () => "original-operation");
    const advancedRoom = { ...room, version: 5, salesMode: 3 as const };
    const advanced = { ...evidence, rooms: [advancedRoom] };
    expect(salesChangeAllowed(target, advanced, impact, true)).toBe(false);
    expect(salesRoomCurrent(room, advanced, true)).toBe(true);
    expect(resolveSalesModeMutationAttempt(first, { ...input, expectedVersion: 5 })).toBe(first);
    expect(salesReceiptMatches({ propertyId, roomId, salesMode: 3, version: 5 }, target, first.expectedVersion)).toBe(true);
    // Only explicit reviewed adoption clears the attempt and uses the new version.
    expect(resolveSalesModeMutationAttempt(null, { ...input, expectedVersion: 6 }, () => "reviewed-operation")).toMatchObject({ operationId: "reviewed-operation", expectedVersion: 6 });
  });
  it("validates exact advancing receipts against original intent and rejects malformed success", () => {
    const receipt = { propertyId, roomId, salesMode: 3, version: 5 };
    expect(salesReceiptMatches(receipt, target, 4)).toBe(true);
    for (const invalid of [null, {}, { ...receipt, propertyId: "other" }, { ...receipt, roomId: "" }, { ...receipt, salesMode: 2 }, { ...receipt, salesMode: 99 }, ...[0, 4, 4.5, Infinity, Number.MAX_SAFE_INTEGER + 1].map((version) => ({ ...receipt, version }))]) expect(salesReceiptMatches(invalid, target, 4)).toBe(false);
  });
  it("fences session/property/room/editor drift while distinguishing assurance from rejected and unknown requests", () => {
    const current = { context: "session:property:room:unit", instance: 2 };
    expect(salesAttemptCurrent(current, current)).toBe(true);
    for (const changed of [{ ...current, instance: 3 }, { ...current, context: "other-session:property:room:unit" }, { ...current, context: "session:property:room:other-unit" }]) expect(salesAttemptCurrent(current, changed)).toBe(false);
    for (const status of [400, 403, 404, 409, 423]) expect(salesKnownRejection(new ApiError("Rejected", status))).toBe(true);
    for (const error of [new ApiError("Confirm", 403, "Security.InsufficientAuthentication"), new ApiError("Unavailable", 503), new Error("Network error")]) expect(salesKnownRejection(error)).toBe(false);
  });
  it("keeps all enum representations truthful", () => {
    expect([1, "unconfigured", 2, "roomLevel", 3, "bedLevel", 99].map(canonicalSalesMode)).toEqual(["unconfigured", "unconfigured", "roomLevel", "roomLevel", "bedLevel", "bedLevel", null]);
    expect(salesBlockerSummary({ ...impact, activeAllocationCount: 1, activeManualBlockCount: 2, activeBedRetirementCount: 3, activeRoomRetirementCount: 1 })).toBe("1 reservation, 2 blocks, 3 bed retirements, 1 room retirement");
  });
});

describe("selling setup return routes", () => {
  const returnRoute = { section: "availability" as const, propertyId, roomId, bedId, inventoryUnitId: bedId, arrival: "2026-09-05", departure: "2026-09-07" };
  const params = withSpacesReturnRoute(withOperationalSurfaceReturn(new URLSearchParams({ property: propertyId }), { surface: "today", view: "visual", propertyId }), returnRoute);
  it("preserves Properties to Inventory's exact safe Spaces and Today origin", () => {
    const href = inventorySalesSetupUrl(propertyId, roomId, params);
    const next = new URLSearchParams(href.split("?")[1]);
    expect(parseSpacesReturnRoute(next, propertyId)).toEqual(returnRoute);
    expect(spacesReturnHref(parseSpacesReturnRoute(next)!, next)).toContain("surfaceReturnView=visual");
    expect(next.get("room")).toBe(roomId);
  });
  it("preserves exact affected-reservation origin only for authorized links", () => {
    const affected = { ...impact, affectedReservationIds: [bedId], affectedReservationIdsTruncated: true };
    expect(affectedSalesReservationsUrl(affected, params, false)).toBeNull();
    const next = new URLSearchParams(affectedSalesReservationsUrl(affected, params, true)!.split("?")[1]);
    expect(parseSpacesReturnRoute(next)).toEqual(returnRoute);
    expect(next.get("reservation")).toBe(bedId);
    expect(next.get("affected")).toBe(bedId);
  });
  it("never fabricates cold-entry origins or forwards cross-property origins", () => {
    expect(inventorySalesSetupUrl(propertyId, roomId, new URLSearchParams())).not.toContain("Return");
    expect(inventorySalesSetupUrl("other", roomId, params)).not.toContain("Return");
  });
});

function renderEditor(overrides: Partial<SalesModeEditor> = {}, mayReadReservations = true) {
  const editor = {
    target: { ...target, originParams: "" }, currentRoom: room, instance: 1, opener: { current: null }, busy: false,
    mutation: { error: null }, impact, impactSource: { label: "Room impact", state: "ready", isFetching: false, refetch: async () => {} },
    canSubmit: true, targetCurrent: true, close: () => {}, save: () => {}, setMode: () => {}, ...overrides,
  } as SalesModeEditor;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SalesModeChangeModal, { editor, inline: true, mayReadReservations })));
}
describe("compact shared selling feedback", () => {
  it("renders native labelled choices and a single in-place form with explicit save", () => {
    const html = renderEditor();
    expect(html).toContain("How Block QA 402 is sold");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain("BunkFy checks again when you save");
    expect(html).not.toContain("Manage sales setup");
  });
  it("renders one retry for uncached impact failure and no duplicate notice", () => {
    const html = renderEditor({ impact: undefined, impactError: new Error("503 controlled"), impactSource: { label: "Room impact", state: "unavailable", isFetching: false, refetch: async () => {} }, canSubmit: false });
    expect(html.match(/>Try again</g)).toHaveLength(1);
    expect(html).not.toContain("The latest room impact is delayed");
    expect(html).toMatch(/disabled=""[^>]*>Save selling setup/);
  });
  it("explicitly enables stacked narrow and horizontal wide layout for the cached impact warning", () => {
    const html = renderEditor({ impactSource: { label: "Room impact", state: "stale", isFetching: false, refetch: async () => {} }, canSubmit: false });
    const warningClass = html.match(/class="([^"]*\balert\b[^"]*)" role="status"/)?.[1].split(" ");
    expect(warningClass).toEqual(expect.arrayContaining(["flex", "flex-col", "sm:flex-row", "mb-4"]));
    expect(html).toContain("The latest room impact is delayed");
    expect(html).toContain("Room impact is showing its last confirmed snapshot");
    expect(html.match(/Try again/g)).toHaveLength(1);
    expect(html).toMatch(/disabled=""[^>]*>Save selling setup/);
  });
  it("keeps blocker counts/truncation truthful and omits reservation links without permission", () => {
    const html = renderEditor({ impact: { ...impact, activeAllocationCount: 2, affectedReservationIds: [bedId], affectedReservationIdsTruncated: true, canChangeSalesMode: false }, canSubmit: false }, false);
    expect(html).toContain("Resolve 2 reservations");
    expect(html).toContain("Only the first 1 affected reservation IDs");
    expect(html).not.toContain("Review 1 reservation");
  });
  it("keeps known conflicts reviewable and explains an already-matching authoritative setup without no-op saving", () => {
    const html = renderEditor({ rejected: true, mutation: { error: new ApiError("Changed", 409, "Inventory.VersionConflict") } as unknown as SalesModeEditor["mutation"], canSubmit: false, canUseCurrent: true, currentRoom: { ...room, salesMode: 3, version: 5 } });
    expect(html).toContain("No new save is needed");
    expect(html).toContain("Keep current setup");
    expect(html).not.toContain("Retry same save");
  });
  it("separates assurance from the form and keeps a pending same-request resume visible", () => {
    const html = renderEditor({ mutation: { error: new ApiError("Confirm", 403, "Security.InsufficientAuthentication") } as unknown as SalesModeEditor["mutation"], canSubmit: false, resumePending: true });
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(html.indexOf("</form>")).toBeLessThan(html.indexOf('type="password"'));
    expect(html).toContain("Waiting for current access and room details");
  });
  it("wires both owners to one controller and preserves captured invalidation, resume fences and origin rendering", () => {
    const controller = source("features/inventory/useSalesModeEditor.ts");
    for (const file of ["features/spaces/SpacesPage.tsx", "features/inventory/InventoryPage.tsx"]) {
      expect(source(file)).toContain("useSalesModeEditor({");
      expect(source(file)).not.toContain("resolveSalesModeMutationAttempt");
      expect(source(file)).not.toContain('method: "PUT"');
    }
    expect(controller).toContain('expectedVersion: input.attempt.expectedVersion');
    expect(controller).toContain('salesAttemptCurrent(resume, current.current)');
    expect(controller).toContain('refetch: () => target && salesRoomCurrent(target.room, latestEvidence.current, true)');
    expect(controller).toContain('mutation.mutate({ ...resume, replay: true })');
    expect(controller).toContain('["operational-preview", input.tenantId, input.propertyId]');
    expect(controller).toContain('["reservation-calendar", input.propertyId]');
    expect(source("features/reservations/ReservationsPage.tsx")).toContain(': <OwnerOriginLink className="mb-0" />');
    expect(source("features/reservations/ReservationsPage.tsx")).toContain('originLink={originLink}');
    expect(source("features/properties/PropertiesPage.tsx")).toContain('inventorySalesSetupUrl(selectedPropertyId, selectedRoom.roomId, searchParams)');
    expect(source("features/spaces/SpacesAvailabilitySection.tsx").match(/<SalesModeChangeModal/g)).toHaveLength(1);
  });
});
