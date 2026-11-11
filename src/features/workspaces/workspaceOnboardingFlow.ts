import type { OrganizationMembershipSummary } from "../../api/types";
import { completeCurrentStaffProfile, type StaffProfileDraft } from "./staffOnboarding";
import { waitForWorkspaceAccess } from "./workspaceAccess";
import type { WorkspaceCreationAttempt } from "./workspaceCreationAttempt";
import { loadAllWorkspaces } from "./workspacesApi";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export type WorkspaceOnboardingContinuation = {
  request: ApiRequest;
  workspaceId: string;
  staffProfile: StaffProfileDraft;
  selectWorkspace: (workspaceId: string) => void;
  refetchWorkspaces: () => Promise<void>;
  setSelectedWorkspaceId: (workspaceId: string) => void;
  clearCreationAttempt: () => Promise<void>;
};

export type WorkspaceOnboardingContinuationServices = {
  waitForAccess?: typeof waitForWorkspaceAccess;
  completeStaffProfile?: typeof completeCurrentStaffProfile;
};

/**
 * The create operation id is also the organization id. A persisted attempt can
 * therefore reconcile an acknowledged create after a same-tab page reload.
 * Use the account's membership catalogue: looking up a not-yet-created ID
 * directly is forbidden because the account has no membership in it yet.
 */
export async function recoverCreatedWorkspace(
  request: ApiRequest,
  attempt: WorkspaceCreationAttempt,
): Promise<OrganizationMembershipSummary | null> {
  const workspaces = await loadAllWorkspaces(request);
  return workspaces.find(workspace =>
    workspace.organization.organizationId.toLowerCase() === attempt.operationId.toLowerCase(),
  ) ?? null;
}

/**
 * The creation marker is deliberately cleared last. Every earlier step is
 * safe to resume after a same-tab reload using the persisted operation id.
 */
export async function continueWorkspaceOnboarding(
  continuation: WorkspaceOnboardingContinuation,
  services: WorkspaceOnboardingContinuationServices = {},
): Promise<void> {
  const waitForAccess = services.waitForAccess ?? waitForWorkspaceAccess;
  const completeStaffProfile =
    services.completeStaffProfile ?? completeCurrentStaffProfile;

  continuation.selectWorkspace(continuation.workspaceId);
  continuation.setSelectedWorkspaceId(continuation.workspaceId);
  await waitForAccess(continuation.request, continuation.workspaceId);
  await continuation.refetchWorkspaces();
  await completeStaffProfile(continuation.request, continuation.staffProfile);
  await continuation.clearCreationAttempt();
}
