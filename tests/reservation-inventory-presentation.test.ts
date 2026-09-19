import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Reservation, ReservationListItem } from "../src/api/types";
import { ReservationOverview } from "../src/features/reservations/ReservationDetail";
import { reservationInventoryPresentation, reservationInventorySummary } from "../src/features/reservations/reservationOperationalView";
import { reservationModel } from "../src/features/operational-preview/OperationalPreviewHost";
import { OperationalPreviewContent } from "../src/features/operational-preview/OperationalPreviewContent";
import { reservationListItemFromDetail } from "../src/features/operational-preview/operationalPreviewModel";

const fixture: Reservation = {
  reservationId: "reservation-1", propertyId: "property-1",
  arrival: "2026-09-05", departure: "2026-09-08",
  expectedArrivalTime: null, expectedDepartureTime: null,
  inventoryUnitIds: ["unit-1"], primaryGuestName: "Demo guest", guestCount: 2,
  email: null, phone: null, sourceKind: "direct", sourceSystem: null,
  sourceReference: null, notes: null, status: "confirmed", holdsInventory: true,
  allocationRequestId: "request-1", allocationId: "allocation-1", allocationVersion: 1,
  allocationRejection: 0, pendingAllocationAmendmentId: null, lastAllocationAmendmentRejection: 0,
  detailsRevision: 1, lastDetailsChangeOrigin: 1, version: 1,
  createdAtUtc: "2026-09-05T09:00:00Z", updatedAtUtc: null,
  pendingStayBusinessDate: null, pendingStayActorId: null,
  checkedInBusinessDate: null, checkedInAtUtc: null, checkedInBy: null,
  noShowBusinessDate: null, noShowAtUtc: null, noShowBy: null,
  checkedOutBusinessDate: null, checkedOutAtUtc: null, checkedOutBy: null, guests: [],
};
const inventory = {
  inventoryUnitId: "unit-1", roomId: "room-1", roomName: "Family 402",
  unitLabel: "402", unitDetail: "Private room",
};

