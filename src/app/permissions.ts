import { useQuery } from "@tanstack/react-query";
import type { AccessPermissionCheck, AccessPermissionEvaluationResponse } from "../api/types";
import { useSession } from "./session";

export const permissions = {
  propertiesRead: "properties.read",
  propertiesManage: "properties.properties.manage",
  roomsManage: "properties.rooms.manage",
  bedsManage: "properties.beds.manage",
  inventoryRead: "inventory.read",
  inventoryConfigure: "inventory.configure",
  inventoryBlocksManage: "inventory.blocks.manage",
  reservationsRead: "reservations.read",
  reservationsCreate: "reservations.create",
  reservationsManage: "reservations.manage",
  reservationsManageGuests: "reservations.manage-guests",
  reservationsCancel: "reservations.cancel",
  reservationsCheckIn: "reservations.check-in",
  reservationsNoShow: "reservations.no-show",
  reservationsCheckOut: "reservations.check-out",
  guestsRead: "guests.read",
  guestsCreate: "guests.create",
  guestsManage: "guests.manage",
  guestsArchive: "guests.archive",
  staffRead: "staff.read",
  staffCreate: "staff.create",
  staffManage: "staff.manage",
  staffAssignProperties: "staff.assign-properties",
  staffManageLifecycle: "staff.manage-lifecycle",
  ingestionRead: "ingestion.read",
  ingestionConnectionsManage: "ingestion.connections.manage",
  ingestionCredentialsManage: "ingestion.credentials.manage",
  ingestionRawPayloadsRead: "ingestion.raw-payloads.read",
  ingestionSensitiveHistoryRead: "ingestion.sensitive-history.read",
  ingestionProposalsDecide: "ingestion.proposals.decide",
} as const;

export function tenantAccessScope(tenantId: string): string {
  return `tenant:${tenantId}`;
}

export function propertyAccessScope(tenantId: string, propertyId: string): string {
  return `${tenantAccessScope(tenantId)}/property:${propertyId}`;
}

export function accessChecksMatchTenant(
  tenantId: string | undefined,
  checks: AccessPermissionCheck[],
): boolean {
  if (!tenantId || tenantId === "global") return false;

  const tenantScope = tenantAccessScope(tenantId);
  return checks.every(({ scope }) =>
    scope === tenantScope || scope.startsWith(`${tenantScope}/`)
  );
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
    enabled: Boolean(
      session && checks.length && accessChecksMatchTenant(session.tenantId, checks),
    ),
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
