import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Clock3,
  FileLock2,
  Plus,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import type {
  DataRightsCase,
  DataRightsCaseListResponse,
  DataRightsCaseSummary,
  DataRightsRequesterRelationship,
} from "../../api/types";
import {
  permissions,
  propertyAccessScope,
  tenantAccessScope,
  usePermissions,
} from "../../app/permissions";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import {
  focusedResourceClass,
  useTargetProperty,
  useTransientResourceFocus,
} from "../../app/resourceFocus";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { PaginationBar } from "../../components/ui/PaginationBar";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  EmptyState,
  ErrorState,
  FormActions,
  LoadingState,
  Modal,
  PageHeader,
  StatusBadge,
} from "../../components/ui/primitives";
import {
  DATA_RIGHTS_ACCESS_EXPORT,
  DATA_RIGHTS_ANONYMISATION,
  DATA_RIGHTS_CORRECTION,
  DATA_RIGHTS_RESTRICTION,
  DATA_RIGHTS_RESTRICTION_APPLY,
  DATA_RIGHTS_RESTRICTION_RELEASE,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsCaseStatusKey,
  dataRightsCaseStatusLabel,
  dataRightsCasesPath,
  dataRightsOperationKind,
  dataRightsRequestLabel,
  dataRightsResponseDeadlineState,
  dataRightsScopeKey,
  shortDataRightsCaseId,
  type DataRightsCapabilities,
  type DataRightsOperationKind,
  type DataRightsRequestScope,
} from "./dataRightsWorkflow";
import {
  resolveDataRightsCaseCreateAttempt,
  type DataRightsCaseCreateAttempt,
} from "./dataRightsCaseCreateAttempt";
import {
  dataRightsCaseQueryKey,
  dataRightsCasesQueryKey,
  dataRightsMutationAllowed,
  dataRightsOperatorScopeKey,
  dataRightsSourceChangedError,
  dataRightsSubmissionMatches,
} from "./dataRightsSourceAuthority";
import { PrivacyRequestDetail } from "./PrivacyRequestDetail";

const PAGE_SIZE = 20;
const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "1", label: "Draft" },
  { value: "2", label: "Discovery" },
  { value: "3", label: "Review required" },
  { value: "4", label: "Decision pending" },
  { value: "5", label: "Approved" },
  { value: "7", label: "Executing" },
  { value: "8", label: "Blocked" },
  { value: "9", label: "Completed" },
  { value: "6", label: "Denied" },
  { value: "11", label: "Canceled" },
] as const;

const permissionCodes = [
  permissions.dataRightsRead,
  permissions.dataRightsCreate,
  permissions.dataRightsDiscover,
  permissions.dataRightsReview,
  permissions.dataRightsDecide,
  permissions.dataRightsExecute,
  permissions.dataRightsManage,
  permissions.dataRightsExport,
  permissions.dataRightsDownloadExport,
] as const;

