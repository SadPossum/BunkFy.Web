import type {
  StaffDirectoryAssignment,
  StaffDirectoryMember,
  StaffMember,
  StaffPropertyAssignment,
  StaffStatus,
} from "../../api/types";
import type { StaffAuthSubjectTransitionStatus } from "./staffAuthSubjectTransition";

export type StaffDetailMember = StaffDirectoryMember | StaffMember;
export type StaffAssignment = StaffDirectoryAssignment | StaffPropertyAssignment;

export function isFullStaffMember(member: StaffDetailMember): member is StaffMember {
  return "createdAtUtc" in member;
}

export function isFullStaffAssignment(
  assignment: StaffAssignment,
): assignment is StaffPropertyAssignment {
  return "assignedAtUtc" in assignment;
}

export function assignmentIsCurrent(assignment: StaffAssignment): boolean {
  return isFullStaffAssignment(assignment) ? assignment.isCurrent : true;
}

export function staffStatusKey(
  status: StaffStatus,
): StaffAuthSubjectTransitionStatus {
  if (typeof status === "string") {
    const normalized = status.toLowerCase();
    return normalized === "active" || normalized === "suspended" || normalized === "departed"
      ? normalized
      : "unknown";
  }

  return ({
    1: "active",
    2: "suspended",
    3: "departed",
  } as Record<number, StaffAuthSubjectTransitionStatus>)[status] ?? "unknown";
}

export function staffDetailTab(
  value: string | null,
): "profile" | "assignments" | "account" {
  return value === "assignments" || value === "account" ? value : "profile";
}

export function utcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatStaffDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
