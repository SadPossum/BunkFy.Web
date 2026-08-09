import type { AdapterConnectionCreateRequest } from "../../api/types";

export type ConnectionCreatePayload = {
  propertyId: string;
  adapterType: string;
  executionMode: AdapterConnectionCreateRequest["executionMode"];
  conflictPolicy: AdapterConnectionCreateRequest["conflictPolicy"];
  configurationReference: string;
  secretReference: string | null;
};

export type ConnectionCreateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveConnectionCreateAttempt(
  current: ConnectionCreateAttempt | null,
  payload: ConnectionCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ConnectionCreateAttempt {
  const fingerprint = connectionCreateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function connectionCreateFingerprint(
  payload: ConnectionCreatePayload,
): string {
  return JSON.stringify({
    propertyId: payload.propertyId.trim().toLowerCase(),
    adapterType: payload.adapterType.trim().toLowerCase(),
    executionMode: payload.executionMode,
    conflictPolicy: payload.conflictPolicy,
    configurationReference: payload.configurationReference.trim(),
    secretReference: payload.secretReference?.trim() || null,
  });
}
