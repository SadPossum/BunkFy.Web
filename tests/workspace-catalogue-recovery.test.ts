import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  reconcileSelectedWorkspaceId,
  resolveWorkspaceGateMode,
} from "../src/features/workspaces/workspaceCatalogue";

const repositoryRoot = process.cwd();

function source(path: string): string {
  return readFileSync(join(repositoryRoot, "src", ...path.split("/")), "utf8");
}

describe("workspace catalogue recovery", () => {
  it("preserves the selected tenant until catalogue evidence is current", () => {
    expect(reconcileSelectedWorkspaceId("workspace-a", [], false)).toBe("workspace-a");
    expect(reconcileSelectedWorkspaceId("workspace-a", ["workspace-b"], false)).toBe("workspace-a");
    expect(reconcileSelectedWorkspaceId("workspace-a", ["workspace-a", "workspace-b"], true)).toBe("workspace-a");
    expect(reconcileSelectedWorkspaceId("workspace-a", ["workspace-b"], true)).toBe("workspace-b");
    expect(reconcileSelectedWorkspaceId("workspace-a", [], true)).toBe("");
  });

  it("keeps explicit join and create routes independent from catalogue availability", () => {
    expect(resolveWorkspaceGateMode("/join", "unavailable", 0, false, false)).toBe("join");
    expect(resolveWorkspaceGateMode("/workspace/new", "loading", 0, false, false)).toBe("create");
    expect(resolveWorkspaceGateMode("/", "loading", 0, false, false)).toBe("loading");
    expect(resolveWorkspaceGateMode("/", "unavailable", 0, false, false)).toBe("unavailable");
    expect(resolveWorkspaceGateMode("/", "stale", 0, false, false)).toBe("create");
    expect(resolveWorkspaceGateMode("/", "stale", 0, false, true)).toBe("unavailable");
    expect(resolveWorkspaceGateMode("/", "ready", 1, false, true)).toBe("loading");
    expect(resolveWorkspaceGateMode("/", "stale", 1, false, true)).toBe("unavailable");
    expect(resolveWorkspaceGateMode("/", "stale", 1, true, true)).toBe("app");
  });

  it("uses bounded shell recovery instead of raw catalogue errors", () => {
    const provider = source("app/workspace.tsx");
    const gate = source("features/workspaces/WorkspaceGate.tsx");
    const shell = source("components/layout/AppShell.tsx");

    expect(provider).toContain("reconcileSelectedWorkspaceId(");
    expect(provider).toContain("if (!workspaceCatalogueCurrent) return");
    expect(provider).toContain("workspacesLoaded: workspacesQuery.data !== undefined");
    expect(provider).toContain("workspacesFetching: workspacesQuery.isFetching");
    expect(gate).toContain("resolveWorkspaceGateMode(");
    expect(gate).not.toContain("workspacesError instanceof Error");
    expect(shell).toContain("<CompositeSourceNotice");
    expect(shell).toContain("Workspace updates delayed");
  });

  it("requires current catalogue evidence for owner-derived commands", () => {
    const settings = source("features/workspaces/WorkspaceSettingsPage.tsx");
    const members = source("features/workspaces/WorkspaceMembersSettings.tsx");

    expect(settings).toContain("const workspaceAuthorityCurrent = compositeSourceCurrent(workspaceSource)");
    expect(settings).toContain("workspaceAuthorityCurrent && (");
    expect(settings).toContain("authorityCurrent={workspaceAuthorityCurrent}");
    expect(members).toContain("authorityCurrent && workspaceAccessSourcesCurrent([");
    expect(members).toContain("const transferAuthorityCurrent = authorityCurrent && membersCurrent");
  });
});
