import type { UpdateReservationGuestDetailsRequest } from "../../api/types";

export type ReservationGuestDetailsAttemptPayload = Omit<
  UpdateReservationGuestDetailsRequest,
  "operationId"
> & {
  propertyId: string;
  reservationId: string;
};

export type ReservationGuestDetailsAttempt = {
  fingerprint: string;
  operationId: string;
  payload: ReservationGuestDetailsAttemptPayload;
};

export function resolveReservationGuestDetailsAttempt(
  current: ReservationGuestDetailsAttempt | null,
  payload: ReservationGuestDetailsAttemptPayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ReservationGuestDetailsAttempt {
  const fingerprint = JSON.stringify({
    propertyId: payload.propertyId,
    reservationId: payload.reservationId,
    primaryGuestName: payload.primaryGuestName.trim(),
    email: normalizeOptional(payload.email),
    phone: normalizeOptional(payload.phone),
    guestCount: payload.guestCount,
    notes: normalizeOptional(payload.notes),
    expectedArrivalTime: normalizeOptional(payload.expectedArrivalTime),
    expectedDepartureTime: normalizeOptional(payload.expectedDepartureTime),
    expectedDetailsRevision: payload.expectedDetailsRevision,
  });

  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId(), payload };
}

function normalizeOptional(value: string | null) {
  return value?.trim() || null;
}
