import { describe, expect, it } from "vitest";
import type {
  InventoryAvailabilityResponse,
  InventoryUnit,
  InventoryUnitAvailability,
  ManualBlock,
  ReservationListItem,
  RoomInventory,
} from "../src/api/types";
import {
  availabilityResponseMatchesSelection,
  availabilityUnitMatchesSelection,
  inventoryContextFromRooms,
  inventoryDestinationHref,
  inventoryRoomsMatchProperty,
  manualBlockListMatchesProperty,
  manualBlockMatchesSelection,
  mayOpenSpacesFromPreview,
  operationalInventoryContextMatchesSelection,
  propertySetupDestinationHref,
  reservationMatchesSelection,
  resolveUnitState,
} from "../src/features/operational-preview/operationalPreviewModel";
import {
  operationalOriginHref,
  parseOperationalPreviewRoute,
  parseOperationalReturnRoute,
  withOperationalPreviewRoute,
  type OperationalPreviewRoute,
} from "../src/features/operational-preview/operationalPreviewRoute";
import {
  combineOperationalPreviewSourceTones,
  operationalPreviewQueryTone,
  shouldShowOperationalPreviewRefresh,
} from "../src/features/operational-preview/operationalPreviewSourceState";
import { stateCount, visualUnitState } from "../src/features/dashboard/todayVisualAvailability";
import { blockModel } from "../src/features/operational-preview/OperationalPreviewHost";

const propertyId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const unitId = "33333333-3333-4333-8333-333333333333";
const bedId = "44444444-4444-4444-8444-444444444444";
const unit: InventoryUnit = {
  propertyId,
  roomId,
  inventoryUnitId: unitId,
  bedId,
  kind: "bed",
  label: "101-A",
  isSellable: true,
  isTopologyActive: true,
};

const route = {
  selection: {
    kind: "inventoryUnit",
    propertyId,
    roomId,
    inventoryUnitId: unitId,
    bedId,
    date: "2026-09-02",
    observedState: "available",
  },
  origin: { surface: "today", propertyId, view: "visual" },
} satisfies OperationalPreviewRoute;

