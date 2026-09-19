export type WorkspaceSettingsTab =
  | "general"
  | "members"
  | "roles"
  | "invites"
  | "retention";

export type WorkspaceJoiningView = "invite" | "qr" | "requests";

export type WorkspaceSettingsCapabilities = {
  canReadMembers: boolean;
  canReadRoles: boolean;
  canManageRoles: boolean;
  canManageInvites: boolean;
  canReadRetention: boolean;
  canRetryRetention: boolean;
};

export function resolveWorkspaceSettingsCapabilities({
  owner,
  profilesRead,
  profilesManage,
  staffOnboardingManage,
  retentionRead,
  retentionRetry,
}: {
  owner: boolean;
  profilesRead: boolean;
  profilesManage: boolean;
  staffOnboardingManage: boolean;
  retentionRead: boolean;
  retentionRetry: boolean;
}): WorkspaceSettingsCapabilities {
  return {
    canReadMembers: owner,
    canReadRoles: owner || profilesRead,
    canManageRoles: owner || profilesManage,
    canManageInvites: owner || (staffOnboardingManage && profilesRead),
    canReadRetention: owner || retentionRead,
    canRetryRetention: owner || retentionRetry,
  };
}

export function canOpenWorkspaceSettingsTab(
  tab: WorkspaceSettingsTab,
  capabilities: WorkspaceSettingsCapabilities,
): boolean {
  switch (tab) {
    case "general":
      return true;
    case "members":
      return capabilities.canReadMembers;
    case "roles":
      return capabilities.canReadRoles;
    case "invites":
      return capabilities.canManageInvites;
    case "retention":
      return capabilities.canReadRetention;
  }
}

export function shouldRedirectWorkspaceSettingsTab(
  tab: WorkspaceSettingsTab,
  capabilities: WorkspaceSettingsCapabilities,
  authorityCurrent: boolean,
): boolean {
  return authorityCurrent && !canOpenWorkspaceSettingsTab(tab, capabilities);
}

export function workspaceSettingsTab(value: string | null): WorkspaceSettingsTab {
  return value === "members" || value === "roles" || value === "invites" || value === "retention"
    ? value
    : "general";
}

export function workspaceJoiningView(value: string | null): WorkspaceJoiningView {
  return value === "qr" || value === "requests" ? value : "invite";
}
