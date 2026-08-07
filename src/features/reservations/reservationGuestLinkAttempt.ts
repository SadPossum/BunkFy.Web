import type { LinkReservationGuestRequest } from "../../api/types";

export type ReservationGuestLinkAttemptPayload = LinkReservationGuestRequest & {
  propertyId: string;
  reservationId: string;
};

export type ReservationGuestLinkAttempt = {
  fingerprint: string;
  payload: ReservationGuestLinkAttemptPayload;
};

export function resolveReservationGuestLinkAttempt(
  current: ReservationGuestLinkAttempt | null,
  payload: ReservationGuestLinkAttemptPayload,
): ReservationGuestLinkAttempt {
  const fingerprint = JSON.stringify({
    propertyId: payload.propertyId,
    reservationId: payload.reservationId,
    guestId: payload.guestId,
    role: payload.role,
    replaceExistingRole: payload.replaceExistingRole,
  });

  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, payload };
}