export function PrivacyRequestsPage() {
  const { request, session } = useSession();
  const {
    selectedProperty,
    selectedPropertyId,
    selectedWorkspace,
  } = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const targetPropertyId = searchParams.get("property");
  const targetScopeKind = searchParams.get("scope");
  useTargetProperty(targetPropertyId);
  const [scopeKind, setScopeKind] = useState<"guest" | "staff">(
    targetScopeKind === "guest" || targetScopeKind === "staff"
      ? targetScopeKind
      : selectedPropertyId ? "guest" : "staff",
  );
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const selectedCaseId = searchParams.get("case");
  const tenantScope = session ? tenantAccessScope(session.tenantId) : "";
  const propertyScope = session && selectedPropertyId
    ? propertyAccessScope(session.tenantId, selectedPropertyId)
    : "";
  const activePermissionScope = scopeKind === "staff" ? tenantScope : propertyScope;
  const activeAccess = usePermissions(session && activePermissionScope
    ? [
      ...permissionCodes.map((permission) => ({
        permission,
        scope: activePermissionScope,
      })),
      ...(scopeKind === "guest"
        ? [{ permission: permissions.dataRightsRestrict, scope: activePermissionScope }]
        : []),
    ]
    : []);
  const eraseAccess = usePermissions(session && tenantScope
    ? [{ permission: permissions.dataRightsErase, scope: tenantScope }]
    : []);
  const capabilities: DataRightsCapabilities = {
    read: activeAccess.allows(permissions.dataRightsRead, activePermissionScope),
    create: activeAccess.allows(permissions.dataRightsCreate, activePermissionScope),
    discover: activeAccess.allows(permissions.dataRightsDiscover, activePermissionScope),
    review: activeAccess.allows(permissions.dataRightsReview, activePermissionScope),
    decide: activeAccess.allows(permissions.dataRightsDecide, activePermissionScope),
    execute: scopeKind === "guest" &&
      activeAccess.allows(permissions.dataRightsExecute, propertyScope),
    manage: activeAccess.allows(permissions.dataRightsManage, activePermissionScope),
    export: activeAccess.allows(permissions.dataRightsExport, activePermissionScope),
    downloadExport: activeAccess.allows(
      permissions.dataRightsDownloadExport,
      activePermissionScope,
    ),
    restrict: scopeKind === "guest" &&
      activeAccess.allows(permissions.dataRightsRestrict, propertyScope),
    erase: eraseAccess.allows(permissions.dataRightsErase, tenantScope),
  };
  const scope = useMemo<DataRightsRequestScope | null>(
    () => scopeKind === "staff"
      ? { kind: "staff" }
      : selectedPropertyId
        ? { kind: "guest", propertyId: selectedPropertyId }
        : null,
    [scopeKind, selectedPropertyId],
  );
  const scopeKey = scope ? dataRightsScopeKey(scope) : "guest:none";
  const operatorScopeKey = dataRightsOperatorScopeKey(session);
  const activeScopeRef = useRef({ operatorScopeKey, scopeKey });
  activeScopeRef.current = { operatorScopeKey, scopeKey };
  const previousOperatorScopeKeyRef = useRef(operatorScopeKey);
  const previousWorkflowScopeKeyRef = useRef(scopeKey);
  const casesPath = scope ? dataRightsCasesPath(scope) : "";
  const permissionSource = createCompositeSource({
    label: `${scopeKind === "staff" ? "Staff" : "Guest"} privacy permissions`,
    hasData: activeAccess.hasData,
    isLoading: activeAccess.isLoading,
    error: activeAccess.error,
    isFetching: activeAccess.isFetching,
    refetch: activeAccess.refetch,
  });
  const erasePermissionSource = createCompositeSource({
    label: "Privacy removal permission",
    hasData: eraseAccess.hasData,
    isLoading: eraseAccess.isLoading,
    error: eraseAccess.error,
    isFetching: eraseAccess.isFetching,
    refetch: eraseAccess.refetch,
  });
  const permissionsCurrent = compositeSourceCurrent(permissionSource);
  const permissionUsable = compositeSourceUsable(permissionSource.state);
  const createAuthorityCurrent = capabilities.create && dataRightsMutationAllowed(
    "create-case",
    { permissionsCurrent },
  );
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (status !== "all") params.set("status", status);
  const cases = useQuery({
    queryKey: dataRightsCasesQueryKey(scopeKey, operatorScopeKey, status, page),
    queryFn: () => request<DataRightsCaseListResponse>(`${casesPath}?${params}`),
    enabled: Boolean(operatorScopeKey && scope && capabilities.read),
    refetchInterval: (query) => query.state.data?.items.some((item) =>
      dataRightsCaseNeedsLiveRefresh(item.status))
      ? 5_000
      : false,
    refetchIntervalInBackground: false,
  });
  const casesSource = createCompositeSource({
    label: "Privacy request queue",
    hasData: cases.data !== undefined,
    isLoading: cases.isLoading,
    error: cases.error,
    isFetching: cases.isFetching,
    refetch: () => cases.refetch(),
  });
  const casesCurrent = compositeSourceCurrent(casesSource);
  const casesUsable = compositeSourceUsable(casesSource.state);
  const items = useMemo(
    () => casesUsable ? cases.data?.items ?? [] : [],
    [cases.data, casesUsable],
  );
  const focusedCaseId = useTransientResourceFocus(casesUsable);

  useEffect(() => {
    if ((targetScopeKind === "guest" || targetScopeKind === "staff") &&
      targetScopeKind !== scopeKind) {
      setScopeKind(targetScopeKind);
    }
  }, [scopeKind, targetScopeKind]);

  useEffect(() => {
    if (!selectedPropertyId && scopeKind === "guest" && targetScopeKind !== "guest") {
      setScopeKind("staff");
    }
  }, [scopeKind, selectedPropertyId, targetScopeKind]);

  useEffect(() => {
    setPage(1);
    setCreateOpen(false);
  }, [scopeKey]);

  useEffect(() => {
    const previous = previousWorkflowScopeKeyRef.current;
    if (previous === scopeKey) return;
    previousWorkflowScopeKeyRef.current = scopeKey;
    if (previous === "guest:none") return;

    const next = new URLSearchParams(searchParams);
    next.delete("case");
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [scopeKey, searchParams, setSearchParams]);

  useEffect(() => {
    const previous = previousOperatorScopeKeyRef.current;
    if (previous === operatorScopeKey) return;
    previousOperatorScopeKeyRef.current = operatorScopeKey;
    if (!previous) return;

    setStatus("all");
    setPage(1);
    setCreateOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete("case");
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }, [operatorScopeKey, searchParams, setSearchParams]);

  useEffect(() => {
    if (items.length === 0 && page > 1 && casesCurrent) {
      setPage((current) => Math.max(1, current - 1));
    }
  }, [casesCurrent, items.length, page]);

  function selectScope(value: "guest" | "staff") {
    setScopeKind(value);
    setPage(1);
    setCreateOpen(false);
    const next = new URLSearchParams(searchParams);
    next.set("scope", value);
    next.delete("case");
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }

  function selectCase(caseId: string | null) {
    const next = new URLSearchParams(searchParams);
    if (caseId) next.set("case", caseId);
    else next.delete("case");
    next.delete("focus");
    setSearchParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        eyebrow={scopeKind === "staff"
          ? selectedWorkspace?.organization.name || "Workspace"
          : selectedProperty?.name || "Property"}
        title="Privacy requests"
        description={scopeKind === "staff"
          ? "Coordinate staff exports and separately approved removal of eligible departed profiles."
          : "Coordinate guest corrections, exports, processing limits and separately approved data removal."}
        action={scope && capabilities.create
          ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!createAuthorityCurrent}
              onClick={() => {
                if (createAuthorityCurrent) setCreateOpen(true);
              }}
            >
              <Plus size={17} />
              New request
            </button>
          )
          : undefined}
      />

      <CompositeSourceNotice
        sources={[permissionSource]}
        title="Privacy access is delayed"
      />

      <section className="card overflow-hidden border border-base-300 bg-base-100 shadow-sm">
        <div className="border-b border-base-300 px-4 py-3 sm:px-6">
          <SegmentedTabs
            value={scopeKind}
            ariaLabel="Privacy request scope"
            onValueChange={selectScope}
            options={[
              { value: "guest", label: "Guest requests", icon: <ShieldCheck size={15} /> },
              { value: "staff", label: "Staff requests", icon: <UsersRound size={15} /> },
            ]}
          />
        </div>
        <div className="flex flex-col items-stretch gap-4 border-b border-base-300 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="font-display text-lg font-semibold">
              {scopeKind === "staff" ? "Workspace request queue" : "Property request queue"}
            </h2>
            <p className="mt-1 text-xs text-base-content/50">
              Sensitive record matching happens only inside an open request.
            </p>
          </div>
          <SelectPicker
            className="w-full sm:w-48"
            size="sm"
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            ariaLabel="Privacy request status"
            options={[...statusOptions]}
          />
        </div>

        {capabilities.read && (
          <CompositeSourceNotice
            className="mx-4 mt-4 sm:mx-6"
            sources={[casesSource]}
            title="Privacy request results are delayed"
          />
        )}

        {scopeKind === "guest" && !selectedProperty
          ? (
            <div className="p-6">
              <EmptyState
                icon={<ShieldCheck />}
                title="Choose a property"
                description="Guest requests stay within the property that owns the selected records."
              />
            </div>
          )
          : !permissionUsable
            ? <CompositeSourceFallback state={permissionSource.state} label="privacy access" />
          : permissionsCurrent && !capabilities.read
            ? (
              <div className="p-6">
                <EmptyState
                  icon={<FileLock2 />}
                  title="Privacy requests are restricted"
                  description={scopeKind === "staff"
                    ? "Ask a workspace administrator for tenant-wide data-rights access."
                    : "Ask a workspace administrator for data-rights access at this property."}
                />
              </div>
            )
            : !capabilities.read
              ? <CompositeSourceFallback state={permissionSource.state} label="privacy access" />
            : casesSource.state === "loading"
              ? <LoadingState label="Loading privacy requests" />
              : !casesUsable
                ? <CompositeSourceFallback state={casesSource.state} label="privacy requests" />
                : items.length === 0 && !casesCurrent
                  ? <CompositeSourceFallback state={casesSource.state} label="current privacy request results" />
                : items.length === 0
                  ? (
                    <div className="p-6">
                      <EmptyState
                        icon={<ShieldCheck />}
                        title={status === "all" ? "No privacy requests yet" : "No requests have this status"}
                        description={status === "all"
                          ? scopeKind === "staff"
                            ? "Create a request for a staff data export or governed profile removal."
                            : "Create a request for a guest correction, export, processing limit or data removal."
                          : "Choose another status to review the rest of the queue."}
                        action={scope && capabilities.create && status === "all"
                          ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={!createAuthorityCurrent}
                              onClick={() => {
                                if (createAuthorityCurrent) setCreateOpen(true);
                              }}
                            >
                              Create request
                            </button>
                          )
                          : undefined}
                      />
                    </div>
                  )
                  : (
                    <>
                      <div className="divide-y divide-base-300">
                        {items.map((item) => (
                          <PrivacyRequestRow
                            key={item.id}
                            item={item}
                            focused={item.id === focusedCaseId}
                            onOpen={() => selectCase(item.id)}
                          />
                        ))}
                      </div>
                      <PaginationBar
                        page={page}
                        pageSize={PAGE_SIZE}
                        itemCount={items.length}
                        itemLabel="request"
                        hasMore={cases.data?.hasMore}
                        disabled={!casesCurrent}
                        onPageChange={setPage}
                      />
                    </>
                  )}
      </section>

      {scope && (
        <>
          <CreatePrivacyRequestModal
            key={`${operatorScopeKey}:${scopeKey}`}
            open={createOpen}
            scope={scope}
            operatorScopeKey={operatorScopeKey}
            authorityCurrent={createAuthorityCurrent}
            authoritySource={permissionSource}
            onClose={() => setCreateOpen(false)}
            onCreated={async (created, submission) => {
              const active = activeScopeRef.current;
              if (!dataRightsSubmissionMatches(
                active.operatorScopeKey,
                active.scopeKey,
                submission.operatorScopeKey,
                submission.scopeKey,
              )) return;
              queryClient.setQueryData(
                dataRightsCaseQueryKey(scopeKey, created.id, operatorScopeKey),
                created,
              );
              await queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] });
              setCreateOpen(false);
              selectCase(created.id);
            }}
          />

          <PrivacyRequestDetail
            key={`${operatorScopeKey}:${scopeKey}:${selectedCaseId ?? "closed"}`}
            scope={scope}
            caseId={selectedCaseId}
            capabilities={capabilities}
            operatorScopeKey={operatorScopeKey}
            permissionSource={permissionSource}
            erasePermissionSource={erasePermissionSource}
            onClose={() => selectCase(null)}
          />
        </>
      )}
    </>
  );
}

