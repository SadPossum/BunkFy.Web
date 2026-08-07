import { describe, expect, it } from "vitest";
import {
  resolveReservationGuestLinkAttempt,
  type ReservationGuestLinkAttemptPayload,
} from "../src/features/reservations/reservationGuestLinkAttempt";

const payload: ReservationGuestLinkAttemptPayload = {
  propertyId: "property-a",
  reservationId: "reservation-a",
  guestId: "guest-a",
  role: 1,
  replaceExistingRole: true,
  expectedVersion: 5,
};

describe("reservation guest-link attempt", () => {
  it("keeps the original version when live data advances during an uncertain retry", () => {
    const first = resolveReservationGuestLinkAttempt(null, payload);
    const retry = resolveReservationGuestLinkAttempt(first, {
      ...payload,
      expectedVersion: 6,
    });

    expect(retry).toBe(first);
    expect(retry.payload).toBe(payload);
    expect(retry.payload.expectedVersion).toBe(5);
  });

  it.each([
    { ...payload, propertyId: "property-b" },
    { ...payload, reservationId: "reservation-b" },
    { ...payload, guestId: "guest-b" },
    { ...payload, role: 0 as const },
    { ...payload, replaceExistingRole: false },
  ])("starts a new intent when the link target changes", (changed) => {
    const first = resolveReservationGuestLinkAttempt(null, payload);
    const next = resolveReservationGuestLinkAttempt(first, changed);

    expect(next).not.toBe(first);
    expect(next.payload).toBe(changed);
    expect(next.fingerprint).not.toBe(first.fingerprint);
  });
});
