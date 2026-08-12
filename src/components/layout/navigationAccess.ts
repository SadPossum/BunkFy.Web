export type NavigationScopeKind = "tenant" | "tenant-or-property";

export function navigationScopes(
  kind: NavigationScopeKind,
  tenantScope: string,
  propertyScope: string,
): string[] {
  return (kind === "tenant" ? [tenantScope] : [tenantScope, propertyScope]).filter(Boolean);
}

export function navigationItemAllowed(
  requiredPermissions: readonly string[],
  scopes: readonly string[],
  allows: (permission: string, scope: string) => boolean,
): boolean {
  return requiredPermissions.every((permission) =>
    scopes.some((scope) => allows(permission, scope))
  );
}
