export type IntegrationsTab = "connections" | "review" | "activity";
export type ConnectionStatusFilter = "all" | "enabled" | "disabled";
export type ProposalStatusFilter =
  | "all"
  | "pending"
  | "applying"
  | "applied"
  | "rejected"
  | "superseded"
  | "stale"
  | "failed";
export type IngestionActivityTab = "runs" | "receipts" | "reprocessing" | "capabilities";
export type IntegrationSelection = "connection" | "proposal" | "run" | "receipt" | "attempt";

export type IntegrationViewState = {
  tab: IntegrationsTab;
  connectionStatus: ConnectionStatusFilter;
  connectionPage: number;
  selectedConnectionId: string | null;
  proposalStatus: ProposalStatusFilter;
  proposalPage: number;
  selectedProposalId: string | null;
  activityTab: IngestionActivityTab;
  activityConnectionId: string | null;
  activityPage: number;
  selectedRunId: string | null;
  selectedReceiptId: string | null;
  selectedAttemptId: string | null;
};

const proposalStatuses = new Set<ProposalStatusFilter>([
  "all",
  "pending",
  "applying",
  "applied",
  "rejected",
  "superseded",
  "stale",
  "failed",
]);

const selectionKeys: IntegrationSelection[] = [
  "connection",
  "proposal",
  "run",
  "receipt",
  "attempt",
];

export function integrationViewState(searchParams: URLSearchParams): IntegrationViewState {
  const selectedConnectionId = value(searchParams.get("connection"));
  const selectedProposalId = selectedConnectionId ? null : value(searchParams.get("proposal"));
  const selectedRunId = selectedConnectionId || selectedProposalId ? null : value(searchParams.get("run"));
  const selectedReceiptId = selectedConnectionId || selectedProposalId || selectedRunId
    ? null
    : value(searchParams.get("receipt"));
  const selectedAttemptId = selectedConnectionId || selectedProposalId || selectedRunId || selectedReceiptId
    ? null
    : value(searchParams.get("attempt"));

  return {
    tab: selectedConnectionId
      ? "connections"
      : selectedProposalId
        ? "review"
        : selectedRunId || selectedReceiptId || selectedAttemptId
          ? "activity"
          : primaryTab(searchParams.get("tab")),
    connectionStatus: connectionStatus(searchParams.get("status")),
    connectionPage: positivePage(searchParams.get("page")),
    selectedConnectionId,
    proposalStatus: proposalStatus(searchParams.get("proposalStatus")),
    proposalPage: positivePage(searchParams.get("proposalPage")),
    selectedProposalId,
    activityTab: selectedRunId
      ? "runs"
      : selectedReceiptId
        ? "receipts"
        : selectedAttemptId
          ? "reprocessing"
          : activityTab(searchParams.get("activity")),
    activityConnectionId: value(searchParams.get("source")),
    activityPage: positivePage(searchParams.get("activityPage")),
    selectedRunId,
    selectedReceiptId,
    selectedAttemptId,
  };
}

export function integrationPrimaryTabSearchParams(
  current: URLSearchParams,
  tab: IntegrationsTab,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (tab === "connections") next.delete("tab");
  else next.set("tab", tab);
  clearSelection(next);
  return next;
}

export function connectionFilterSearchParams(
  current: URLSearchParams,
  status: ConnectionStatusFilter,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (status === "all") next.delete("status");
  else next.set("status", status);
  next.delete("page");
  next.delete("connection");
  return next;
}

export function connectionPageSearchParams(current: URLSearchParams, page: number): URLSearchParams {
  return pageSearchParams(current, "page", page, ["connection"]);
}

export function proposalFilterSearchParams(
  current: URLSearchParams,
  status: ProposalStatusFilter,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (status === "pending") next.delete("proposalStatus");
  else next.set("proposalStatus", status);
  next.delete("proposalPage");
  next.delete("proposal");
  return next;
}

export function proposalPageSearchParams(current: URLSearchParams, page: number): URLSearchParams {
  return pageSearchParams(current, "proposalPage", page, ["proposal"]);
}

export function ingestionActivityTabSearchParams(
  current: URLSearchParams,
  tab: IngestionActivityTab,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (tab === "runs") next.delete("activity");
  else next.set("activity", tab);
  next.delete("activityPage");
  clearSelection(next);
  return next;
}

export function activityConnectionSearchParams(
  current: URLSearchParams,
  connectionId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (connectionId) next.set("source", connectionId);
  else next.delete("source");
  next.delete("activityPage");
  clearSelection(next);
  return next;
}

export function activityPageSearchParams(current: URLSearchParams, page: number): URLSearchParams {
  return pageSearchParams(current, "activityPage", page, ["run", "receipt", "attempt"]);
}

export function integrationSelectionSearchParams(
  current: URLSearchParams,
  selection: IntegrationSelection,
  id: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  clearSelection(next);
  if (id) next.set(selection, id);
  return next;
}

export function clearIntegrationViewSearchParams(current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  [
    "tab",
    "status",
    "page",
    "proposalStatus",
    "proposalPage",
    "activity",
    "source",
    "activityPage",
    ...selectionKeys,
  ].forEach((key) => next.delete(key));
  return next;
}

function primaryTab(candidate: string | null): IntegrationsTab {
  return candidate === "review" || candidate === "activity" ? candidate : "connections";
}

function connectionStatus(candidate: string | null): ConnectionStatusFilter {
  return candidate === "enabled" || candidate === "disabled" ? candidate : "all";
}

function proposalStatus(candidate: string | null): ProposalStatusFilter {
  return candidate && proposalStatuses.has(candidate as ProposalStatusFilter)
    ? candidate as ProposalStatusFilter
    : "pending";
}

function activityTab(candidate: string | null): IngestionActivityTab {
  return candidate === "receipts" || candidate === "reprocessing" || candidate === "capabilities"
    ? candidate
    : "runs";
}

function pageSearchParams(
  current: URLSearchParams,
  key: string,
  page: number,
  selections: IntegrationSelection[],
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (page <= 1) next.delete(key);
  else next.set(key, String(Math.floor(page)));
  selections.forEach((selection) => next.delete(selection));
  return next;
}

function clearSelection(searchParams: URLSearchParams) {
  selectionKeys.forEach((key) => searchParams.delete(key));
}

function positivePage(candidate: string | null): number {
  if (!candidate || !/^\d+$/.test(candidate)) return 1;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function value(candidate: string | null): string | null {
  const normalized = candidate?.trim();
  return normalized ? normalized : null;
}
