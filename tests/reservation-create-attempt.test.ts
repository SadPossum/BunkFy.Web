import { describe, expect, it } from "vitest";
import {
  resolveReservationCreateAttempt,
  type ReservationCreatePayload,
} from "../src/features/reservations/reservationCreateAttempt";

const payload: ReservationCreatePayload = {
  arrival: "2026-08-10",
  departure: "2026-08-12",
  expectedArrivalTime: "15:00:00",
  expectedDepartureTime: "11:00:00",
  inventoryUnitIds: ["unit-b", "unit-a"],
  primaryGuestName: "Ada Guest",
  email: "ada@example.test",
  phone: null,
  guestCount: 1,
  sourceKind: 1,
  sourceSystem: null,
  sourceReference: null,
  notes: "Quiet room",
};

describe("reservation create attempt", () => {
  it("reuses one operation id for a normalized equivalent retry", () => {
    const first = resolveReservationCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveReservationCreateAttempt(
      first,
      {
        ...payload,
        inventoryUnitIds: ["unit-a", "unit-b"],
        primaryGuestName: "  Ada Guest  ",
        email: "  ada@example.test  ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("allocates a new operation id when the request changes", () => {
    const first = resolveReservationCreateAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const changed = resolveReservationCreateAttempt(
      first,
      { ...payload, primaryGuestName: "Grace Guest" },
      () => "operation-2",
    );

    expect(changed.operationId).toBe("operation-2");
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });
});
