export type DataRightsCaseCreatePayload = {
  scopeKey: string;
  requestedOperations: number;
  restrictionDirective: number;
  requesterRelationship: number;
};

export type DataRightsCaseCreateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveDataRightsCaseCreateAttempt(
  current: DataRightsCaseCreateAttempt | null,
  payload: DataRightsCaseCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): DataRightsCaseCreateAttempt {
  const fingerprint = dataRightsCaseCreateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function dataRightsCaseCreateFingerprint(
  payload: DataRightsCaseCreatePayload,
): string {
  return JSON.stringify({
    scopeKey: payload.scopeKey.trim(),
    requestedOperations: payload.requestedOperations,
    restrictionDirective: payload.restrictionDirective,
    requesterRelationship: payload.requesterRelationship,
  });
}
