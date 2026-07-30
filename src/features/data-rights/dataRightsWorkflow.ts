import type {
  DataRightsCase,
  DataRightsCaseStatus,
  DataRightsDecisionReason,
  DataRightsExecutionWorkItem,
  DataRightsExecutionWorkItemStatus,
  DataRightsExportArtifactStatus,
} from "../../api/types";

export type DataRightsRequestScope =
  | { kind: "guest"; propertyId: string }
  | { kind: "staff" };

export type DataRightsCapabilities = {
  read: boolean;
  create: boolean;
  discover: boolean;
  review: boolean;
  decide: boolean;
  manage: boolean;
  execute: boolean;
  export: boolean;
  downloadExport: boolean;
  restrict: boolean;
  erase: boolean;
};

export type DataRightsAction =
  | "verify-requester"
  | "reject-verification"
  | "route-request"
  | "begin-discovery"
  | "discover-subject"
  | "review"
  | "begin-decision"
  | "approve"
  | "deny"
  | "generate-export"
  | "execute-correction"
  | "execute-restriction"
  | "execute-removal"
  | "cancel";

export const DATA_RIGHTS_ACCESS_EXPORT = 1;
export const DATA_RIGHTS_CORRECTION = 2;
export const DATA_RIGHTS_RESTRICTION = 4;
export const DATA_RIGHTS_ANONYMISATION = 16;
export const DATA_RIGHTS_RESTRICTION_APPLY = 1;
export const DATA_RIGHTS_RESTRICTION_RELEASE = 2;

export type DataRightsOperationKind =
  | "export"
  | "correction"
  | "restriction-apply"
  | "restriction-release"
  | "removal"
  | "other";

const caseStatusNames: Record<number, string> = {
  0: "unknown",
  1: "draft",
  2: "discovery",
  3: "reviewRequired",
  4: "decisionPending",
  5: "approved",
  6: "denied",
  7: "executing",
  8: "blocked",
  9: "completed",
  10: "partiallyCompleted",
  11: "canceled",
};

const executionStatusNames: Record<number, string> = {
  0: "unknown",
  1: "prepared",
  2: "processing",
  3: "blocked",
  4: "failed",
  5: "completed",
  6: "noOp",
  7: "ownerProofRecorded",
};

const exportStatusNames: Record<number, string> = {
  0: "unknown",
  1: "requested",
  2: "generating",
  3: "available",
  4: "failed",
  5: "expired",
  6: "deleting",
  7: "deleted",
};

export function dataRightsCaseStatusKey(status: DataRightsCaseStatus | string): string {
  return typeof status === "number"
    ? caseStatusNames[status] ?? "unknown"
    : normalizeStatus(status);
}

export function dataRightsCaseStatusLabel(status: DataRightsCaseStatus | string): string {
  return words(dataRightsCaseStatusKey(status));
}

export function dataRightsExecutionStatusKey(
  status: DataRightsExecutionWorkItemStatus | string,
): string {
  return typeof status === "number"
    ? executionStatusNames[status] ?? "unknown"
    : normalizeStatus(status);
}

export function dataRightsExecutionStatusLabel(
  status: DataRightsExecutionWorkItemStatus | string,
): string {
  return words(dataRightsExecutionStatusKey(status));
}

export function dataRightsExportStatusKey(
  status: DataRightsExportArtifactStatus | string,
): string {
  return typeof status === "number"
    ? exportStatusNames[status] ?? "unknown"
    : normalizeStatus(status);
}

export function dataRightsExportStatusLabel(
  status: DataRightsExportArtifactStatus | string,
): string {
  return words(dataRightsExportStatusKey(status));
}

export function dataRightsCaseNeedsLiveRefresh(
  status: DataRightsCaseStatus | string | undefined,
): boolean {
  return status !== undefined && dataRightsCaseStatusKey(status) === "executing";
}

export function dataRightsExecutionNeedsLiveRefresh(
  status: DataRightsExecutionWorkItemStatus | string | undefined,
): boolean {
  if (status === undefined) return false;
  return ["prepared", "processing", "ownerProofRecorded"].includes(
    dataRightsExecutionStatusKey(status),
  );
}

export function dataRightsExecutionBatchNeedsLiveRefresh(
  workItems: readonly Pick<DataRightsExecutionWorkItem, "status">[] | null | undefined,
): boolean {
  return Boolean(
    workItems?.length &&
    workItems.some((workItem) => dataRightsExecutionNeedsLiveRefresh(workItem.status)),
  );
}

export function dataRightsExportNeedsLiveRefresh(
  status: DataRightsExportArtifactStatus | string | undefined,
): boolean {
  return status !== undefined &&
    ["requested", "generating"].includes(dataRightsExportStatusKey(status));
}

export function dataRightsScopeKey(scope: DataRightsRequestScope): string {
  return scope.kind === "staff" ? "staff" : `guest:${scope.propertyId}`;
}

export function dataRightsCasesPath(scope: DataRightsRequestScope): string {
  return scope.kind === "staff"
    ? "/api/data-rights/tenant/cases"
    : `/api/data-rights/properties/${scope.propertyId}/cases`;
}

export function dataRightsCaseHasOperation(
  dataRightsCase: Pick<DataRightsCase, "requestedOperations">,
  operation: number,
): boolean {
  return (Number(dataRightsCase.requestedOperations) & operation) === operation;
}

export function isDataRightsAccessExport(
  dataRightsCase: Pick<DataRightsCase, "requestedOperations">,
): boolean {
  return Number(dataRightsCase.requestedOperations) === DATA_RIGHTS_ACCESS_EXPORT;
}

