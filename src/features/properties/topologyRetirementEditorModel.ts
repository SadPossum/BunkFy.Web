import { ApiError } from "../../api/client";
import type { RetirementContext, RetirementImpact, RetirementProcessSummary, TopologyRetirement } from "../../api/types";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";

export type RetirementCoordinates = { propertyId: string; roomId: string; bedId?: string; kind: "room" | "bed" };
export type RetirementEditorTarget = RetirementCoordinates & { label: string };
export type RetirementEditorEvidence = {
  propertyId: string; permissionsCurrent: boolean; propertyCurrent: boolean; roomsCurrent: boolean; bedsCurrent: boolean;
  mayRead: boolean; mayRetire: boolean;
};
export const retirementUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object");
const count = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown) => value === null || date(value);

export function retirementStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  const names = ["unknown", "draining", "finalizationrequested", "finalizedawaitingtopology", "completed", "rejected", "canceled"];
  const index = names.indexOf(String(value).toLowerCase());
  return index < 0 ? null : index;
}
export function retirementStatusLabel(value: unknown): string {
  return ["Status unconfirmed", "Waiting for reservations or blocks", "Finishing retirement", "Updating room and bed records", "Retirement completed", "Retirement needs attention", "Retirement stopped"][retirementStatus(value) ?? 0];
}
export function retirementSummaryMatches(value: unknown): value is RetirementProcessSummary {
  if (!record(value)) return false;
  return retirementUuid(value.topologyChangeId) && retirementStatus(value.status) !== null
    && typeof value.version === "number" && Number.isSafeInteger(value.version) && value.version > 0
    && typeof value.reason === "string" && value.reason.trim().length > 0 && value.reason.length <= 500
    && typeof value.requestedBy === "string" && value.requestedBy.length > 0 && value.requestedBy.length <= 200
    && (value.rejectionReasonCode === null || count(value.rejectionReasonCode))
    && (value.cancellationReason === null || typeof value.cancellationReason === "string")
    && (value.canceledBy === null || typeof value.canceledBy === "string")
    && date(value.createdAtUtc) && nullableDate(value.updatedAtUtc) && nullableDate(value.completedAtUtc) && nullableDate(value.canceledAtUtc);
}
export function retirementImpactMatches(value: unknown): value is RetirementImpact {
  return record(value) && [value.activeAllocationCount, value.activeManualBlockCount, value.activeBedRetirementCount].every(count)
    && typeof value.parentRoomRetirementActive === "boolean"
    && Array.isArray(value.affectedReservationIds) && value.affectedReservationIds.length <= 25
    && value.affectedReservationIds.every(retirementUuid) && new Set(value.affectedReservationIds).size === value.affectedReservationIds.length
    && typeof value.affectedReservationIdsTruncated === "boolean";
}
export function retirementCoordinatesMatch(value: unknown, target: RetirementCoordinates): boolean {
  return retirementUuid(target.propertyId) && retirementUuid(target.roomId) && (target.kind === "room" || retirementUuid(target.bedId))
    && record(value) && value.propertyId === target.propertyId && value.roomId === target.roomId
    && (target.kind === "bed" ? value.bedId === target.bedId : value.bedId === null || value.bedId === undefined);
}
export function retirementContextMatches(value: unknown, target: RetirementCoordinates): value is RetirementContext {
  if (!record(value) || !retirementCoordinatesMatch(value, target) || typeof value.isTopologyActive !== "boolean"
    || ![value.canRequest, value.canRetry, value.canCancel].every((flag) => typeof flag === "boolean")
    || !(value.process === null || retirementSummaryMatches(value.process))) return false;
  const available = value.impactStatus === 1 || String(value.impactStatus).toLowerCase() === "available";
  const unavailable = value.impactStatus === 2 || String(value.impactStatus).toLowerCase() === "unavailable";
  return available ? retirementImpactMatches(value.impact) : unavailable && value.impact === null && !value.canRequest && !value.canRetry && !value.canCancel;
}
export function retirementReceiptMatches(value: unknown, target: RetirementCoordinates, processId?: string): value is TopologyRetirement {
  if (!record(value) || !retirementCoordinatesMatch(value, target) || (processId && value.topologyChangeId !== processId)) return false;
  const summary = { ...value, rejectionReasonCode: value.rejectionReason ?? null };
  const impact = { ...value, activeBedRetirementCount: value.activeBedRetirementCount ?? 0, parentRoomRetirementActive: false };
  return retirementSummaryMatches(summary) && retirementImpactMatches(impact);
}
export function retirementReceiptSummary(value: TopologyRetirement): RetirementProcessSummary {
  return { ...value, rejectionReasonCode: value.rejectionReason ?? null };
}
export function retirementReadbackState(data: RetirementContext | undefined, confirmed: RetirementProcessSummary | null, receiptAwaitingRead: boolean, savedId: string | null) {
  const current = data?.process;
  const older = Boolean(savedId && data && savedId !== current?.topologyChangeId
    && !(receiptAwaitingRead && confirmed?.topologyChangeId === savedId));
  const process = confirmed && (receiptAwaitingRead || !current || (confirmed.topologyChangeId === current.topologyChangeId && confirmed.version >= current.version))
    ? confirmed : current ?? null;
  return { older, process };
}
export function retirementAuthority(target: RetirementCoordinates, evidence: RetirementEditorEvidence): boolean {
  return target.propertyId === evidence.propertyId && evidence.permissionsCurrent && evidence.propertyCurrent && evidence.mayRead && evidence.mayRetire;
}
export function retirementActionAllowed(action: "request" | "retry" | "cancel", target: RetirementCoordinates, evidence: RetirementEditorEvidence, context: RetirementContext | undefined, current: boolean): boolean {
  if (!retirementAuthority(target, evidence) || !current || !retirementContextMatches(context, target) || !context.impact) return false;
  const status = retirementStatus(context.process?.status);
  if (action === "request") return evidence.roomsCurrent && (target.kind === "room" || evidence.bedsCurrent)
    && context.isTopologyActive && (context.process === null || status === 6) && context.canRequest
    && !context.impact.activeBedRetirementCount && !context.impact.parentRoomRetirementActive;
  if (action === "retry") return status === 5 && context.canRetry && !context.impact.activeAllocationCount
    && !context.impact.activeManualBlockCount && !context.impact.activeBedRetirementCount && !context.impact.parentRoomRetirementActive;
  return status === 1 && context.canCancel;
}
export function retirementReplayAllowed(target: RetirementCoordinates, evidence: RetirementEditorEvidence, context: RetirementContext | undefined, current: boolean): boolean {
  // Journal replay may recover a committed result after its lifecycle has advanced.
  // It still needs current authority and a verified exact target, never a new intent.
  return retirementAuthority(target, evidence) && current && retirementContextMatches(context, target);
}
export function retirementAttemptCurrent(attempt: { context: string; instance: number }, current: { context: string; instance: number }) {
  return attempt.context === current.context && attempt.instance === current.instance;
}
export function retirementKnownRejection(error: unknown): boolean {
  return error instanceof ApiError && !isInsufficientAuthenticationError(error) && [400, 403, 404, 409, 423].includes(error.status);
}
