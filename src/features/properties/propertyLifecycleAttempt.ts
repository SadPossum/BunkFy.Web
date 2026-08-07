import type { PropertyProcessingActivationInput } from "./propertyProcessing";

export type PropertyLifecycleAttempt = {
  fingerprint: string;
  operationId: string;
};

export type PropertySimpleLifecycleAction =
  | "processing-suspension"
  | "retirement";

export function resolvePropertyActivationAttempt(
  current: PropertyLifecycleAttempt | null,
  propertyId: string,
  input: PropertyProcessingActivationInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): PropertyLifecycleAttempt {
  const acknowledgements = [...input.acceptedAcknowledgements]
    .sort((left, right) =>
      compareOrdinal(left.acknowledgementId, right.acknowledgementId) ||
      left.acknowledgementVersion - right.acknowledgementVersion
    );
  const fingerprint = JSON.stringify({
    action: "processing-activation",
    propertyId,
    expectedVersion: input.expectedVersion,
    operatingCountryCode: input.operatingCountryCode,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    dataRegionId: input.dataRegionId,
    transferProfileId: input.transferProfileId,
    retentionPolicyId: input.retentionPolicyId,
    retentionPolicyVersion: input.retentionPolicyVersion,
    acknowledgements,
  });

  return resolveAttempt(current, fingerprint, createOperationId);
}

export function resolvePropertySimpleLifecycleAttempt(
  current: PropertyLifecycleAttempt | null,
  action: PropertySimpleLifecycleAction,
  propertyId: string,
  expectedVersion: number,
  createOperationId: () => string = () => crypto.randomUUID(),
): PropertyLifecycleAttempt {
  const fingerprint = JSON.stringify({
    action,
    propertyId,
    expectedVersion,
  });

  return resolveAttempt(current, fingerprint, createOperationId);
}

function resolveAttempt(
  current: PropertyLifecycleAttempt | null,
  fingerprint: string,
  createOperationId: () => string,
): PropertyLifecycleAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

function compareOrdinal(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
