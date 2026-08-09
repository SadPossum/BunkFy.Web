export type CredentialIssueAttemptPayload = {
  propertyId: string;
  connectionId: string;
  label: string;
  expiresAtUtc: string | null;
  defaultSourceSystem: string;
  sourceSystem?: string | null;
};

export type CredentialRevokeAttemptPayload = {
  propertyId: string;
  connectionId: string;
  credentialId: string;
  expectedVersion: number;
};

export type CredentialMutationAttempt = {
  fingerprint: string;
  operationId: string;
};

export type CredentialIssuanceOutcomeKey =
  | "issued"
  | "already-issued"
  | "unknown";

export function credentialIssuanceOutcomeKey(
  outcome: number | string,
): CredentialIssuanceOutcomeKey {
  if (typeof outcome === "number") {
    return outcome === 1 ? "issued" : outcome === 2 ? "already-issued" : "unknown";
  }

  const normalized = outcome.replace(/[\s_-]/g, "").toLowerCase();
  return normalized === "issued"
    ? "issued"
    : normalized === "alreadyissued"
      ? "already-issued"
      : "unknown";
}

export function resolveCredentialIssueAttempt(
  current: CredentialMutationAttempt | null,
  payload: CredentialIssueAttemptPayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): CredentialMutationAttempt {
  return resolveAttempt(
    current,
    credentialIssueFingerprint(payload),
    createOperationId,
  );
}

export function resolveCredentialRevokeAttempt(
  current: CredentialMutationAttempt | null,
  payload: CredentialRevokeAttemptPayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): CredentialMutationAttempt {
  return resolveAttempt(
    current,
    credentialRevokeFingerprint(payload),
    createOperationId,
  );
}

export function credentialIssueFingerprint(
  payload: CredentialIssueAttemptPayload,
): string {
  const sourceSystem = payload.sourceSystem ?? payload.defaultSourceSystem;
  return JSON.stringify({
    propertyId: normalizeId(payload.propertyId),
    connectionId: normalizeId(payload.connectionId),
    label: payload.label.trim(),
    expiresAtUtc: payload.expiresAtUtc
      ? new Date(payload.expiresAtUtc).toISOString()
      : null,
    sourceSystem: sourceSystem.trim().toLowerCase(),
  });
}

export function credentialRevokeFingerprint(
  payload: CredentialRevokeAttemptPayload,
): string {
  return JSON.stringify({
    propertyId: normalizeId(payload.propertyId),
    connectionId: normalizeId(payload.connectionId),
    credentialId: normalizeId(payload.credentialId),
    expectedVersion: payload.expectedVersion,
  });
}

function resolveAttempt(
  current: CredentialMutationAttempt | null,
  fingerprint: string,
  createOperationId: () => string,
): CredentialMutationAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
