import type { DataRightsCase } from "../../api/types";
import type {
  DataRightsAction,
  DataRightsOperationKind,
} from "./dataRightsWorkflow";

export type DataRightsConfirmationAction =
  | "reject-verification"
  | "approve"
  | "deny"
  | "execute-restriction"
  | "execute-removal"
  | "cancel";

export type DataRightsConfirmationSnapshot = {
  action: DataRightsConfirmationAction;
  caseId: string;
  caseVersion: number;
  caseStatus: DataRightsCase["status"];
  selectedSubjectCount: number;
  operationKind: DataRightsOperationKind;
  restrictionTargetId: string | null;
  restrictionTargetVersion: number | null;
};

export function createDataRightsConfirmation(
  action: DataRightsConfirmationAction,
  dataRightsCase: DataRightsCase,
  operationKind: DataRightsOperationKind,
): DataRightsConfirmationSnapshot {
  return {
    action,
    caseId: dataRightsCase.id,
    caseVersion: dataRightsCase.version,
    caseStatus: dataRightsCase.status,
    selectedSubjectCount: dataRightsCase.selectedSubjectCount,
    operationKind,
    restrictionTargetId:
      dataRightsCase.restrictionReleaseTarget?.ownerOperationId ?? null,
    restrictionTargetVersion:
      dataRightsCase.restrictionReleaseTarget?.ownerOperationVersion ?? null,
  };
}

export function isDataRightsConfirmationCurrent(
  confirmation: DataRightsConfirmationSnapshot,
  dataRightsCase: DataRightsCase,
  operationKind: DataRightsOperationKind,
  actions: DataRightsAction[],
): boolean {
  return confirmation.caseId === dataRightsCase.id &&
    confirmation.caseVersion === dataRightsCase.version &&
    confirmation.caseStatus === dataRightsCase.status &&
    confirmation.selectedSubjectCount === dataRightsCase.selectedSubjectCount &&
    confirmation.operationKind === operationKind &&
    confirmation.restrictionTargetId ===
      (dataRightsCase.restrictionReleaseTarget?.ownerOperationId ?? null) &&
    confirmation.restrictionTargetVersion ===
      (dataRightsCase.restrictionReleaseTarget?.ownerOperationVersion ?? null) &&
    actions.includes(confirmation.action);
}
