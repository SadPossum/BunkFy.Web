import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { RetirementProcessSummary } from "../../api/types";
import { retirementStatus } from "./topologyRetirementEditorModel";

export type RetirementObservation = {
  context: string; instance: number; processId: string; version: number; status: number | null;
  topologyActive: boolean | null;
};
export function retirementObservation(context: string, instance: number, process: RetirementProcessSummary, topologyActive: boolean | null): RetirementObservation {
  return { context, instance, processId: process.topologyChangeId, version: process.version, status: retirementStatus(process.status), topologyActive };
}

// Repeated polls and impact-only revisions are not topology transitions. Remember
// the highest revision even when it needs no refresh, so an older result cannot win.
export function advanceRetirementObservation(previous: RetirementObservation | null, next: RetirementObservation) {
  if (!previous || previous.context !== next.context || previous.instance !== next.instance || previous.processId !== next.processId) {
    return { observation: next, refresh: true };
  }
  if (next.version < previous.version) return { observation: previous, refresh: false };
  const refresh = previous.status !== next.status
    || (previous.topologyActive !== null && next.topologyActive !== null && previous.topologyActive !== next.topologyActive);
  const sameRevision = next.version === previous.version && next.status === previous.status;
  return { observation: { ...next, topologyActive: next.topologyActive ?? (sameRevision ? previous.topologyActive : null) }, refresh };
}

export type RetirementReadScope = { tenantId: string; propertyId: string; roomId: string };
export function retirementDependentQuery(key: QueryKey, scope: RetirementReadScope): boolean {
  if (key[0] === "operational-preview") return key[1] === scope.tenantId && key[2] === scope.propertyId;
  if (key[1] !== scope.propertyId) return false;
  if (key[0] === "beds") return key[2] === scope.roomId;
  return ["rooms", "inventory-rooms", "availability", "reservation-calendar", "reservation-operations"].includes(String(key[0]));
}

export async function refreshRetirementDependents(client: QueryClient, scope: RetirementReadScope, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return;
  // Active readers refetch; inactive views are only invalidated for their next
  // visit. Never fetch a disabled/unauthorized view or refetch the polling owner.
  await client.invalidateQueries({ predicate: (query) => retirementDependentQuery(query.queryKey, scope) }).catch(() => {});
}

export type RetirementDependentReadState = "current" | "refreshing" | "unconfirmed";
export function retirementDependentReadState(client: QueryClient, scope: RetirementReadScope): RetirementDependentReadState {
  const queries = client.getQueryCache().findAll({ type: "active", predicate: (query) => retirementDependentQuery(query.queryKey, scope) });
  if (queries.some((query) => query.state.fetchStatus === "fetching")) return "refreshing";
  if (queries.some((query) => query.state.error || query.state.isInvalidated || query.state.fetchStatus === "paused")) return "unconfirmed";
  return "current";
}
