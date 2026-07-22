import type { WorkspaceStaffJoinSource } from "../../api/types";

export function joinSourceStatusLabel(status: WorkspaceStaffJoinSource["status"]): string {
  return {
    0: "unknown",
    1: "active",
    2: "accepted",
    3: "revoked",
    4: "superseded",
    5: "expired",
    6: "disabled",
    7: "capacity reached",
  }[status] ?? "unknown";
}

export function canReplaceJoinSource(
  sourceKind: WorkspaceStaffJoinSource["sourceKind"],
  status: WorkspaceStaffJoinSource["status"],
): boolean {
  if (sourceKind === 1) return status === 1 || status === 3 || status === 4 || status === 5;
  if (sourceKind === 2) return status === 1 || status === 4 || status === 5 || status === 6 || status === 7;
  return false;
}

export function isActiveJoinSource(status: WorkspaceStaffJoinSource["status"]): boolean {
  return status === 1;
}
