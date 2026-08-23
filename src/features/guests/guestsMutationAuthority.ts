import type { GuestProfile } from "../../api/types";

export type GuestMutationAction = "create" | "update" | "archive";

export type GuestMutationEvidence = {
  permissionsCurrent: boolean;
  guestCurrent?: boolean;
};

export function guestMutationAllowed(
  action: GuestMutationAction,
  evidence: GuestMutationEvidence,
): boolean {
  if (!evidence.permissionsCurrent) return false;
  return action === "create" || evidence.guestCurrent === true;
}

export function guestRecordMatches(
  current: GuestProfile | null | undefined,
  candidate: GuestProfile,
): boolean {
  return current?.guestId === candidate.guestId &&
    current.version === candidate.version &&
    current.lastChangedAtUtc === candidate.lastChangedAtUtc &&
    current.status === candidate.status;
}
