import { describe, expect, it } from "vitest";
import {
  ingestionRunNeedsLiveRefresh,
  operationalNotificationQueryKeys,
  proposalNeedsLiveRefresh,
  receiptNeedsLiveRefresh,
  reprocessingNeedsLiveRefresh,
  reservationNeedsLiveRefresh,
  topologyRetirementNeedsLiveRefresh,
} from "../src/app/liveUpdates";

describe("live update state detection", () => {
  it.each(["pendingAllocation", "cancellation-pending", "no_show_pending", "checkout pending", 1, 4, 7, 9])(
    "refreshes reservations while %s is processing",
    (status) => expect(reservationNeedsLiveRefresh(status)).toBe(true),
  );

  it.each(["confirmed", "allocationRejected", "checkedIn", "checkedOut", 2, 3, 6, 10])(
    "stops refreshing reservations at %s",
    (status) => expect(reservationNeedsLiveRefresh(status)).toBe(false),
  );

  it("recognizes the asynchronous ingestion states", () => {
    expect(ingestionRunNeedsLiveRefresh("running")).toBe(true);
    expect(ingestionRunNeedsLiveRefresh(2)).toBe(false);
    expect(receiptNeedsLiveRefresh(1)).toBe(true);
    expect(receiptNeedsLiveRefresh("processed")).toBe(false);
    expect(reprocessingNeedsLiveRefresh("queued")).toBe(true);
    expect(reprocessingNeedsLiveRefresh(2)).toBe(true);
    expect(reprocessingNeedsLiveRefresh("succeeded")).toBe(false);
    expect(proposalNeedsLiveRefresh("applying")).toBe(true);
    expect(proposalNeedsLiveRefresh("pending")).toBe(false);
  });

  it("refreshes topology retirement only while coordination is active", () => {
    expect(topologyRetirementNeedsLiveRefresh(1)).toBe(true);
    expect(topologyRetirementNeedsLiveRefresh("finalization-requested")).toBe(true);
    expect(topologyRetirementNeedsLiveRefresh(3)).toBe(true);
    expect(topologyRetirementNeedsLiveRefresh(4)).toBe(false);
    expect(topologyRetirementNeedsLiveRefresh("rejected")).toBe(false);
  });
});

describe("operational notification invalidation", () => {
  it("targets reservation and availability caches", () => {
    expect(operationalNotificationQueryKeys({
      name: "reservation-confirmed",
      payload: { PropertyId: "property-1", ReservationId: "reservation-1" },
    })).toEqual([
      ["reservations", "property-1"],
      ["availability", "property-1"],
      ["guest-stays", "property-1"],
      ["inventory-rooms", "property-1"],
      ["rooms", "property-1"],
      ["beds", "property-1"],
      ["reservation", "property-1", "reservation-1"],
      ["reservation-history", "property-1", "reservation-1"],
    ]);
  });

  it("targets only the affected inventory property", () => {
    expect(operationalNotificationQueryKeys({
      name: "manual-inventory-block-released",
      payload: { propertyId: "property-2" },
    })).toEqual([
      ["blocks", "property-2"],
      ["availability", "property-2"],
      ["inventory-rooms", "property-2"],
      ["rooms", "property-2"],
      ["beds", "property-2"],
    ]);
  });
});
