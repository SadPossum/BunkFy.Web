export type PropertyUpdatePayload = {
  propertyId: string;
  expectedVersion: number;
  name: string;
  code: string;
  timeZoneId: string;
};

export type PropertyUpdateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolvePropertyUpdateAttempt(
  current: PropertyUpdateAttempt | null,
  payload: PropertyUpdatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): PropertyUpdateAttempt {
  const fingerprint = propertyUpdateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function propertyUpdateFingerprint(
  payload: PropertyUpdatePayload,
): string {
  return JSON.stringify({
    propertyId: payload.propertyId,
    expectedVersion: payload.expectedVersion,
    name: payload.name.trim(),
    code: payload.code.trim().toLowerCase(),
    timeZoneId: payload.timeZoneId.trim(),
  });
}
