import type {
  DataRightsCase,
  DataRightsCaseStatus,
  DataRightsDecisionReason,
  DataRightsExecutionWorkItem,
  DataRightsExecutionWorkItemStatus,
} from "../../api/types";

export type DataRightsCapabilities = {
  read: boolean;
  create: boolean;
  discover: boolean;
  review: boolean;
  decide: boolean;
  manage: boolean;
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
  | "execute"
  | "cancel";

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
    if (dataRightsCase.selectedSubjectCount > 0 && capabilities.review) {
      actions.push("review");
    }
  }

  if (status === "reviewRequired" && capabilities.decide) {
    actions.push("begin-decision");
  }

  if (status === "decisionPending" && capabilities.decide) {
    actions.push("approve", "deny");
  }

  if (status === "approved" && capabilities.erase) {
    actions.push("execute");
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
