import { ApiError } from "../../api/client";
import type { GuestProfile, Reservation, ReservationMutationReceipt } from "../../api/types";
import type { GuestCreatePayload } from "../guests/guestCreateAttempt";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export type GuestRecordWritePayload = GuestCreatePayload;

export type GuestRecordProfileDetails = {
  legalName?: string | null;
  dateOfBirth?: string | null;
  nationalityCountryCode?: string | null;
  preferredLanguageTag?: string | null;
  notes?: string | null;
};

type CreateAndLinkGuestRecordOptions = {
  operationId: string;
  profile: GuestRecordWritePayload;
  timeoutMs?: number;
  retryDelayMs?: number;
};

type ReservationMutationTarget = Pick<ReservationMutationReceipt, "reservationId" | "version">;

export class GuestRecordLinkError extends Error {
  constructor(
    public readonly guest: GuestProfile,
    cause: unknown,
  ) {
    super(`The Guest Record was created, but it could not be linked to the reservation: ${errorMessage(cause)}`);
    this.name = "GuestRecordLinkError";
  }
}

export function hasPrimaryGuestRecord(reservation: Pick<Reservation, "guests">): boolean {
  return reservation.guests.some((guest) => guest.role === 1 || String(guest.role).toLowerCase() === "primary");
}

export function guestRecordPayloadFromBooking(
  booking: Pick<Reservation, "primaryGuestName" | "email" | "phone">,
  details: GuestRecordProfileDetails = {},
): GuestRecordWritePayload {
  return {
    displayName: booking.primaryGuestName.trim(),
    legalName: emptyToNull(details.legalName),
    email: emptyToNull(booking.email),
    phone: emptyToNull(booking.phone),
    dateOfBirth: emptyToNull(details.dateOfBirth),
    nationalityCountryCode: emptyToNull(details.nationalityCountryCode)?.toUpperCase() ?? null,
    preferredLanguageTag: emptyToNull(details.preferredLanguageTag),
    notes: emptyToNull(details.notes),
  };
}

export async function createAndLinkGuestRecord(
  request: ApiRequest,
  propertyId: string,
  reservation: ReservationMutationTarget,
  options: CreateAndLinkGuestRecordOptions,
): Promise<{ guest: GuestProfile; reservation: ReservationMutationReceipt }> {
  const guest = await request<GuestProfile>(`/api/guests/properties/${propertyId}`, {
    method: "POST",
    body: JSON.stringify({ ...options.profile, operationId: options.operationId }),
  });

  try {
    const linkedReservation = await linkGuestRecord(
      request,
      propertyId,
      reservation,
      guest.guestId,
      options,
    );
    return { guest, reservation: linkedReservation };
  } catch (error) {
    throw new GuestRecordLinkError(guest, error);
  }
}

export async function linkGuestRecord(
  request: ApiRequest,
  propertyId: string,
  initialReservation: ReservationMutationTarget,
  guestId: string,
  options: Pick<CreateAndLinkGuestRecordOptions, "timeoutMs" | "retryDelayMs"> = {},
): Promise<ReservationMutationReceipt> {
  const deadline = Date.now() + (options.timeoutMs ?? 12_000);
  const retryDelayMs = options.retryDelayMs ?? 300;
  let reservation = initialReservation;

  while (true) {
    try {
      return await request<ReservationMutationReceipt>(
        `/api/reservations/properties/${propertyId}/${reservation.reservationId}/guests`,
        {
          method: "PUT",
          body: JSON.stringify({
            guestId,
            role: 1,
            replaceExistingRole: false,
            expectedVersion: reservation.version,
          }),
        },
      );
    } catch (error) {
      if (!isConvergenceError(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => globalThis.setTimeout(resolve, retryDelayMs));
      reservation = await request<Reservation>(
        `/api/reservations/properties/${propertyId}/${reservation.reservationId}`,
      );
    }
  }
}

function isConvergenceError(error: unknown): boolean {
  return error instanceof ApiError && (
    error.code === "Reservations.GuestNotLinkable" ||
    error.code === "Reservations.VersionConflict"
  );
}

function emptyToNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
