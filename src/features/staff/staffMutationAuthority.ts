import type { Property, StaffMember } from "../../api/types";
import {
  staffStatusKey,
  type StaffDetailMember,
} from "./staffPresentation";

export type StaffMutationAction =
  | "create"
  | "update-profile"
  | "lifecycle"
  | "account-link"
  | "property-assignment";

export type StaffMutationEvidence = {
  permissionsCurrent: boolean;
  memberCurrent?: boolean;
  propertyCurrent?: boolean;
};

export function staffMutationAllowed(
  action: StaffMutationAction,
  evidence: StaffMutationEvidence,
): boolean {
  if (!evidence.permissionsCurrent) return false;
  if (action === "create") return true;
  if (evidence.memberCurrent !== true) return false;
  return action !== "property-assignment" || evidence.propertyCurrent === true;
}

export function staffRecordMatches(
  current: StaffDetailMember | null | undefined,
  candidate: StaffDetailMember,
): boolean {
  return current?.staffMemberId === candidate.staffMemberId &&
    current.version === candidate.version &&
    staffStatusKey(current.status) === staffStatusKey(candidate.status);
}

export function staffSensitiveRecordMatches(
  current: StaffMember | null | undefined,
  candidate: StaffMember,
): boolean {
  return staffRecordMatches(current, candidate) &&
    current?.lastChangedAtUtc === candidate.lastChangedAtUtc &&
    current?.authSubjectId === candidate.authSubjectId;
}

export function staffPropertyTargetMatches(
  properties: Property[],
  candidate: Property | null | undefined,
): boolean {
  if (!candidate) return false;
  return properties.some((property) =>
    property.propertyId === candidate.propertyId &&
    property.version === candidate.version &&
    property.status === candidate.status &&
    property.processingStatus === candidate.processingStatus);
}

export function staffLifecycleActionMatches(
  member: StaffDetailMember,
  action: "suspend" | "resume" | "depart",
): boolean {
  const status = staffStatusKey(member.status);
  if (action === "suspend") return status === "active";
  if (action === "resume") return status === "suspended";
  return status === "active" || status === "suspended";
}
