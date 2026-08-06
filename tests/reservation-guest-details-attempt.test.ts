import { describe, expect, it } from "vitest";
import {
  resolveReservationGuestDetailsAttempt,
  type ReservationGuestDetailsAttemptPayload,
} from "../src/features/reservations/reservationGuestDetailsAttempt";

const payload: ReservationGuestDetailsAttemptPayload = {
  propertyId: "property-a",
  reservationId: "reservation-a",
  primaryGuestName: "Ada Guest",
  email: "ada@example.test",
  phone: null,
  guestCount: 1,
  notes: "Quiet room",
  expectedArrivalTime: "15:00",
  expectedDepartureTime: "11:00",
  expectedDetailsRevision: 3,
};

describe("reservation guest-details attempt", () => {
  it("reuses the operation and original payload for a normalized equivalent retry", () => {
    const first = resolveReservationGuestDetailsAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveReservationGuestDetailsAttempt(
      first,
      {
        ...payload,
        primaryGuestName: "  Ada Guest  ",
        email: " ada@example.test ",
        phone: "   ",
        notes: " Quiet room ",
      },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
    expect(retry.payload).toBe(payload);
  });

  it.each([
    { ...payload, primaryGuestName: "Grace Guest" },
    { ...payload, email: "grace@example.test" },
    { ...payload, phone: "+44 20 1234 5678" },
    { ...payload, guestCount: 2 },
    { ...payload, notes: "Late arrival" },
    { ...payload, expectedArrivalTime: "16:00" },
    { ...payload, expectedDepartureTime: null },
    { ...payload, expectedDetailsRevision: 4 },
    { ...payload, propertyId: "property-b" },
    { ...payload, reservationId: "reservation-b" },
  ])("allocates a new operation when the edit intent changes", (changed) => {
    const first = resolveReservationGuestDetailsAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const next = resolveReservationGuestDetailsAttempt(
      first,
      changed,
      () => "operation-2",
    );

    expect(next.operationId).toBe("operation-2");
    expect(next.fingerprint).not.toBe(first.fingerprint);
  });
});
