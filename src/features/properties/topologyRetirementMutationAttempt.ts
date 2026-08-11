export type TopologyRetirementMutationAttempt = {
  fingerprint: string;
  operationId: string;
};

export type TopologyRetirementRequestAttemptInput = {
  propertyId: string;
  targetKind: "bed" | "room";
  roomId: string;
  targetId: string;
  reason: string;
};

export type TopologyRetirementRetryAttemptInput = {
  propertyId: string;
  targetKind: "bed" | "room";
  topologyChangeId: string;
  expectedVersion: number;
};

export type TopologyRetirementCancellationAttemptInput = {
  propertyId: string;
  targetKind: "bed" | "room";
  topologyChangeId: string;
  expectedVersion: number;
  reason: string;
};

export type TopologyRetirementRequestPayload = {
  operationId: string;
  confirmed: true;
  reason: string;
};

export type TopologyRetirementCancellationPayload = TopologyRetirementRequestPayload & {
  expectedVersion: number;
};

export function resolveTopologyRetirementRequestAttempt(
  current: TopologyRetirementMutationAttempt | null,
  input: TopologyRetirementRequestAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): TopologyRetirementMutationAttempt {
  return resolveAttempt(
    current,
    JSON.stringify({
      action: `${input.targetKind}-retirement-request`,
      propertyId: normalizeId(input.propertyId),
      roomId: normalizeId(input.roomId),
      targetId: normalizeId(input.targetId),
      reason: input.reason.trim(),
    }),
    createOperationId,
  );
}

export function resolveTopologyRetirementRetryAttempt(
  current: TopologyRetirementMutationAttempt | null,
  input: TopologyRetirementRetryAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): TopologyRetirementMutationAttempt {
  return resolveAttempt(
    current,
    JSON.stringify({
      action: `${input.targetKind}-retirement-retry`,
      propertyId: normalizeId(input.propertyId),
      topologyChangeId: normalizeId(input.topologyChangeId),
      expectedVersion: input.expectedVersion,
    }),
    createOperationId,
  );
}

export function resolveTopologyRetirementCancellationAttempt(
  current: TopologyRetirementMutationAttempt | null,
  input: TopologyRetirementCancellationAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): TopologyRetirementMutationAttempt {
  return resolveAttempt(
    current,
    JSON.stringify({
      action: `${input.targetKind}-retirement-cancellation`,
      propertyId: normalizeId(input.propertyId),
      topologyChangeId: normalizeId(input.topologyChangeId),
      expectedVersion: input.expectedVersion,
      reason: input.reason.trim(),
    }),
    createOperationId,
  );
}

export function topologyRetirementRequestPayload(
  attempt: TopologyRetirementMutationAttempt,
  reason: string,
): TopologyRetirementRequestPayload {
  return {
    operationId: attempt.operationId,
    confirmed: true,
    reason: reason.trim(),
  };
}

export function topologyRetirementCancellationPayload(
  attempt: TopologyRetirementMutationAttempt,
  expectedVersion: number,
  reason: string,
): TopologyRetirementCancellationPayload {
  return {
    operationId: attempt.operationId,
    expectedVersion,
    confirmed: true,
    reason: reason.trim(),
  };
}

function resolveAttempt(
  current: TopologyRetirementMutationAttempt | null,
  fingerprint: string,
  createOperationId: () => string,
): TopologyRetirementMutationAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
