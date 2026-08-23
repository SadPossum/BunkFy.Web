import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  workspaceAccessActionAllowed,
  workspaceAccessSourcesCurrent,
} from "../src/features/workspaces/workspaceAccessAuthority";

const repositoryRoot = process.cwd();

function sourceFile(name: string): string {
  return readFileSync(
    join(repositoryRoot, "src", "features", "workspaces", name),
    "utf8",
  );
}

function source(state: "loading" | "ready" | "stale" | "unavailable", isFetching = false) {
  return {
    label: "source",
    state,
    isFetching,
    refetch: async () => undefined,
  } as const;
}

describe("workspace access authority recovery", () => {
  it("requires every grant source to be ready and settled", () => {
    expect(workspaceAccessSourcesCurrent([source("ready"), source("ready")])).toBe(true);
    expect(workspaceAccessSourcesCurrent([source("ready", true)])).toBe(false);
    expect(workspaceAccessSourcesCurrent([source("ready"), source("stale")])).toBe(false);
    expect(workspaceAccessSourcesCurrent([source("ready"), source("unavailable")])).toBe(false);
  });

  it("keeps deny operations independent while grants require current authority and records", () => {
    expect(workspaceAccessActionAllowed("deny", false, false)).toBe(true);
    expect(workspaceAccessActionAllowed("grant", true, true)).toBe(true);
    expect(workspaceAccessActionAllowed("grant", false, true)).toBe(false);
    expect(workspaceAccessActionAllowed("grant", true, false)).toBe(false);
  });

  it("exposes permission and property freshness instead of inferring it from arrays", () => {
    const permissions = readFileSync(join(repositoryRoot, "src", "app", "permissions.ts"), "utf8");
    const workspace = readFileSync(join(repositoryRoot, "src", "app", "workspace.tsx"), "utf8");
    const settings = sourceFile("WorkspaceSettingsPage.tsx");

    expect(permissions).toContain("hasData: query.data !== undefined");
    expect(permissions).toContain("isFetching: query.isFetching");
    expect(workspace).toContain("propertiesLoaded: propertiesQuery.data !== undefined");
    expect(workspace).toContain("propertiesFetching: propertiesQuery.isFetching");
    expect(settings).toContain("const propertySource = createCompositeSource");
    expect(settings).toContain("permissionAuthorityCurrent");
  });

  it("keeps role lists usable but gates role mutations on current catalogues", () => {
    const roles = sourceFile("WorkspaceRolesSettings.tsx");

    expect(roles).toContain("const profilesUsable = compositeSourceUsable");
    expect(roles).toContain("sources={[catalogueSource, profileSource]}");
    expect(roles).toContain("disabled={!catalogueCurrent || !profilesCurrent}");
    expect(roles).not.toContain("catalogue.isLoading || profiles.isLoading");
  });

  it("requires current member, role, property, and assignment evidence for replacement", () => {
    const members = sourceFile("WorkspaceMembersSettings.tsx");

    expect(members).toContain("workspaceAccessSourcesCurrent([");
    expect(members).toContain("authoritySources={[memberSource, profileSource, propertySource]}");
    expect(members).toContain("const canSave = authorityCurrent && compositeSourceCurrent(accessSource)");
    expect(members).toContain("disabled={!canSave}");
  });

  it("keeps lifecycle denial independent from grant-producing invitation actions", () => {
    const invites = sourceFile("WorkspaceInvitesSettings.tsx");
    const requests = sourceFile("WorkspaceJoinRequestSettings.tsx");

    expect(invites).toContain("<JoinSourceLifecycle");
    expect(invites).toContain("canCreate={grantSourcesCurrent}");
    expect(invites).toContain('workspaceAccessActionAllowed(\n    "grant"');
    expect(invites).toContain('onClick={() => onAction("deny")}');
    expect(requests).toContain('action === "reject" ? "deny" : "grant"');
    expect(requests).toContain("!grantResolutionAllowed");
  });
});
