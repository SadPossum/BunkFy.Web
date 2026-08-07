export type BedMutationAttempt = {
  fingerprint: string;
  operationId: string;
  expectedRoomVersion: number;
};

export type BedMutationAttemptInput = {
  propertyId: string;
  roomId: string;
  bedId?: string;
  expectedRoomVersion: number;
  labels: readonly string[];
};

export function resolveBedMutationAttempt(
  current: BedMutationAttempt | null,
  input: BedMutationAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): BedMutationAttempt {
  const fingerprint = JSON.stringify({
    action: input.bedId ? "bed-update" : "bed-batch-add",
    propertyId: input.propertyId,
    roomId: input.roomId,
    bedId: input.bedId ?? null,
    labels: input.labels.map((label) => label.trim()),
  });

  return current?.fingerprint === fingerprint
    ? current
    : {
        fingerprint,
        operationId: createOperationId(),
        expectedRoomVersion: input.expectedRoomVersion,
      };
}