export function isDataRightsRestriction(
  dataRightsCase: Pick<DataRightsCase, "requestedOperations">,
): boolean {
  return Number(dataRightsCase.requestedOperations) === DATA_RIGHTS_RESTRICTION;
}

export function isDataRightsCorrection(
  dataRightsCase: Pick<DataRightsCase, "requestedOperations">,
): boolean {
  return Number(dataRightsCase.requestedOperations) === DATA_RIGHTS_CORRECTION;
}

export function dataRightsOperationKind(
  dataRightsCase: Pick<DataRightsCase, "requestedOperations" | "restrictionDirective">,
): DataRightsOperationKind {
  if (isDataRightsAccessExport(dataRightsCase)) return "export";
  if (isDataRightsCorrection(dataRightsCase)) return "correction";
  if (isDataRightsRestriction(dataRightsCase)) {
    if (Number(dataRightsCase.restrictionDirective) === DATA_RIGHTS_RESTRICTION_APPLY) {
      return "restriction-apply";
    }
    if (Number(dataRightsCase.restrictionDirective) === DATA_RIGHTS_RESTRICTION_RELEASE) {
      return "restriction-release";
    }
    return "other";
  }
  if (dataRightsCaseHasOperation(dataRightsCase, DATA_RIGHTS_ANONYMISATION)) {
    return "removal";
  }
  return "other";
}

export function dataRightsRequestLabel(
  dataRightsCase: Pick<
    DataRightsCase,
    "requestedOperations" | "restrictionDirective" | "type"
  >,
): string {
  const operationKind = dataRightsOperationKind(dataRightsCase);
  if (operationKind === "export") {
    return Number(dataRightsCase.type) === 3 ? "Staff data export" : "Guest data export";
  }
  if (operationKind === "correction") {
    return Number(dataRightsCase.type) === 3
      ? "Correct staff data"
      : "Correct guest data";
  }
  if (operationKind === "restriction-apply") return "Limit guest data processing";
  if (operationKind === "restriction-release") return "Release guest processing limit";
  if (operationKind === "removal") {
    return Number(dataRightsCase.type) === 3
      ? "Staff data removal"
      : "Guest data removal";
  }
  return "Privacy request";
}

export function dataRightsRequesterLabel(
  relationship: number,
  scopeKind: DataRightsRequestScope["kind"],
): string {
  if (relationship === 1) {
    return scopeKind === "staff"
      ? "Requested by the staff member"
      : "Requested by the guest";
  }
  if (relationship === 2) return "Requested by an authorized representative";
  if (relationship === 3) return "Workspace initiated";
  return "Privacy request";
}

export function dataRightsDecisionReasonLabel(reason: DataRightsDecisionReason): string {
  const key = typeof reason === "number"
    ? ({
      0: "unknown",
      1: "requestValidated",
      2: "identityOrAuthorityNotEstablished",
      3: "requestInvalid",
      4: "legalObligation",
      5: "rightsOfOthers",
      6: "unsupportedOperation",
    } as Record<number, string>)[reason] ?? "unknown"
    : normalizeStatus(reason);
  return words(key);
}

export function availableDataRightsActions(
  dataRightsCase: DataRightsCase,
  capabilities: DataRightsCapabilities,
): DataRightsAction[] {
  const status = dataRightsCaseStatusKey(dataRightsCase.status);
  const actions: DataRightsAction[] = [];

  if (status === "draft") {
    if (dataRightsCase.verificationStatus === 1 && capabilities.review) {
      actions.push("verify-requester", "reject-verification");
    }
    if (dataRightsCase.routingStatus === 1 && capabilities.review) {
      actions.push("route-request");
    }
    const verificationReady = dataRightsCase.verificationStatus === 2 ||
      dataRightsCase.verificationStatus === 4;
    const routingReady = dataRightsCase.routingStatus === 2 ||
      dataRightsCase.routingStatus === 3;
    if (verificationReady && routingReady && capabilities.discover) {
      actions.push("begin-discovery");
    }
  }

  if (status === "discovery" && capabilities.discover) {
    actions.push("discover-subject");
    const selectionReady =
      Number(dataRightsCase.type) === 3 ||
      isDataRightsRestriction(dataRightsCase) ||
      isDataRightsCorrection(dataRightsCase)
      ? dataRightsCase.selectedSubjectCount === 1
      : dataRightsCase.selectedSubjectCount > 0;
    if (selectionReady && capabilities.review) {
      actions.push("review");
    }
  }

  if (status === "reviewRequired" && capabilities.decide) {
    actions.push("begin-decision");
  }

  if (status === "decisionPending" && capabilities.decide) {
    actions.push("approve", "deny");
  }

  if (status === "approved") {
    if (isDataRightsAccessExport(dataRightsCase)) {
      if (capabilities.export) actions.push("generate-export");
    } else if (isDataRightsCorrection(dataRightsCase)) {
      if (capabilities.execute) actions.push("execute-correction");
    } else if (isDataRightsRestriction(dataRightsCase)) {
      if (capabilities.restrict) actions.push("execute-restriction");
    } else if (capabilities.erase) {
      actions.push("execute-removal");
    }
  }

  if (
    ["draft", "discovery", "reviewRequired", "decisionPending", "blocked"].includes(status) &&
    capabilities.manage
  ) {
    actions.push("cancel");
  }

  return actions;
}

export function shortDataRightsCaseId(caseId: string): string {
  return caseId.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function normalizeStatus(status: string): string {
  const pieces = status.trim().split(/[-_\s]+/).filter(Boolean);
  return pieces.map((piece, index) => index === 0
    ? piece.charAt(0).toLowerCase() + piece.slice(1)
    : piece.charAt(0).toUpperCase() + piece.slice(1)).join("");
}

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}
