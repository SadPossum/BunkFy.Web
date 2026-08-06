export type ReservationCreatePayload = {
  arrival: string;
  departure: string;
  expectedArrivalTime: string | null;
  expectedDepartureTime: string | null;
  inventoryUnitIds: string[];
  primaryGuestName: string;
  email: string | null;
  phone: string | null;
  guestCount: number;
  sourceKind: number;
  sourceSystem: string | null;
  sourceReference: string | null;
  notes: string | null;
};

export type ReservationCreateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveReservationCreateAttempt(
  current: ReservationCreateAttempt | null,
  payload: ReservationCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ReservationCreateAttempt {
  const fingerprint = reservationCreateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function reservationCreateFingerprint(payload: ReservationCreatePayload) {
  return JSON.stringify({
    ...payload,
    inventoryUnitIds: [...payload.inventoryUnitIds].sort(),
    primaryGuestName: payload.primaryGuestName.trim(),
    email: normalizeOptional(payload.email),
    phone: normalizeOptional(payload.phone),
    sourceSystem: normalizeOptional(payload.sourceSystem)?.toLowerCase() ?? null,
    sourceReference: normalizeOptional(payload.sourceReference),
    notes: normalizeOptional(payload.notes),
  });
}

function normalizeOptional(value: string | null) {
  return value?.trim() || null;
}
