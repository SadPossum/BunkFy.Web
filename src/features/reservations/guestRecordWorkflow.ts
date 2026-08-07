import { ApiError } from "../../api/client";
import type {
  Reservation,
  ReservationGuestRecordLinkProcess,
  ReservationGuestRecordWriteRequest,
  ReservationMutationReceipt,
} from "../../api/types";
import {
  guestCreateFingerprint,
  type GuestCreatePayload,
} from "../guests/guestCreateAttempt";

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
  expectedReservationVersion: number;
  profile: GuestRecordWritePayload;
  timeoutMs?: number;
  retryDelayMs?: number;
};

type ReservationMutationTarget = Pick<ReservationMutationReceipt, "reservationId" | "version">;

export type ReservationGuestRecordAttempt = {
  fingerprint: string;
  operationId: string;
  expectedReservationVersion: number;
};

export class GuestRecordLinkError extends Error {
  constructor(
    message: string,
    public readonly process: ReservationGuestRecordLinkProcess,
  ) {
    super(message);
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

export function resolveReservationGuestRecordAttempt(
  current: ReservationGuestRecordAttempt | null,
  propertyId: string,
  reservation: ReservationMutationTarget,
  profile: GuestRecordWritePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ReservationGuestRecordAttempt {
  const fingerprint = JSON.stringify({
    propertyId,
    reservationId: reservation.reservationId,
    profile: guestCreateFingerprint(propertyId, profile),
  });
  return current?.fingerprint === fingerprint
    ? current
    : {
        fingerprint,
        operationId: createOperationId(),
        expectedReservationVersion: reservation.version,
      };
}

export async function createAndLinkGuestRecord(
  request: ApiRequest,
  propertyId: string,
  reservation: ReservationMutationTarget,
  options: CreateAndLinkGuestRecordOptions,
): Promise<{
  guestId: string;
  process: ReservationGuestRecordLinkProcess;
  reservation: Reservation;
}> {
  const route = `/api/reservations/properties/${propertyId}/${reservation.reservationId}/guest-record`;
  const body: ReservationGuestRecordWriteRequest = {
    ...options.profile,
    operationId: options.operationId,
    expectedReservationVersion: options.expectedReservationVersion,
  };
  let process = await request<ReservationGuestRecordLinkProcess>(route, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const deadline = Date.now() + (options.timeoutMs ?? 12_000);
  let retryDelayMs = options.retryDelayMs ?? 300;
  while (guestRecordLinkStatus(process.status) === "pending" && Date.now() < deadline) {
    await delay(retryDelayMs);
    process = await request<ReservationGuestRecordLinkProcess>(
      `${route}/${process.operationId}`,
    );
    if (options.retryDelayMs === undefined) {
      retryDelayMs = Math.min(Math.ceil(retryDelayMs * 1.6), 1_500);
    }
  }

  const status = guestRecordLinkStatus(process.status);
  if (status === "review") {
    throw new GuestRecordLinkError(
      `The Guest Record is safe, but linking needs review: ${guestRecordReviewMessage(process.reviewReason)}`,
      process,
    );
  }

  if (status !== "completed") {
    throw new GuestRecordLinkError(
      "BunkFy is still linking the Guest Record. The operation will continue in the background.",
      process,
    );
  }

  const linkedReservation = await request<Reservation>(
    `/api/reservations/properties/${propertyId}/${reservation.reservationId}`,
  );
  return {
    guestId: process.guestId,
    process,
    reservation: linkedReservation,
  };
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

function guestRecordLinkStatus(status: number | string): "pending" | "completed" | "review" | "unknown" {
  const normalized = String(status).replace(/[\s_-]/g, "").toLowerCase();
  if (["1", "2", "prepared", "ready"].includes(normalized)) return "pending";
  if (["3", "completed"].includes(normalized)) return "completed";
  if (["4", "needsreview"].includes(normalized)) return "review";
  return "unknown";
}

function guestRecordReviewMessage(reason: number | string): string {
  const normalized = String(reason).replace(/[\s_-]/g, "").toLowerCase();
  return ({
    "2": "the reservation is no longer available",
    reservationunavailable: "the reservation is no longer available",
    "3": "another primary Guest Record is already linked",
    primaryguestoccupied: "another primary Guest Record is already linked",
    "4": "the Guest Record is no longer available",
    guestunavailable: "the Guest Record is no longer available",
    "5": "guest processing is restricted",
    guestrestricted: "guest processing is restricted",
    "6": "the current country policy does not allow this operation",
    countrypolicydenied: "the current country policy does not allow this operation",
    "7": "automatic retries were exhausted",
    retrylimitreached: "automatic retries were exhausted",
  } as Record<string, string>)[normalized] ?? "the current Reservation or Guest state needs attention";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function emptyToNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}
