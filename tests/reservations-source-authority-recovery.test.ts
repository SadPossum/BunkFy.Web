import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  GuestListItem,
  InventoryUnitAvailability,
  Reservation,
} from "../src/api/types";
import {
  guestCandidateIsCurrent,
  inventorySelectionIsCurrent,
  reservationMutationAllowed,
  reservationRecordMatches,
} from "../src/features/reservations/reservationsMutationAuthority";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8")
    .replaceAll("\r\n", "\n");
}

describe("reservations source authority recovery", () => {
  it("requires only the current evidence consumed by each command", () => {
    const current = {
      permissionsCurrent: true,
      reservationCurrent: true,
      availabilityCurrent: true,
      guestDirectoryCurrent: true,
    };

    for (const action of [
      "create-reservation",
      "update-details",
      "lifecycle",
      "link-existing-guest",
      "create-and-link-guest",
    ] as const) {
      expect(reservationMutationAllowed(action, current)).toBe(true);
      expect(reservationMutationAllowed(action, {
        ...current,
        permissionsCurrent: false,
      })).toBe(false);
    }

    expect(reservationMutationAllowed("create-reservation", {
      permissionsCurrent: true,
      availabilityCurrent: true,
    })).toBe(true);
    expect(reservationMutationAllowed("create-reservation", {
      permissionsCurrent: true,
      availabilityCurrent: false,
      reservationCurrent: true,
    })).toBe(false);
    expect(reservationMutationAllowed("lifecycle", {
      permissionsCurrent: true,
      reservationCurrent: false,
      availabilityCurrent: true,
    })).toBe(false);
    expect(reservationMutationAllowed("create-and-link-guest", {
      permissionsCurrent: true,
      reservationCurrent: true,
      guestDirectoryCurrent: false,
    })).toBe(true);
    expect(reservationMutationAllowed("link-existing-guest", {
      permissionsCurrent: true,
      reservationCurrent: true,
      guestDirectoryCurrent: false,
    })).toBe(false);
  });

  it("rejects reservation commands after a source version advances", () => {
    const reservation = {
      propertyId: "property-a",
      reservationId: "reservation-a",
      version: 7,
      detailsRevision: 4,
    } as Reservation;

    expect(reservationRecordMatches(reservation, reservation)).toBe(true);
    expect(reservationRecordMatches({ ...reservation, version: 8 }, reservation)).toBe(false);
    expect(reservationRecordMatches({ ...reservation, detailsRevision: 5 }, reservation)).toBe(false);
    expect(reservationRecordMatches({ ...reservation, propertyId: "property-b" }, reservation)).toBe(false);
  });

  it("accepts only unique units that remain available at the selected property", () => {
    const available = availability("unit-a", true);
    const unavailable = availability("unit-b", false);

    expect(inventorySelectionIsCurrent("property-a", [available], ["unit-a"])).toBe(true);
    expect(inventorySelectionIsCurrent("property-a", [available], [])).toBe(false);
    expect(inventorySelectionIsCurrent("property-a", [available], ["unit-a", "unit-a"])).toBe(false);
    expect(inventorySelectionIsCurrent("property-a", [available, unavailable], ["unit-b"])).toBe(false);
    expect(inventorySelectionIsCurrent("property-b", [available], ["unit-a"])).toBe(false);
  });

  it("requires the selected active Guest Record to match the current directory row", () => {
    const candidate = guest("guest-a", "2026-08-23T10:00:00Z", 1);

    expect(guestCandidateIsCurrent([candidate], candidate)).toBe(true);
    expect(guestCandidateIsCurrent([
      guest("guest-a", "2026-08-23T10:01:00Z", 1),
    ], candidate)).toBe(false);
    expect(guestCandidateIsCurrent([
      guest("guest-a", candidate.lastChangedAtUtc, 2),
    ], candidate)).toBe(false);
    expect(guestCandidateIsCurrent([candidate], {
      ...candidate,
      status: 2,
    })).toBe(false);
  });

  it("preserves independent snapshots and gates every reservation mutation path", () => {
    const page = source("features/reservations/ReservationsPage.tsx");
    const create = source("features/reservations/CreateReservationModal.tsx");
    const detail = source("features/reservations/ReservationDetail.tsx");
    const guestPicker = source("features/reservations/GuestRecordPicker.tsx");

    expect(page).toContain("<CompositeSourceNotice");
    expect(page).toContain("createAffectedReservationSource(");
    expect(page).toContain("compositeSourceUsable(affectedSources[index].state)");
    expect(page).toContain("key={selectedPropertyId}");
    expect(page).not.toContain("const listError =");

    expect(create).toContain("const availabilityCurrent = compositeSourceCurrent(availabilitySource)");
    expect(create).toContain("inventorySelectionIsCurrent(");
    expect(create).toContain("if (!canSubmit)");
    expect(create).toContain("selectionEnabled={createAuthorityCurrent}");

    expect(detail).toContain("const reservationCurrent = compositeSourceCurrent(reservationSource)");
    expect(detail).toContain("reservationRecordMatches(reservation.data, current)");
    expect(detail).toContain("guestDirectoryCurrent: candidateCurrent");
    expect(detail).toContain("<CompositeSourceFallback");
    expect(detail).not.toContain("reservation.error ?");
    expect(detail).not.toContain("if (query.error)");

    expect(guestPicker).toContain("guestCandidateIsCurrent(guestItems, selectedGuest)");
    expect(guestPicker).toContain("disabled={!sourceCurrent || !selectionEnabled}");
  });
});

function availability(
  inventoryUnitId: string,
  isAvailable: boolean,
): InventoryUnitAvailability {
  return {
    unit: {
      inventoryUnitId,
      propertyId: "property-a",
      roomId: "room-a",
      bedId: inventoryUnitId,
      kind: 2,
      label: inventoryUnitId,
      isSellable: true,
      isTopologyActive: true,
    },
    isAvailable,
    activeBlockIds: [],
    activeAllocationIds: [],
  };
}

function guest(
  guestId: string,
  lastChangedAtUtc: string,
  status: GuestListItem["status"],
): GuestListItem {
  return {
    guestId,
    displayName: "Maya Chen",
    legalName: null,
    email: "maya@example.test",
    phone: null,
    nationalityCountryCode: null,
    preferredLanguageTag: null,
    status,
    lastChangedBy: "staff:test",
    lastChangedAtUtc,
  };
}
