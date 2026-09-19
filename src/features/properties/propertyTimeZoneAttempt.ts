export type PropertyTimeZonePayload = {
  propertyId: string;
  expectedVersion: number;
  timeZoneId: string;
};

export type PropertyTimeZoneAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolvePropertyTimeZoneAttempt(
  current: PropertyTimeZoneAttempt | null,
  payload: PropertyTimeZonePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): PropertyTimeZoneAttempt {
  const fingerprint = JSON.stringify({
    propertyId: payload.propertyId,
    expectedVersion: payload.expectedVersion,
    timeZoneId: payload.timeZoneId.trim(),
  });

  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}