describe("reservation inventory wording across list, detail and shared preview", () => {
  it.each([
    ["confirmed", true, "1 unit held", "Assigned inventory", "Assigned room or bed"],
    [2, true, "1 unit held", "Assigned inventory", "Assigned room or bed"],
    ["checkedIn", true, "1 unit held", "Assigned inventory", "Assigned room or bed"],
    [6, true, "1 unit held", "Assigned inventory", "Assigned room or bed"],
    ["pendingAllocation", false, "Requested · not held", "Requested inventory — not held", "Requested room or bed"],
    [1, false, "Requested · not held", "Requested inventory — not held", "Requested room or bed"],
    ["allocationRejected", false, "Requested · not held", "Requested inventory — not held", "Requested room or bed"],
    [3, false, "Requested · not held", "Requested inventory — not held", "Requested room or bed"],
    ["checkedOut", false, "Inventory released", "Recorded inventory", "Recorded room or bed"],
    [10, false, "Inventory released", "Recorded inventory", "Recorded room or bed"],
    ["cancelled", false, "Inventory released", "Recorded inventory", "Recorded room or bed"],
    [5, false, "Inventory released", "Recorded inventory", "Recorded room or bed"],
    ["noShow", false, "Inventory released", "Recorded inventory", "Recorded room or bed"],
    [8, false, "Inventory released", "Recorded inventory", "Recorded room or bed"],
    ["checkoutPending", true, "1 unit held", "Assigned inventory", "Assigned room or bed"],
    ["checkoutPending", false, "Inventory not held", "Recorded inventory", "Recorded room or bed"],
    [0, false, "Inventory not held", "Recorded inventory", "Recorded room or bed"],
  ] as const)("renders status %s with holds=%s truthfully", (status, holdsInventory, summary, heading, contextLabel) => {
    const detail = { ...fixture, status, holdsInventory };
    const item = reservationListItemFromDetail(detail);
    const model = reservationModel(item, inventory, "current");
    const detailHtml = renderToStaticMarkup(createElement(ReservationOverview, {
      reservation: detail, inventoryLabels: new Map([["unit-1", "Family 402"]]), inventoryLabelState: "current",
    }));
    const previewHtml = renderToStaticMarkup(createElement(OperationalPreviewContent, {
      headingId: "preview-heading", model, originLabel: "Today · Operations",
      refreshLabel: "Refresh", refreshPending: false, showRefresh: false,
      onClose: () => {}, onNavigate: () => {}, onRefresh: () => {},
    }));
    expect(reservationInventorySummary(item)).toBe(summary);
    expect(detailHtml).toContain(summary);
    expect(detailHtml).toContain(heading);
    expect(detailHtml).toContain("Family 402");
    expect(previewHtml).toContain(summary);
    expect(previewHtml).toContain(contextLabel);
    expect(previewHtml).toContain("Family 402 · 402");
    if (summary === "Inventory released" || summary === "Inventory not held" || holdsInventory) {
      expect(detailHtml).not.toContain("until allocation succeeds");
      expect(detailHtml).not.toContain("Requested inventory");
      expect(previewHtml).not.toContain("Requested room or bed");
    }
  });

  it.each(["pendingAllocation", 1, "allocationRejected", 3] as const)(
    "only pending allocation promises processing; status %s", (status) => {
      const html = renderToStaticMarkup(createElement(ReservationOverview, {
        reservation: { ...fixture, status, holdsInventory: false }, inventoryLabels: new Map(), inventoryLabelState: "current",
      }));
      if (status === 1 || status === "pendingAllocation") {
        expect(html).toContain("until allocation succeeds");
      } else {
        expect(html).toContain("could not be allocated");
        expect(html).not.toContain("until allocation succeeds");
      }
    },
  );

  it("does not override a reported hold merely because the status is terminal", () => {
    expect(reservationInventoryPresentation({ status: 10, holdsInventory: true, inventoryUnitCount: 2 }).summary)
      .toBe("2 units held");
  });

  it("keeps unknown unheld status neutral instead of inventing an allocation request", () => {
    // A future backend enum value must not invent a hold or pending request.
    const unknown = { status: 99, holdsInventory: false, inventoryUnitCount: 1 } as unknown as Pick<ReservationListItem, "status" | "holdsInventory" | "inventoryUnitCount">;
    expect(reservationInventoryPresentation(unknown)).toEqual({
      summary: "Inventory not held", heading: "Recorded inventory",
      contextLabel: "Recorded room or bed", explanation: null,
    });
  });

  it.each(["access-unavailable", "access-unconfirmed", "loading", "unconfirmed"] as const)("%s shows one bounded explanation, never raw IDs or retained names", inventoryLabelState => {
    const ids = ["7fe12abc-0000-4000-8000-000000000001", "9ab34cde-0000-4000-8000-000000000002"];
    const html = renderToStaticMarkup(createElement(ReservationOverview, { reservation: { ...fixture, inventoryUnitIds: ids }, inventoryLabels: new Map(ids.map(id => [id, "Cached private bed"])), inventoryLabelState }));
    expect(html).toContain("2 units held"); expect(html).not.toContain("Cached private bed"); expect(html).not.toContain("7fe12abc"); expect(html).not.toContain("9ab34cde");
    expect(html.match(/Room or bed names|Confirming current room or bed names/g)).toHaveLength(1);
  });
  it("partially matched current inventory shows only confirmed names and one missing-name explanation", () => {
    const html = renderToStaticMarkup(createElement(ReservationOverview, { reservation: { ...fixture, inventoryUnitIds: ["unit-1", "7fe12abc-0000-4000-8000-000000000001"] }, inventoryLabels: new Map([["unit-1", "Family 402"]]), inventoryLabelState: "current" }));
    expect(html).toContain("2 units held"); expect(html).toContain("Family 402"); expect(html).not.toContain("7fe12abc"); expect(html.match(/Room or bed names are unconfirmed/g)).toHaveLength(1);
  });
  it("no recorded inventory does not invent a label-access warning or an assignment", () => {
    const html = renderToStaticMarkup(createElement(ReservationOverview, { reservation: { ...fixture, inventoryUnitIds: [], holdsInventory: false }, inventoryLabels: new Map(), inventoryLabelState: "access-unavailable" }));
    expect(html).toContain("No room or bed recorded"); expect(html).not.toContain("inventory access is not assigned");
  });
});
