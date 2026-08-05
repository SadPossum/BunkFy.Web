export type WorkspaceSettingsTab =
  | "general"
  | "members"
  | "roles"
  | "invites"
  | "retention";

export type WorkspaceSettingsCapabilities = {
  canReadMembers: boolean;
  canReadRoles: boolean;
  canManageRoles: boolean;
  canManageInvites: boolean;
  canReadRetention: boolean;
};

export function resolveWorkspaceSettingsCapabilities({
  owner,
  profilesRead,
  profilesManage,
  staffManage,
  retentionRead,
}: {
  owner: boolean;
  profilesRead: boolean;
  profilesManage: boolean;
  staffManage: boolean;
  retentionRead: boolean;
}): WorkspaceSettingsCapabilities {
  return {
    canReadMembers: owner,
    canReadRoles: owner || profilesRead,
    canManageRoles: owner || profilesManage,
    canManageInvites: owner || (staffManage && profilesRead),
    canReadRetention: owner || retentionRead,
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
