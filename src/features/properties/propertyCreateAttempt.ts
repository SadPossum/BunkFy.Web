export type PropertyCreatePayload = {
  name: string;
  code: string;
  timeZoneId: string;
};

export type PropertyCreateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolvePropertyCreateAttempt(
  current: PropertyCreateAttempt | null,
  payload: PropertyCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): PropertyCreateAttempt {
  const fingerprint = propertyCreateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function propertyCreateFingerprint(
  payload: PropertyCreatePayload,
): string {
  return JSON.stringify({
    name: payload.name.trim(),
    code: payload.code.trim().toLowerCase(),
    timeZoneId: payload.timeZoneId.trim(),
  });
}
