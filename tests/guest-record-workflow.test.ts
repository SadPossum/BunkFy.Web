import { describe, expect, it, vi } from "vitest";
import type { Reservation } from "../src/api/types";
import {
  createAndLinkGuestRecord,
  GuestRecordLinkError,
  guestRecordPayloadFromBooking,
  hasPrimaryGuestRecord,
  resolveReservationGuestRecordAttempt,
} from "../src/features/reservations/guestRecordWorkflow";

const reservation = {
  reservationId: "reservation-1",
  propertyId: "property-1",
  primaryGuestName: "  Maya Chen  ",
  email: " maya@example.com ",
  phone: " ",
  guests: [],
  version: 4,
} as unknown as Reservation;

const readyProcess = {
  operationId: "guest-operation-1",
  propertyId: "property-1",
  reservationId: "reservation-1",
  guestId: "guest-operation-1",
  status: 2,
  reviewReason: 1,
  revision: 2,
  dispatchRevision: 1,
  createdAtUtc: "2026-08-07T10:00:00Z",
  updatedAtUtc: "2026-08-07T10:00:01Z",
};

describe("guest record reservation workflow", () => {
  it("builds a minimal durable profile from booking contact details", () => {
    expect(guestRecordPayloadFromBooking(reservation)).toEqual({
      displayName: "Maya Chen",
      legalName: null,
      email: "maya@example.com",
      phone: null,
      dateOfBirth: null,
      nationalityCountryCode: null,
      preferredLanguageTag: null,
      notes: null,
    });
  });

  it("adds normalized durable profile details when staff provides them", () => {
    expect(guestRecordPayloadFromBooking(reservation, {
      legalName: "  Maya Lin Chen ",
      dateOfBirth: "1994-06-18",
      nationalityCountryCode: " gb ",
      preferredLanguageTag: " en-GB ",
      notes: "  Prefers a lower bunk. ",
    })).toEqual({
      displayName: "Maya Chen",
      legalName: "Maya Lin Chen",
      email: "maya@example.com",
      phone: null,
      dateOfBirth: "1994-06-18",
      nationalityCountryCode: "GB",
      preferredLanguageTag: "en-GB",
      notes: "Prefers a lower bunk.",
    });
  });

  it("recognizes numeric and named primary links", () => {
    expect(hasPrimaryGuestRecord({ guests: [{ guestId: "one", role: 1 }] })).toBe(true);
    expect(hasPrimaryGuestRecord({ guests: [{ guestId: "two", role: "primary" }] })).toBe(true);
    expect(hasPrimaryGuestRecord({ guests: [] })).toBe(false);
  });

  it("keeps one exact operation for the same Reservation intent", () => {
    const profile = guestRecordPayloadFromBooking(reservation);
    const first = resolveReservationGuestRecordAttempt(
      null,
      "property-1",
      reservation,
      profile,
      () => "operation-1",
    );
    const retry = resolveReservationGuestRecordAttempt(
      first,
      "property-1",
      { ...reservation, version: 99 },
      profile,
      () => "operation-2",
    );
    const anotherReservation = resolveReservationGuestRecordAttempt(
      retry,
      "property-1",
      { ...reservation, reservationId: "reservation-2" },
      profile,
      () => "operation-2",
    );

    expect(retry).toBe(first);
    expect(retry.expectedReservationVersion).toBe(4);
    expect(anotherReservation.operationId).toBe("operation-2");
  });

  it("starts one durable operation and waits for completion", async () => {
    const linkedReservation = {
      ...reservation,
      version: 5,
      guests: [{ guestId: "guest-operation-1", role: 1 }],
    } as Reservation;
    const request = vi.fn()
      .mockResolvedValueOnce(readyProcess)
      .mockResolvedValueOnce({ ...readyProcess, status: 3, revision: 3 })
      .mockResolvedValueOnce(linkedReservation);

    const result = await createAndLinkGuestRecord(request, "property-1", reservation, {
      operationId: "guest-operation-1",
      expectedReservationVersion: 4,
      profile: guestRecordPayloadFromBooking(reservation),
      timeoutMs: 100,
      retryDelayMs: 0,
    });

    expect(result).toEqual({
      guestId: "guest-operation-1",
      process: { ...readyProcess, status: 3, revision: 3 },
      reservation: linkedReservation,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/reservations/properties/property-1/reservation-1/guest-record",
      {
        method: "POST",
        body: expect.any(String),
      },
    );
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      ...guestRecordPayloadFromBooking(reservation),
      operationId: "guest-operation-1",
      expectedReservationVersion: 4,
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/reservations/properties/property-1/reservation-1/guest-record/guest-operation-1",
    );
  });

  it("follows the canonical process returned after a resumed start", async () => {
    const canonical = {
      ...readyProcess,
      operationId: "canonical-operation",
      guestId: "canonical-operation",
    };
    const linkedReservation = {
      ...reservation,
      guests: [{ guestId: "canonical-operation", role: 1 }],
    } as Reservation;
    const request = vi.fn()
      .mockResolvedValueOnce(canonical)
      .mockResolvedValueOnce({ ...canonical, status: 3 })
      .mockResolvedValueOnce(linkedReservation);

    const result = await createAndLinkGuestRecord(request, "property-1", reservation, {
      operationId: "fresh-browser-operation",
      expectedReservationVersion: reservation.version,
      profile: guestRecordPayloadFromBooking(reservation),
      timeoutMs: 100,
      retryDelayMs: 0,
    });

    expect(result.guestId).toBe("canonical-operation");
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/reservations/properties/property-1/reservation-1/guest-record/canonical-operation",
    );
  });

  it("surfaces a durable review state without falling back to browser linking", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      ...readyProcess,
      status: "needsReview",
      reviewReason: "guestRestricted",
    });

    await expect(createAndLinkGuestRecord(request, "property-1", reservation, {
      operationId: "guest-operation-1",
      expectedReservationVersion: 4,
      profile: guestRecordPayloadFromBooking(reservation),
    }))
      .rejects.toMatchObject({
        name: "GuestRecordLinkError",
        message: expect.stringContaining("guest processing is restricted"),
      });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.flatMap((call) => call[0])).not.toContain(
      "/api/guests/properties/property-1",
    );
  });

  it("uses staff-supplied profile details when creating the durable record", async () => {
    const linkedReservation = {
      ...reservation,
      guests: [{ guestId: "guest-operation-1", role: 1 }],
    } as Reservation;
    const profile = {
      displayName: "Maya Chen",
      legalName: "Maya Lin Chen",
      email: "maya@example.com",
      phone: null,
      dateOfBirth: "1994-06-18",
      nationalityCountryCode: "GB",
      preferredLanguageTag: "en-GB",
      notes: null,
    };
    const request = vi.fn()
      .mockResolvedValueOnce({ ...readyProcess, status: "completed" })
      .mockResolvedValueOnce(linkedReservation);

    await createAndLinkGuestRecord(request, "property-1", reservation, {
      operationId: "guest-operation-1",
      expectedReservationVersion: 4,
      profile,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/reservations/properties/property-1/reservation-1/guest-record",
      {
        method: "POST",
        body: JSON.stringify({
          ...profile,
          operationId: "guest-operation-1",
          expectedReservationVersion: 4,
        }),
      },
    );
  });

  it("stops bounded polling while the durable operation continues", async () => {
    const request = vi.fn().mockResolvedValueOnce(readyProcess);

    await expect(createAndLinkGuestRecord(request, "property-1", reservation, {
      operationId: "guest-operation-1",
      expectedReservationVersion: 4,
      profile: guestRecordPayloadFromBooking(reservation),
      timeoutMs: 0,
      retryDelayMs: 0,
    })).rejects.toBeInstanceOf(GuestRecordLinkError);

    expect(request).toHaveBeenCalledTimes(1);
  });
});
