import type { WorkspaceAccessPermission } from "../../api/types";

export function updatePermissionSelection(
  selected: readonly string[],
  permissionCode: string,
  checked: boolean,
  catalogue: readonly WorkspaceAccessPermission[],
): string[] {
  const permissionByCode = new Map(catalogue.map((permission) => [permission.code, permission]));
  const next = new Set(selected.filter((code) => permissionByCode.has(code)));

  if (checked) {
    addWithRequirements(permissionCode, next, permissionByCode);
  } else {
    next.delete(permissionCode);
    removeDependants(next, permissionByCode);
  }

  return catalogue
    .map((permission) => permission.code)
    .filter((code) => next.has(code));
}

export function groupPermissions(
  catalogue: readonly WorkspaceAccessPermission[],
): Array<{ group: string; permissions: WorkspaceAccessPermission[] }> {
  const groups = new Map<string, WorkspaceAccessPermission[]>();
  for (const permission of catalogue) {
    const existing = groups.get(permission.group) ?? [];
    existing.push(permission);
    groups.set(permission.group, existing);
  }

  return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }));
}

function addWithRequirements(
  code: string,
  selected: Set<string>,
  permissionByCode: ReadonlyMap<string, WorkspaceAccessPermission>,
) {
  if (selected.has(code)) return;
  const permission = permissionByCode.get(code);
  if (!permission) return;

  selected.add(code);
  for (const required of permission.requiredPermissions) {
    addWithRequirements(required, selected, permissionByCode);
  }
}

function removeDependants(
  selected: Set<string>,
  permissionByCode: ReadonlyMap<string, WorkspaceAccessPermission>,
) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const code of [...selected]) {
      const permission = permissionByCode.get(code);
      if (!permission || permission.requiredPermissions.some((required) => !selected.has(required))) {
        selected.delete(code);
        changed = true;
      }
    }
  }
}
