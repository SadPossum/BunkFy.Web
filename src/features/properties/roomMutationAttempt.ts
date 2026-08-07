export type RoomMutationAttempt = {
  fingerprint: string;
  operationId: string;
  expectedVersion: number;
};

export type RoomMutationAttemptInput = {
  propertyId: string;
  roomId?: string;
  expectedVersion: number;
  name: string;
  buildingLabel: string;
  floorLabel: string;
};

export function resolveRoomMutationAttempt(
  current: RoomMutationAttempt | null,
  input: RoomMutationAttemptInput,
  createOperationId: () => string = () => crypto.randomUUID(),
): RoomMutationAttempt {
  const fingerprint = JSON.stringify({
    action: input.roomId ? "room-update" : "room-create",
    propertyId: input.propertyId,
    roomId: input.roomId ?? null,
    name: input.name.trim(),
    buildingLabel: normalizeOptional(input.buildingLabel),
    floorLabel: normalizeOptional(input.floorLabel),
  });

  return current?.fingerprint === fingerprint
    ? current
    : {
        fingerprint,
        operationId: createOperationId(),
        expectedVersion: input.expectedVersion,
      };
}

function normalizeOptional(value: string): string | null {
  const normalized = value.trim();
  return normalized || null;
}
