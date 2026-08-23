import type { ApiSession } from "../../api/client";
import type { DataRightsCase } from "../../api/types";

export type DataRightsMutationKind =
  | "create-case"
  | "case-action"
  | "review-action"
  | "discovery"
  | "selection"
  | "restriction-target"
  | "generate-export"
  | "download-export"
  | "start-correction"
  | "claim-correction"
  | "apply-correction"
  | "execute-restriction"
  | "execute-removal";

export type DataRightsMutationEvidence = {
  permissionsCurrent: boolean;
  caseCurrent?: boolean;
  selectedEvidenceCurrent?: boolean;
  supportingSourceCurrent?: boolean;
  erasePermissionCurrent?: boolean;
};

export type DataRightsCaseSnapshot = Pick<
  DataRightsCase,
  "id" | "version" | "status" | "decisionRevision" | "selectedSubjectCount"
>;

export function dataRightsOperatorScopeKey(
  session: Pick<ApiSession, "tenantId" | "username"> | null | undefined,
): string {
  if (!session?.tenantId || !session.username.trim()) return "";
  return JSON.stringify([
    session.tenantId,
    session.username.trim().toLowerCase(),
  ]);
}

export function dataRightsCasesQueryKey(
  scopeKey: string,
  operatorScopeKey: string,
  status: string,
  page: number,
) {
  return ["data-rights-cases", scopeKey, operatorScopeKey, status, page] as const;
}

export function dataRightsCaseQueryKey(
  scopeKey: string,
  caseId: string | null,
  operatorScopeKey: string,
) {
  return ["data-rights-case", scopeKey, caseId, operatorScopeKey] as const;
}

export function dataRightsSubjectsQueryKey(
  scopeKey: string,
  caseId: string | null,
  operatorScopeKey: string,
  caseVersion: number | undefined,
  evidencePath: string | null,
) {
  return [
    "data-rights-subjects",
    scopeKey,
    caseId,
    operatorScopeKey,
    caseVersion,
    evidencePath,
  ] as const;
}

export function dataRightsExecutionQueryKey(
  scopeKey: string,
  caseId: string | null,
  operatorScopeKey: string,
) {
  return ["data-rights-execution", scopeKey, caseId, operatorScopeKey] as const;
}

export function dataRightsExportQueryKey(
  scopeKey: string,
  caseId: string,
  operatorScopeKey: string,
) {
  return ["data-rights-export", scopeKey, caseId, operatorScopeKey] as const;
}

export function dataRightsCorrectionQueryKey(
  scopeKey: string,
  caseId: string,
  operatorScopeKey: string,
) {
  return ["data-rights-correction", scopeKey, caseId, operatorScopeKey] as const;
}

export function dataRightsRestrictionTargetsQueryKey(
  scopeKey: string,
  caseId: string,
  operatorScopeKey: string,
  caseVersion: number,
) {
  return [
    "data-rights-restriction-release-targets",
    scopeKey,
    caseId,
    operatorScopeKey,
    caseVersion,
  ] as const;
}

export function dataRightsCaseMatches(
  current: DataRightsCaseSnapshot | null | undefined,
  candidate: DataRightsCaseSnapshot | null | undefined,
): boolean {
  return Boolean(
    current &&
      candidate &&
      current.id === candidate.id &&
      current.version === candidate.version &&
      current.status === candidate.status &&
      current.decisionRevision === candidate.decisionRevision &&
      current.selectedSubjectCount === candidate.selectedSubjectCount,
  );
}

export function dataRightsMutationAllowed(
  kind: DataRightsMutationKind,
  evidence: DataRightsMutationEvidence,
): boolean {
  if (!evidence.permissionsCurrent) return false;
  if (kind === "create-case") return true;
  if (!evidence.caseCurrent) return false;

  if (kind === "case-action" || kind === "discovery") return true;

  if (kind === "review-action") {
    return evidence.selectedEvidenceCurrent === true &&
      evidence.supportingSourceCurrent !== false;
  }

  if (kind === "selection" ||
      kind === "restriction-target" ||
      kind === "download-export" ||
      kind === "claim-correction") {
    return evidence.supportingSourceCurrent === true;
  }

  if (kind === "generate-export" ||
      kind === "start-correction" ||
      kind === "apply-correction" ||
      kind === "execute-restriction") {
    return evidence.supportingSourceCurrent === true;
  }

  return evidence.erasePermissionCurrent === true;
}

export function dataRightsSubmissionMatches(
  activeOperatorScopeKey: string,
  activeScopeKey: string,
  candidateOperatorScopeKey: string,
  candidateScopeKey: string,
): boolean {
  return Boolean(
    activeOperatorScopeKey &&
      activeOperatorScopeKey === candidateOperatorScopeKey &&
      activeScopeKey === candidateScopeKey,
  );
}

export function dataRightsSourceChangedError(): Error {
  return new Error(
    "The privacy request context changed. Refresh the current request before continuing.",
  );
}