describe("operational preview model", () => {
  it.each([
    [1, "active", "Space held for these dates"],
    ["active", "active", "Space held for these dates"],
    [2, "released", "Manual hold released"],
    ["released", "released", "Manual hold released"],
    [99, "unknown", "Block status unconfirmed"],
    ["unknown", "unknown", "Block status unconfirmed"],
  ] as const)("keeps the actual block preview badge and summary coherent for status %s", (status, expectedStatus, summary) => {
    const block: ManualBlock = {
      blockId: "block-a", blockGroupId: "group-a", propertyId, inventoryUnitId: unitId,
      arrival: "2026-09-05", departure: "2026-09-08", reason: "Window latch repair",
      status: status as ManualBlock["status"], version: 1, createdAtUtc: "2026-09-05T02:00:00Z", releasedAtUtc: null,
    };
    expect(blockModel(block, undefined, "current")).toMatchObject({
      title: "Window latch repair", status: expectedStatus, summary, sourceTone: "current",
    });
  });

  it.each(["stale", "unavailable", "loading"] as const)("demotes cached Visual availability and counts when %s", (sourceState) => {
    const cached = availability({ isAvailable: true });
    expect(visualUnitState(unit, cached, sourceState)).toBe("unknown");
    expect(stateCount(["available", "occupied"], "available", sourceState)).toBe("—");
    expect(visualUnitState(unit, cached, "ready")).toBe("available");
    expect(stateCount(["available", "occupied"], "available", "ready")).toBe(1);
  });

  it.each([
    [true, undefined, false],
    [false, new Error("source failed"), false],
    [false, undefined, true],
  ])("does not treat retained data as current while fetching=%s", (fetching, error, paused) => {
    const cached = availability({ isAvailable: true });
    const tone = operationalPreviewQueryTone(cached, fetching, error, paused);
    expect(resolveUnitState(unit, cached, tone === "current", "available").state).toBe("unknown");
    expect(resolveUnitState(unit, cached, true, "available").state).toBe("available");
  });

  it("settles failed and paused reads into an explicit recoverable state", () => {
    expect(operationalPreviewQueryTone(undefined, true, undefined)).toBe("refreshing");
    expect(operationalPreviewQueryTone(undefined, false, new Error("offline"))).toBe("delayed");
    expect(operationalPreviewQueryTone(undefined, false, undefined, true)).toBe("delayed");
    expect(operationalPreviewQueryTone({ available: true }, false, undefined)).toBe("current");

    expect(combineOperationalPreviewSourceTones("current", "delayed")).toBe("delayed");
    expect(combineOperationalPreviewSourceTones("current", "refreshing")).toBe("refreshing");
  });

  it("keeps one recovery action mounted for failure and an explicit retry", () => {
    expect(shouldShowOperationalPreviewRefresh({
      hasRecoveryFailure: true,
      explicitRefreshPending: false,
    })).toBe(true);
    expect(shouldShowOperationalPreviewRefresh({
      hasRecoveryFailure: false,
      explicitRefreshPending: true,
    })).toBe(true);
    expect(shouldShowOperationalPreviewRefresh({
      hasRecoveryFailure: false,
      explicitRefreshPending: false,
    })).toBe(false);
  });

  it("uses only evidenced availability reasons", () => {
    expect(resolveUnitState(unit, availability({ isAvailable: true }), true, "unknown"))
      .toEqual({
        state: "available",
        explanation: "No active reservation allocation or inventory block is reported for this date.",
      });
    expect(resolveUnitState(unit, availability({ isAvailable: false }), true, "available"))
      .toEqual({
        state: "unavailable",
        explanation: "Unavailable — the current source did not provide a reason.",
      });
    expect(resolveUnitState(unit, availability({ activeBlockIds: ["block"] }), true, "available").state)
      .toBe("blocked");
    expect(resolveUnitState(unit, availability({ activeAllocationIds: ["allocation"] }), true, "available").state)
      .toBe("occupied");
  });

  it("marks delayed evidence unknown instead of preserving a stale claim", () => {
    expect(resolveUnitState(unit, undefined, false, "available")).toEqual({
      state: "unknown",
      explanation: "The last visible state is no longer current. Refresh before relying on it.",
    });
  });

  it("builds exact Spaces availability and setup destinations with safe origin state", () => {
    const inventory = inventoryDestinationHref(route);
    expect(inventory).toContain("/spaces?");
    expect(inventory).toContain("section=availability");
    expect(inventory).toContain(`unit=${unitId}`);
    expect(inventory).toContain(`focus=${unitId}`);
    expect(inventory).toContain("arrival=2026-09-02");
    expect(inventory).toContain("opReturn=inventoryUnit");

    const setup = propertySetupDestinationHref(route);
    expect(setup).toContain("/spaces?");
    expect(setup).toContain("section=layout");
    expect(setup).toContain(`bed=${bedId}`);
    expect(setup).toContain(`unit=${unitId}`);
    expect(setup).not.toContain("edit=bed");
    expect(setup).toContain("opReturnFrom=today");
    expect(setup).toContain("arrival=2026-09-02");
    expect(setup).toContain("departure=2026-09-03");
  });

  it.each([true, false])("keeps primary and secondary block handoffs on the same night, bed=%s", (isBed) => {
    const blockRoute: OperationalPreviewRoute = {
      selection: {
        kind: "inventoryBlock", propertyId, roomId, inventoryUnitId: unitId,
        ...(isBed ? { bedId } : {}),
        blockGroupId: "55555555-5555-4555-8555-555555555555",
        date: "2026-09-30",
      },
      origin: { surface: "calendar", propertyId, date: "2026-09-28", day: "2026-09-30" },
    };
    for (const href of [inventoryDestinationHref(blockRoute), propertySetupDestinationHref(blockRoute)]) {
      const params = new URL(href!, "https://bunkfy.test").searchParams;
      expect(params.get("property")).toBe(propertyId);
      expect(params.get("room")).toBe(roomId);
      expect(params.get("unit")).toBe(unitId);
      expect(params.get("arrival")).toBe("2026-09-30");
      expect(params.get("departure")).toBe("2026-10-01");
      const returned = parseOperationalReturnRoute(params);
      expect(returned).toEqual(blockRoute);
      const origin = new URL(operationalOriginHref(returned!), "https://bunkfy.test");
      expect(origin.pathname).toBe("/calendar");
      expect(origin.searchParams.get("date")).toBe("2026-09-28");
      expect(origin.searchParams.get("day")).toBe("2026-09-30");
      expect(parseOperationalPreviewRoute(origin.searchParams)).toEqual(blockRoute);
    }
    const setup = new URL(propertySetupDestinationHref(blockRoute)!, "https://bunkfy.test").searchParams;
    expect(setup.get("section")).toBe("layout");
    expect(setup.get("bed")).toBe(isBed ? bedId : null);
    const primary = new URL(inventoryDestinationHref(blockRoute), "https://bunkfy.test").searchParams;
    expect(primary.get("section")).toBe("blocks");
    expect(primary.get("blockGroup")).toBe("55555555-5555-4555-8555-555555555555");
  });

  it.each([true, false])("leaves generic undated setup defaults intact, bed=%s", (isBed) => {
    const undated: OperationalPreviewRoute = {
      selection: {
        kind: "inventoryBlock", propertyId, roomId, inventoryUnitId: unitId,
        ...(isBed ? { bedId } : {}), blockGroupId: "55555555-5555-4555-8555-555555555555",
      },
      origin: { surface: "today", propertyId, view: "operations" },
    };
    const params = new URL(propertySetupDestinationHref(undated)!, "https://bunkfy.test").searchParams;
    expect(params.has("arrival")).toBe(false);
    expect(params.has("departure")).toBe(false);
    expect(parseOperationalReturnRoute(params)).toEqual(undated);
  });

  it.each(["2026-02-30", "not-a-date"])("rejects invalid preview date %s before a dated handoff", (date) => {
    const params = withOperationalPreviewRoute(new URLSearchParams(), route);
    params.set("opDate", date);
    expect(parseOperationalPreviewRoute(params)).toBeNull();
  });

  it("targets an exact block group in Spaces Blocks", () => {
    const blockRoute: OperationalPreviewRoute = {
      selection: {
        kind: "inventoryBlock",
        propertyId,
        blockGroupId: "55555555-5555-4555-8555-555555555555",
        inventoryUnitId: unitId,
        roomId,
        bedId,
        date: "2026-09-02",
      },
      origin: { surface: "calendar", propertyId, date: "2026-09-02", day: "2026-09-02" },
    };
    const destination = inventoryDestinationHref(blockRoute);
    expect(destination).toContain("section=blocks");
    expect(destination).toContain("blockGroup=55555555-5555-4555-8555-555555555555");
    expect(destination).toContain("history=all");
    expect(destination).toContain("focus=55555555-5555-4555-8555-555555555555");
    expect(destination).toContain("opReturnFrom=calendar");
  });

  it("requires current access to both inventory and property context before opening Spaces", () => {
    expect(mayOpenSpacesFromPreview(true, true)).toBe(true);
    expect(mayOpenSpacesFromPreview(true, false)).toBe(false);
    expect(mayOpenSpacesFromPreview(false, true)).toBe(false);
  });

  it("binds inventory and availability evidence to the exact route coordinates", () => {
    const rooms: RoomInventory[] = [{
      propertyId,
      roomId,
      roomName: "Garden Dorm",
      buildingLabel: null,
      floorLabel: null,
      salesMode: "bedLevel",
      version: 1,
      units: [unit],
    }];
    const context = inventoryContextFromRooms(rooms, unitId, route.selection);
    expect(inventoryRoomsMatchProperty(rooms, propertyId)).toBe(true);
    expect(context && operationalInventoryContextMatchesSelection(context, route.selection)).toBe(true);

    const response: InventoryAvailabilityResponse = {
      propertyId,
      arrival: "2026-09-02",
      departure: "2026-09-03",
      units: [availability({ isAvailable: true })],
    };
    expect(availabilityResponseMatchesSelection(response, route.selection)).toBe(true);
    expect(availabilityUnitMatchesSelection(response.units[0]!, route.selection)).toBe(true);
    response.departure = "2026-09-04";
    expect(availabilityResponseMatchesSelection(response, route.selection)).toBe(false);

    rooms[0]!.units[0]!.propertyId = "99999999-9999-4999-8999-999999999999";
    expect(inventoryRoomsMatchProperty(rooms, propertyId)).toBe(false);
  });

  it("does not substitute a different reservation or block from the same response", () => {
    const reservationSelection: Extract<OperationalPreviewRoute["selection"], { kind: "reservation" }> = {
      kind: "reservation",
      propertyId,
      reservationId: "55555555-5555-4555-8555-555555555555",
      inventoryUnitId: unitId,
      date: "2026-09-02",
    };
    const reservation: ReservationListItem = {
      reservationId: reservationSelection.reservationId,
      propertyId,
      arrival: "2026-09-01",
      departure: "2026-09-04",
      expectedArrivalTime: null,
      expectedDepartureTime: null,
      primaryGuestName: "Alex Rivera",
      guestCount: 1,
      inventoryUnitCount: 1,
      inventoryUnitIds: [unitId],
      holdsInventory: true,
      sourceKind: "direct",
      status: "confirmed",
    };
    expect(reservationMatchesSelection(reservation, reservationSelection)).toBe(true);
    expect(reservationMatchesSelection(reservation, { ...reservationSelection, date: reservation.departure })).toBe(true);
    expect(reservationMatchesSelection(reservation, { ...reservationSelection, date: "2026-08-31" })).toBe(false);
    expect(reservationMatchesSelection(reservation, { ...reservationSelection, date: "2026-09-05" })).toBe(false);
    expect(reservationMatchesSelection(reservation, { ...reservationSelection, propertyId: "other-property" })).toBe(false);
    expect(reservationMatchesSelection(reservation, { ...reservationSelection, inventoryUnitId: "other-unit" })).toBe(false);
    reservation.reservationId = "66666666-6666-4666-8666-666666666666";
    expect(reservationMatchesSelection(reservation, reservationSelection)).toBe(false);

    const blockSelection: Extract<OperationalPreviewRoute["selection"], { kind: "inventoryBlock" }> = {
      kind: "inventoryBlock",
      propertyId,
      blockGroupId: "77777777-7777-4777-8777-777777777777",
      blockId: "88888888-8888-4888-8888-888888888888",
      inventoryUnitId: unitId,
      date: "2026-09-02",
    };
    const block: ManualBlock = {
      blockId: blockSelection.blockId!,
      blockGroupId: blockSelection.blockGroupId,
      propertyId,
      inventoryUnitId: unitId,
      arrival: "2026-09-01",
      departure: "2026-09-03",
      reason: "Maintenance",
      status: "active",
      version: 1,
      createdAtUtc: "2026-09-01T10:00:00Z",
      releasedAtUtc: null,
    };
    expect(manualBlockListMatchesProperty([block], propertyId)).toBe(true);
    expect(manualBlockMatchesSelection(block, blockSelection)).toBe(true);
    expect(manualBlockMatchesSelection(block, { ...blockSelection, date: block.departure })).toBe(false);
    block.inventoryUnitId = "99999999-9999-4999-8999-999999999999";
    expect(manualBlockMatchesSelection(block, blockSelection)).toBe(false);
  });
});

function availability(
  overrides: Partial<InventoryUnitAvailability>,
): InventoryUnitAvailability {
  return {
    unit,
    isAvailable: false,
    activeBlockIds: [],
    activeAllocationIds: [],
    ...overrides,
  };
}
