import {
  guestUpdateFingerprint,
  type GuestCreatePayload,
} from "./guestCreateAttempt";
import { ApiError } from "../../api/client";
import type { GuestProfile } from "../../api/types";

export type GuestManagementAttempt = {
  fingerprint: string;
  operationId: string;
};

export type GuestUpdateAttempt = Readonly<GuestManagementAttempt & {
  propertyId: string;
  guestId: string;
  expectedVersion: number;
  requestBody: string;
}>;

export function resolveGuestUpdateAttempt(
  current: GuestManagementAttempt | null,
  propertyId: string,
  guestId: string,
  expectedVersion: number,
  payload: GuestCreatePayload,
  createOperationId: () => string = () => crypto.randomUUID(),
): GuestUpdateAttempt {
  const identity = resolveAttempt(
    current,
    JSON.stringify({
      kind: "update",
      guestId,
      expectedVersion,
      profile: guestUpdateFingerprint(propertyId, payload),
    }),
    createOperationId,
  );
  if (identity === current && "requestBody" in identity) return identity as GuestUpdateAttempt;
  return Object.freeze({
    ...identity, propertyId, guestId, expectedVersion,
    requestBody: JSON.stringify({ ...payload, operationId: identity.operationId, expectedVersion }),
  });
}

export function guestUpdateRecoveryAllowed(attempt: GuestUpdateAttempt | null, evidence: {
  propertyId: string;
  guestId: string | null;
  permissionsCurrent: boolean;
  mayRead: boolean;
  mayManage: boolean;
  guestCurrent: boolean;
  guest: GuestProfile | null | undefined;
}): boolean {
  return Boolean(attempt && evidence.permissionsCurrent && evidence.mayRead && evidence.mayManage &&
    evidence.guestCurrent && evidence.propertyId === attempt.propertyId && evidence.guestId === attempt.guestId &&
    evidence.guest?.guestId === attempt.guestId && evidence.guest.status === 1 &&
    Number.isInteger(evidence.guest.version) && evidence.guest.version >= attempt.expectedVersion);
}

export function guestSaveResultUncertain(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
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
