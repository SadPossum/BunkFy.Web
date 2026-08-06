export type ReservationLifecycleAction =
  | "cancel"
  | "check-in"
  | "no-show"
  | "check-out";

export type ReservationLifecycleAttemptPayload = {
  propertyId: string;
  reservationId: string;
  action: ReservationLifecycleAction;
  businessDate: string | null;
  expectedVersion: number;
};

export type ReservationLifecycleAttempt = {
  fingerprint: string;
  operationId: string;
  payload: ReservationLifecycleAttemptPayload;
};

export function resolveReservationLifecycleAttempt(
  current: ReservationLifecycleAttempt | null,
  payload: ReservationLifecycleAttemptPayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ReservationLifecycleAttempt {
  const fingerprint = JSON.stringify({
    propertyId: payload.propertyId,
    reservationId: payload.reservationId,
    action: payload.action,
    businessDate: payload.businessDate,
  });
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId(), payload };
}
