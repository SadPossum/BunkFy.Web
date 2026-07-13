import { useQuery } from "@tanstack/react-query";
import type { AccessPermissionCheck, AccessPermissionEvaluationResponse } from "../api/types";
import { useSession } from "./session";

export const permissions = {
  propertiesManage: "properties.properties.manage",
  roomsManage: "properties.rooms.manage",
  bedsManage: "properties.beds.manage",
  inventoryConfigure: "inventory.configure",
  inventoryBlocksManage: "inventory.blocks.manage",
  reservationsCreate: "reservations.create",
  reservationsCancel: "reservations.cancel",
} as const;

export function tenantAccessScope(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function propertyAccessScope(tenantId: string, propertyId: string): string {
  return `${tenantAccessScope(tenantId)}/property:${propertyId}`;
}

export function usePermissions(checks: AccessPermissionCheck[]) {
  const { request, session } = useSession();
  const keys = checks.map(({ permission, scope }) => `${permission}@${scope}`);
  const query = useQuery({
    queryKey: ["access-permissions", session?.tenantId, ...keys],
    queryFn: () => request<AccessPermissionEvaluationResponse>("/api/access/permissions/evaluate", {
      method: "POST",
      body: JSON.stringify({ checks }),
    }),
    enabled: Boolean(session && checks.length),
    staleTime: 30_000,
  });
  const allowed = new Set(
    (query.data?.permissions ?? [])
      .filter((decision) => decision.allowed)
      .map((decision) => `${decision.permission}@${decision.scope}`),
  );

  return {
    isLoading: query.isLoading,
    error: query.error,
    allows: (permission: string, scope: string) => allowed.has(`${permission}@${scope}`),
  };
}