function PrivacyRequestRow({
  item,
  focused,
  onOpen,
}: {
  item: DataRightsCaseSummary;
  focused: boolean;
  onOpen: () => void;
}) {
  const status = dataRightsCaseStatusKey(item.status);
  const operationKind = dataRightsOperationKind(item);
  return (
    <button
      type="button"
      className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-base-200/65 focus-visible:bg-base-200/65 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:px-6 ${focused ? focusedResourceClass : ""}`}
      onClick={onOpen}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileLock2 size={18} />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">{dataRightsRequestLabel(item)}</span>
          <span className="mt-1 block text-xs text-base-content/45">
            Request {shortDataRightsCaseId(item.id)} - opened {formatDateTime(item.createdAtUtc)}
          </span>
        </span>
      </div>
      <span className="text-xs text-base-content/50 sm:text-right">
        <span className="block font-semibold text-base-content/70">
          {stageDescription(status, operationKind)}
        </span>
        <span className="mt-1 block">
          {item.selectedSubjectCount} {item.selectedSubjectCount === 1 ? "record" : "records"} selected
        </span>
        <ResponseDeadlineIndicator item={item} />
      </span>
      <span className="flex items-center justify-between gap-3 sm:justify-end">
        <StatusBadge status={dataRightsCaseStatusLabel(item.status)} />
        <ChevronRight size={17} className="text-base-content/35" />
      </span>
    </button>
  );
}

function ResponseDeadlineIndicator({ item }: { item: DataRightsCaseSummary }) {
  const state = dataRightsResponseDeadlineState(item);
  if (state === "not-applicable") return null;

  const dueAt = item.dueAtUtc ? formatDateTime(item.dueAtUtc) : null;
  const label = state === "pending"
    ? "Deadline policy pending"
    : state === "due-soon"
      ? `Due soon - ${dueAt}`
      : state === "overdue"
        ? `Overdue - ${dueAt}`
        : state === "closed"
          ? `Deadline ${dueAt}`
          : `Due ${dueAt}`;
  const className = state === "overdue"
    ? "bg-error/10 text-error"
    : state === "pending" || state === "due-soon"
      ? "bg-warning/15 text-warning-content"
      : "bg-base-200 text-base-content/60";
  const Icon = state === "pending" || state === "overdue" ? TriangleAlert : Clock3;

  return (
    <span className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium ${className}`}>
      <Icon size={13} />
      {label}
    </span>
  );
}

