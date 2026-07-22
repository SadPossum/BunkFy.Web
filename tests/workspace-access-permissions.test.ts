import { describe, expect, it } from "vitest";
import type { WorkspaceAccessPermission } from "../src/api/types";
import { groupPermissions, updatePermissionSelection } from "../src/features/workspaces/workspaceAccessPermissions";

const permissions: WorkspaceAccessPermission[] = [
  permission("properties.read", "Properties"),
  permission("properties.manage", "Properties", ["properties.read"]),
  permission("staff.read", "Staff"),
  permission("staff.manage", "Staff", ["staff.read", "properties.manage"]),
];

describe("workspace access permission selection", () => {
  it("adds transitive requirements with a selected permission", () => {
    expect(updatePermissionSelection([], "staff.manage", true, permissions)).toEqual([
      "properties.read",
      "properties.manage",
      "staff.read",
      "staff.manage",
    ]);
  });

  it("removes permissions that depend on a removed requirement", () => {
    expect(updatePermissionSelection(
      permissions.map((item) => item.code),
      "properties.read",
      false,
      permissions,
    )).toEqual(["staff.read"]);
  });

  it("keeps catalogue grouping stable", () => {
    expect(groupPermissions(permissions).map((group) => group.group)).toEqual([
      "Properties",
      "Staff",
    ]);
  });
});

function permission(
  code: string,
  group: string,
  requiredPermissions: string[] = [],
): WorkspaceAccessPermission {
  return {
    code,
    group,
    label: code,
    description: code,
    isSensitive: false,
    requiredPermissions,
  };
}
