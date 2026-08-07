import {
  guestCreateFingerprint,
  type GuestCreatePayload,
} from "./guestCreateAttempt";

export type GuestManagementAttempt = {
  fingerprint: string;
  operationId: string;
};

export function resolveGuestUpdateAttempt(
  current: GuestManagementAttempt | null,
  propertyId: string,
  guestId: string,
  expectedVersion: number,
  payload: GuestCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): GuestManagementAttempt {
  return resolveAttempt(
    current,
    JSON.stringify({
      kind: "update",
      guestId,
      expectedVersion,
      profile: guestCreateFingerprint(propertyId, payload),
    }),
    createOperationId,
  );
}

export function resolveGuestArchiveAttempt(
  current: GuestManagementAttempt | null,
  propertyId: string,
  guestId: string,
  expectedVersion: number,
  createOperationId: () => string = () => crypto.randomUUID(),
): GuestManagementAttempt {
  return resolveAttempt(
    current,
    JSON.stringify({
      kind: "archive",
      propertyId,
      guestId,
      expectedVersion,
    }),
    createOperationId,
  );
}

function resolveAttempt(
  current: GuestManagementAttempt | null,
  fingerprint: string,
  createOperationId: () => string,
): GuestManagementAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createOperationId() };
}
