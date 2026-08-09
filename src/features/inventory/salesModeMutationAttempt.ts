export type SalesModeMutationAttempt = {
  fingerprint: string;
  operationId: string;
  expectedVersion: number;
};

export type SalesModeMutationAttemptInput = {
  propertyId: string;
  roomId: string;
  salesMode: "roomLevel" | "bedLevel";
  expectedVersion: number;
};

export function resolveSalesModeMutationAttempt(
  current: SalesModeMutationAttempt | null,
  input: SalesModeMutationAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): SalesModeMutationAttempt {
  const fingerprint = JSON.stringify({
    action: "room-sales-mode",
    propertyId: input.propertyId.toLowerCase(),
    roomId: input.roomId.toLowerCase(),
    salesMode: input.salesMode,
  });

  return current?.fingerprint === fingerprint
    ? current
    : {
        fingerprint,
        operationId: createOperationId(),
        expectedVersion: input.expectedVersion,
      };
}
