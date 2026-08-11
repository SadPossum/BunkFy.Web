import { describe, expect, it } from "vitest";
import {
  canOpenWorkspaceSettingsTab,
  resolveWorkspaceSettingsCapabilities,
} from "../src/features/workspaces/workspaceSettingsAccess";

describe("workspace settings access", () => {
  it("keeps organization membership governance owner-only", () => {
    const access = resolveWorkspaceSettingsCapabilities({
      owner: false,
      profilesRead: true,
      profilesManage: true,
      staffOnboardingManage: true,
      retentionRead: true,
    });

    expect(access.canReadMembers).toBe(false);
    expect(canOpenWorkspaceSettingsTab("members", access)).toBe(false);
  });

  it("allows role readers without exposing role mutations", () => {
    const access = resolveWorkspaceSettingsCapabilities({
      owner: false,
      profilesRead: true,
      profilesManage: false,
      staffOnboardingManage: false,
      retentionRead: false,
    });

    expect(access.canReadRoles).toBe(true);
    expect(access.canManageRoles).toBe(false);
    expect(canOpenWorkspaceSettingsTab("roles", access)).toBe(true);
  });

  it("requires both onboarding management and role visibility for invites", () => {
    const withoutProfiles = resolveWorkspaceSettingsCapabilities({
      owner: false,
      profilesRead: false,
      profilesManage: false,
      staffOnboardingManage: true,
      retentionRead: false,
    });
    const delegatedManager = resolveWorkspaceSettingsCapabilities({
      owner: false,
      profilesRead: true,
      profilesManage: false,
      staffOnboardingManage: true,
      retentionRead: false,
    });

    expect(withoutProfiles.canManageInvites).toBe(false);
    expect(delegatedManager.canManageInvites).toBe(true);
    expect(canOpenWorkspaceSettingsTab("invites", delegatedManager)).toBe(true);
  });

  it("gives owners every workspace settings capability without evaluated grants", () => {
    const access = resolveWorkspaceSettingsCapabilities({
      owner: true,
      profilesRead: false,
      profilesManage: false,
      staffOnboardingManage: false,
      retentionRead: false,
    });

    expect(Object.values(access).every(Boolean)).toBe(true);
  });
});
