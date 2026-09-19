import { describe, expect, it } from "vitest";
import {
  resolveReservationLifecycleAttempt,
  type ReservationLifecycleAttemptPayload,
} from "../src/features/reservations/reservationLifecycleAttempt";
import { defaultReservationBusinessDate } from "../src/features/reservations/reservationBusinessDate";

const payload: ReservationLifecycleAttemptPayload = {
  propertyId: "property-a",
  reservationId: "reservation-a",
  action: "check-in",
  businessDate: "2026-08-06",
  expectedVersion: 3,
};

describe("reservation lifecycle attempt", () => {
  it("reuses one operation id for an unchanged retry", () => {
    const first = resolveReservationLifecycleAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveReservationLifecycleAttempt(
      first,
      { ...payload },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.operationId).toBe("operation-1");
  });

  it("keeps the original request version when live data advances", () => {
    const first = resolveReservationLifecycleAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const retry = resolveReservationLifecycleAttempt(
      first,
      { ...payload, expectedVersion: 4 },
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.payload.expectedVersion).toBe(3);
  });

  it.each([
    [{ ...payload, action: "no-show" as const }],
    [{ ...payload, businessDate: "2026-08-07" }],
    [{ ...payload, propertyId: "property-b" }],
    [{ ...payload, reservationId: "reservation-b" }],
  ])("allocates a new operation id when the attempt changes", (changed) => {
    const first = resolveReservationLifecycleAttempt(
      null,
      payload,
      () => "operation-1",
    );
    const next = resolveReservationLifecycleAttempt(
      first,
      changed,
      () => "operation-2",
    );

    expect(next.operationId).toBe("operation-2");
    expect(next.fingerprint).not.toBe(first.fingerprint);
  });
});

describe("reservation lifecycle business date", () => {
  const reservation = {
    arrival: "2026-08-20",
    departure: "2026-08-27",
    checkedInBusinessDate: "2026-08-21",
  };

  it("uses the property date while keeping check-in inside the stay", () => {
    expect(defaultReservationBusinessDate("check-in", reservation, "2026-08-26"))
      .toBe("2026-08-26");
    expect(defaultReservationBusinessDate("check-in", reservation, "2026-08-30"))
      .toBe("2026-08-26");
    expect(defaultReservationBusinessDate("check-in", reservation, "2026-08-18"))
      .toBe("2026-08-20");
  });

  it("does not move checkout or no-show before the reservation lifecycle", () => {
    expect(defaultReservationBusinessDate("check-out", reservation, "2026-08-20"))
      .toBe("2026-08-21");
    expect(defaultReservationBusinessDate("no-show", reservation, "2026-08-18"))
      .toBe("2026-08-20");
    expect(defaultReservationBusinessDate("cancel", reservation, "2026-08-26"))
      .toBe("");
  });
});