function CreatePrivacyRequestModal({
  open,
  scope,
  operatorScopeKey,
  authorityCurrent,
  authoritySource,
  onClose,
  onCreated,
}: {
  open: boolean;
  scope: DataRightsRequestScope;
  operatorScopeKey: string;
  authorityCurrent: boolean;
  authoritySource: ReturnType<typeof createCompositeSource>;
  onClose: () => void;
  onCreated: (
    created: DataRightsCase,
    submission: { scopeKey: string; operatorScopeKey: string },
  ) => Promise<void>;
}) {
  const { request } = useSession();
  const createAttempt = useRef<DataRightsCaseCreateAttempt | null>(null);
  const [purpose, setPurpose] = useState<DataRightsOperationKind>("export");
  const [relationship, setRelationship] = useState("1");
  const operationKind = purpose;
  const requestedOperations = operationKind === "export"
    ? DATA_RIGHTS_ACCESS_EXPORT
    : operationKind === "correction"
      ? DATA_RIGHTS_CORRECTION
    : operationKind === "removal"
      ? DATA_RIGHTS_ANONYMISATION
      : DATA_RIGHTS_RESTRICTION;
  const restrictionDirective = operationKind === "restriction-apply"
    ? DATA_RIGHTS_RESTRICTION_APPLY
    : operationKind === "restriction-release"
      ? DATA_RIGHTS_RESTRICTION_RELEASE
      : 0;
  const requesterRelationship = Number(relationship) as DataRightsRequesterRelationship;
  const scopeKey = dataRightsScopeKey(scope);
  const authorityRef = useRef({ authorityCurrent, operatorScopeKey, scopeKey });
  authorityRef.current = { authorityCurrent, operatorScopeKey, scopeKey };
  const mutation = useMutation({
    mutationFn: (submission: {
      scopeKey: string;
      operatorScopeKey: string;
      casesPath: string;
      requestedOperations: number;
      restrictionDirective: number;
      requesterRelationship: DataRightsRequesterRelationship;
    }) => {
      const active = authorityRef.current;
      if (!dataRightsMutationAllowed("create-case", {
        permissionsCurrent: active.authorityCurrent,
      }) || !dataRightsSubmissionMatches(
        active.operatorScopeKey,
        active.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) {
        throw dataRightsSourceChangedError();
      }
      createAttempt.current = resolveDataRightsCaseCreateAttempt(
        createAttempt.current,
        {
          scopeKey: submission.scopeKey,
          requestedOperations: submission.requestedOperations,
          restrictionDirective: submission.restrictionDirective,
          requesterRelationship: submission.requesterRelationship,
        },
      );
      return request<DataRightsCase>(
        submission.casesPath,
        {
          method: "POST",
          body: JSON.stringify({
            operationId: createAttempt.current.operationId,
            requestedOperations: submission.requestedOperations,
            restrictionDirective: submission.restrictionDirective,
            requesterRelationship: submission.requesterRelationship,
          }),
        },
      );
    },
    onSuccess: async (created, submission) => {
      const active = authorityRef.current;
      if (!active.authorityCurrent || !dataRightsSubmissionMatches(
        active.operatorScopeKey,
        active.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) return;
      await onCreated(created, submission);
      createAttempt.current = null;
    },
  });

  useEffect(() => {
    if (!open) return;
    createAttempt.current = null;
    setPurpose("export");
    setRelationship("1");
    mutation.reset();
  }, [open, scopeKey]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorityCurrent) return;
    mutation.mutate({
      scopeKey,
      operatorScopeKey,
      casesPath: dataRightsCasesPath(scope),
      requestedOperations,
      restrictionDirective,
      requesterRelationship,
    });
  }

  return (
    <Modal
      open={open}
      title={scope.kind === "staff" ? "New staff privacy request" : "New guest privacy request"}
      description="Start a controlled workflow. Matching, approval and execution remain separate actions."
      onClose={onClose}
    >
      <form className="space-y-5" onSubmit={submit}>
        <CompositeSourceNotice
          sources={[authoritySource]}
          title="Privacy request creation is delayed"
        />
        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">
            Request type
          </span>
          <SelectPicker
            className="w-full"
            value={purpose}
            ariaLabel="Privacy request type"
            onValueChange={(value) => setPurpose(value as DataRightsOperationKind)}
            options={scope.kind === "staff"
              ? [
                {
                  value: "export",
                  label: "Data export",
                  description: "Prepare an encrypted copy of selected Staff records.",
                },
                {
                  value: "removal",
                  label: "Staff data removal",
                  description: "Remove one eligible departed Staff profile after approval.",
                },
              ]
              : [
                {
                  value: "export",
                  label: "Data export",
                  description: "Prepare an encrypted copy of selected guest records.",
                },
                {
                  value: "correction",
                  label: "Correct guest data",
                  description: "Correct one selected Guest Record or reservation.",
                },
                {
                  value: "restriction-apply",
                  label: "Limit data processing",
                  description: "Add a reversible processing limit to one Guest Record.",
                },
                {
                  value: "restriction-release",
                  label: "Release processing limit",
                  description: "Release one unambiguous active processing limit.",
                },
                {
                  value: "removal",
                  label: "Data removal",
                  description: "Permanently remove eligible data from selected records.",
                },
              ]}
          />
        </label>
        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">
            Who requested this?
          </span>
          <SelectPicker
            className="w-full"
            value={relationship}
            onValueChange={setRelationship}
            ariaLabel="Privacy request source"
            options={[
              {
                value: "1",
                label: scope.kind === "staff" ? "The staff member" : "The guest",
                description: "Identity verification and controller routing are required.",
              },
              {
                value: "2",
                label: "An authorized representative",
                description: "Authority, identity and controller routing are required.",
              },
              {
                value: "3",
                label: "Workspace initiated",
                description: workspaceInitiatedDescription(operationKind),
              },
            ]}
          />
        </label>
        <div className={`rounded-lg border p-4 ${
          operationKind === "removal"
            ? "border-warning/25 bg-warning/8"
            : operationKind === "correction"
              ? "border-success/25 bg-success/8"
            : operationKind.startsWith("restriction")
              ? "border-primary/25 bg-primary/8"
              : "border-info/25 bg-info/8"
        }`}>
          <p className="text-sm font-semibold">
            {requestPurposeTitle(operationKind)}
          </p>
          <p className="mt-1 text-xs leading-5 text-base-content/55">
            {requestPurposeDescription(operationKind)}
          </p>
        </div>
        {mutation.error && <ErrorState error={mutation.error} />}
        <FormActions
          submitting={mutation.isPending}
          submitLabel="Create request"
          onCancel={onClose}
          disabled={!authorityCurrent}
        />
      </form>
    </Modal>
  );
}

function stageDescription(status: string, operationKind: DataRightsOperationKind): string {
  if (status === "draft") return "Intake";
  if (status === "discovery") return "Match records";
  if (status === "reviewRequired" || status === "decisionPending") return "Review";
  if (status === "approved") {
    if (operationKind === "export") return "Ready to generate";
    if (operationKind === "correction") return "Ready to correct";
    if (operationKind.startsWith("restriction")) return "Ready to apply";
    return "Ready for another operator";
  }
  if (status === "executing") {
    return operationKind === "correction" ? "Correction in progress" : "Removal in progress";
  }
  if (status === "completed") {
    if (operationKind === "export") return "Export generated";
    if (operationKind === "correction") return "Correction completed";
    if (operationKind === "restriction-apply") return "Processing limit applied";
    if (operationKind === "restriction-release") return "Processing limit released";
    return "Removal completed";
  }
  if (status === "blocked") return "Needs attention";
  return "Closed";
}

function workspaceInitiatedDescription(operationKind: DataRightsOperationKind): string {
  if (operationKind === "export") return "Use for an internally initiated access review.";
  if (operationKind === "correction") {
    return "Use when the workspace identifies incorrect guest or reservation data.";
  }
  if (operationKind === "restriction-apply") {
    return "Use when the workspace must limit processing for an identified guest.";
  }
  if (operationKind === "restriction-release") {
    return "Use when the workspace has confirmed a processing limit can be released.";
  }
  return "Use for an internally initiated removal review.";
}

function requestPurposeTitle(operationKind: DataRightsOperationKind): string {
  if (operationKind === "export") {
    return "The export stays limited to explicitly selected records.";
  }
  if (operationKind === "correction") {
    return "The correction stays owned by the module that stores the selected record.";
  }
  if (operationKind === "restriction-apply") {
    return "This adds a reversible processing obligation.";
  }
  if (operationKind === "restriction-release") {
    return "A release fails closed if the active obligation is ambiguous.";
  }
  return "This workflow can permanently remove personal data.";
}

function requestPurposeDescription(operationKind: DataRightsOperationKind): string {
  if (operationKind === "export") {
    return "Generation and download require separate permissions. The encrypted artifact expires automatically.";
  }
  if (operationKind === "correction") {
    return "Select exactly one Guest Record or reservation. Approval freezes that record revision before any values can change.";
  }
  if (operationKind === "restriction-apply") {
    return "Select exactly one Guest Record. Existing restrictions remain independently effective.";
  }
  if (operationKind === "restriction-release") {
    return "Select exactly one Guest Record. Release proceeds only when exactly one active restriction exists.";
  }
  return "BunkFy verifies policy eligibility before approval and requires another authorized staff member to execute it.";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
