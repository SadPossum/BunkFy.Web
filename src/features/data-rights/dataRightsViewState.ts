export type DataRightsScopeFilter = "guest" | "staff";
export type DataRightsStatusFilter =
  | "all"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "11";

export type DataRightsViewState = {
  scope: DataRightsScopeFilter;
  status: DataRightsStatusFilter;
  page: number;
  selectedCaseId: string | null;
};

const statuses = new Set<DataRightsStatusFilter>([
  "all",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "11",
]);

export function dataRightsViewState(
  searchParams: URLSearchParams,
  defaultScope: DataRightsScopeFilter,
): DataRightsViewState {
  return {
    scope: scope(searchParams.get("scope"), defaultScope),
    status: status(searchParams.get("status")),
    page: positivePage(searchParams.get("page")),
    selectedCaseId: value(searchParams.get("case")),
  };
}

export function dataRightsScopeSearchParams(
  current: URLSearchParams,
  scope: DataRightsScopeFilter,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.set("scope", scope);
  clearQueueContext(next);
  return next;
}

export function dataRightsStatusSearchParams(
  current: URLSearchParams,
  status: DataRightsStatusFilter,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (status === "all") next.delete("status");
  else next.set("status", status);
  next.delete("page");
  clearSelection(next);
  return next;
}

export function dataRightsPageSearchParams(
  current: URLSearchParams,
  page: number,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (page <= 1) next.delete("page");
  else next.set("page", String(Math.floor(page)));
  clearSelection(next);
  return next;
}

export function dataRightsCaseSearchParams(
  current: URLSearchParams,
  caseId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (caseId) next.set("case", caseId);
  else next.delete("case");
  next.delete("focus");
  return next;
}

export function clearDataRightsScopeContextSearchParams(
  current: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(current);
  next.delete("page");
  clearSelection(next);
  return next;
}

export function clearDataRightsOperatorContextSearchParams(
  current: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(current);
  clearQueueContext(next);
  return next;
}

function clearQueueContext(searchParams: URLSearchParams) {
  searchParams.delete("status");
  searchParams.delete("page");
  clearSelection(searchParams);
}

function clearSelection(searchParams: URLSearchParams) {
  searchParams.delete("case");
  searchParams.delete("focus");
}

function scope(
  candidate: string | null,
  fallback: DataRightsScopeFilter,
): DataRightsScopeFilter {
  return candidate === "guest" || candidate === "staff" ? candidate : fallback;
}

function status(candidate: string | null): DataRightsStatusFilter {
  return candidate && statuses.has(candidate as DataRightsStatusFilter)
    ? candidate as DataRightsStatusFilter
    : "all";
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
