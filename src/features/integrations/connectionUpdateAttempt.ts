import type { AdapterConnectionUpdateRequest } from "../../api/types";

export type ConnectionSettingsUpdate = Pick<
  AdapterConnectionUpdateRequest,
  | "executionMode"
  | "conflictPolicy"
  | "configurationReference"
  | "secretReference"
  | "clearSecretReference"
>;

export type ConnectionUpdatePayload = ConnectionSettingsUpdate & {
  propertyId: string;
  connectionId: string;
  expectedVersion: number;
};

export type ConnectionUpdateAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveConnectionUpdateAttempt(
  current: ConnectionUpdateAttempt | null,
  payload: ConnectionUpdatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): ConnectionUpdateAttempt {
  const fingerprint = connectionUpdateFingerprint(payload);
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

export function connectionUpdateFingerprint(
  payload: ConnectionUpdatePayload,
): string {
  const replacement = payload.secretReference?.trim() || null;
  const secretIntent = payload.clearSecretReference
    ? { mode: "clear", reference: null }
    : replacement
      ? { mode: "replace", reference: replacement }
      : { mode: "keep", reference: null };

  return JSON.stringify({
    propertyId: payload.propertyId.trim().toLowerCase(),
    connectionId: payload.connectionId.trim().toLowerCase(),
    expectedVersion: payload.expectedVersion,
    executionMode: payload.executionMode,
    conflictPolicy: payload.conflictPolicy,
    configurationReference: payload.configurationReference.trim(),
    secretIntent,
  });
}
