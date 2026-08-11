export type StaffAuthSubjectTransitionStatus =
  | "active"
  | "suspended"
  | "departed"
  | "unknown";

export type StaffAuthSubjectTransitionState = {
  canEdit: boolean;
  canClear: boolean;
  canRequestSuspension: boolean;
  attention: boolean;
  guidance: string;
};

export function resolveStaffAuthSubjectTransition(
  status: StaffAuthSubjectTransitionStatus,
  linked: boolean,
  canManageAccountLinks: boolean,
  canManageLifecycle: boolean,
): StaffAuthSubjectTransitionState {
  if (!canManageAccountLinks) {
    return readOnly(
      linked
        ? "This staff profile is linked to a sign-in account. Access and permissions are managed separately."
        : "No sign-in account is linked. Access and permissions are managed separately.",
    );
  }

  if (status === "departed") {
    return readOnly("Departed staff account links are read-only.");
  }

  if (status === "suspended") {
    return linked
      ? {
          canEdit: false,
          canClear: true,
          canRequestSuspension: false,
          attention: true,
          guidance:
            "Workspace access for this account was denied with the suspension. Clear the link before resuming if another account will be linked.",
        }
      : readOnly(
          "Resume this unlinked staff member before linking a new account. Workspace access must still be provisioned separately.",
          true,
        );
  }

  if (status === "active") {
    return linked
      ? {
          canEdit: false,
          canClear: false,
          canRequestSuspension: canManageLifecycle,
          attention: true,
          guidance:
            "Suspend this staff member before clearing the link. Suspension coordinates workspace access denial for the current account.",
        }
      : {
          canEdit: true,
          canClear: false,
          canRequestSuspension: false,
          attention: false,
          guidance:
            "Linking identifies the account for this staff profile. It does not grant workspace access or permissions.",
        };
  }

  return readOnly("The account link cannot be changed in the current staff state.");
}

function readOnly(
  guidance: string,
  attention = false,
): StaffAuthSubjectTransitionState {
  return {
    canEdit: false,
    canClear: false,
    canRequestSuspension: false,
    attention,
    guidance,
  };
}
