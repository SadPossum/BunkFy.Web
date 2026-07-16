import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import type { GuestProfile, Reservation } from "../src/api/types";
import {
  createAndLinkGuestRecord,
  GuestRecordLinkError,
  guestRecordPayloadFromBooking,
  hasPrimaryGuestRecord,
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

const guest = {
  guestId: "guest-1",
  displayName: "Maya Chen",
} as GuestProfile;

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

  it("creates a profile and waits for the reservation projection before linking", async () => {
    const updatedReservation = { ...reservation, version: 5 } as Reservation;
    const linkedReservation = { ...updatedReservation, guests: [{ guestId: guest.guestId, role: 1 }] } as Reservation;
    const request = vi.fn()
      .mockResolvedValueOnce(guest)
      .mockRejectedValueOnce(new ApiError("Not visible yet", 409, "Reservations.GuestNotLinkable"))
      .mockResolvedValueOnce(updatedReservation)
      .mockResolvedValueOnce(linkedReservation);

    const result = await createAndLinkGuestRecord(request, "property-1", reservation, {
      timeoutMs: 100,
      retryDelayMs: 0,
    });

    expect(result).toEqual({ guest, reservation: linkedReservation });
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/api/reservations/properties/property-1/reservation-1/guests",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          guestId: "guest-1",
          role: 1,
          replaceExistingRole: false,
          expectedVersion: 5,
        }),
      }),
    );
  });

  it("reports a created but unlinked profile without hiding the partial success", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(guest)
      .mockRejectedValueOnce(new ApiError("Link denied", 403));

    await expect(createAndLinkGuestRecord(request, "property-1", reservation))
      .rejects.toBeInstanceOf(GuestRecordLinkError);
  });

  it("uses staff-supplied profile details when creating the durable record", async () => {
    const linkedReservation = { ...reservation, guests: [{ guestId: guest.guestId, role: 1 }] } as Reservation;
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
    const request = vi.fn().mockResolvedValueOnce(guest).mockResolvedValueOnce(linkedReservation);

    await createAndLinkGuestRecord(request, "property-1", reservation, { profile });

    expect(request).toHaveBeenNthCalledWith(1, "/api/guests/properties/property-1", {
      method: "POST",
      body: JSON.stringify(profile),
    });
  });
});
