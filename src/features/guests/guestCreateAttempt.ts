export type GuestCreatePayload = {
  displayName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  nationalityCountryCode: string | null;
  preferredLanguageTag: string | null;
  notes: string | null;
};

export type GuestCreateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveGuestCreateAttempt(
  current: GuestCreateAttempt | null,
  propertyId: string,
  payload: GuestCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): GuestCreateAttempt {
  const fingerprint = guestCreateFingerprint(propertyId, payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function guestCreateFingerprint(
  propertyId: string,
  payload: GuestCreatePayload,
): string {
  return JSON.stringify({
    propertyId,
    displayName: payload.displayName.trim(),
    legalName: normalizeOptional(payload.legalName),
    email: normalizeOptional(payload.email)?.toLowerCase() ?? null,
    phone: normalizeOptional(payload.phone),
    dateOfBirth: normalizeOptional(payload.dateOfBirth),
    nationalityCountryCode: normalizeOptional(payload.nationalityCountryCode)?.toUpperCase() ?? null,
    preferredLanguageTag: normalizeOptional(payload.preferredLanguageTag),
    notes: normalizeOptional(payload.notes),
  });
}

function normalizeOptional(value: string | null): string | null {
  return value?.trim() || null;
}
