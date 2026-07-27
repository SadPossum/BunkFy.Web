import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileOutput,
  FileLock2,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DataRightsCase,
  DataRightsExecution,
  DataRightsRestrictionExecution,
  DataRightsSelectedSubjectsResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import {
  ErrorState,
  LoadingState,
  Modal,
  StatusBadge,
} from "../../components/ui/primitives";
import { PrivacyRequestDiscovery } from "./PrivacyRequestDiscovery";
import { PrivacyRequestExport } from "./PrivacyRequestExport";
import {
  PrivacyRequestActions,
  type PrivacyRequestConfirmation,
} from "./PrivacyRequestActions";
import {
  availableDataRightsActions,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsCaseStatusKey,
  dataRightsCaseStatusLabel,
  dataRightsExecutionBatchNeedsLiveRefresh,
  dataRightsExecutionStatusLabel,
  dataRightsCasesPath,
  dataRightsOperationKind,
  dataRightsRequestLabel,
  dataRightsRequesterLabel,
  dataRightsScopeKey,
  shortDataRightsCaseId,
  type DataRightsCapabilities,
  type DataRightsOperationKind,
  type DataRightsRequestScope,
} from "./dataRightsWorkflow";

type CaseActionRequest = { suffix: string; body: Record<string, unknown> };

export function PrivacyRequestDetail({
  scope,
  caseId,
  capabilities,
  onClose,
}: {
  scope: DataRightsRequestScope;
  caseId: string | null;
  capabilities: DataRightsCapabilities;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<PrivacyRequestConfirmation | null>(null);
  const [denialReason, setDenialReason] = useState("3");
  const [destructiveConfirmation, setDestructiveConfirmation] = useState("");
  const [restrictionExecution, setRestrictionExecution] =
    useState<DataRightsRestrictionExecution | null>(null);
  const operationAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const observedTerminalExecution = useRef<string | null>(null);
  const scopeKey = dataRightsScopeKey(scope);
  const casesPath = dataRightsCasesPath(scope);
  const basePath = `${casesPath}/${caseId}`;
  const caseQuery = useQuery({
    queryKey: ["data-rights-case", scopeKey, caseId],
    queryFn: () => request<DataRightsCase>(basePath),
    enabled: Boolean(caseId && capabilities.read),
    refetchInterval: (query) => dataRightsCaseNeedsLiveRefresh(query.state.data?.status)
      ? 2_000
      : false,
    refetchIntervalInBackground: false,
  });
  const dataRightsCase = caseQuery.data;
  const status = dataRightsCase ? dataRightsCaseStatusKey(dataRightsCase.status) : "unknown";
  const operationKind = dataRightsCase
    ? dataRightsOperationKind(dataRightsCase)
    : "other";
  const selected = useQuery({
    queryKey: ["data-rights-subjects", scopeKey, caseId],
    queryFn: () => request<DataRightsSelectedSubjectsResponse>(`${basePath}/subjects`),
    enabled: Boolean(
      caseId &&
      dataRightsCase &&
      dataRightsCase.selectedSubjectCount > 0 &&
      capabilities.discover,
    ),
  });
  const execution = useQuery({
    queryKey: ["data-rights-execution", scopeKey, caseId],
    queryFn: () => request<DataRightsExecution>(`${basePath}/execution`),
    enabled: Boolean(
      caseId &&
      scope.kind === "guest" &&
      operationKind === "removal" &&
      ["executing", "blocked", "completed", "partiallyCompleted"].includes(status),
    ),
    refetchInterval: (query) => dataRightsExecutionBatchNeedsLiveRefresh(query.state.data?.workItems)
      ? 2_000
      : false,
    refetchIntervalInBackground: false,
  });
  const actions = useMemo(
    () => dataRightsCase ? availableDataRightsActions(dataRightsCase, capabilities) : [],
    [capabilities, dataRightsCase],
  );

  const updateCase = useCallback(async (updated: DataRightsCase) => {
    queryClient.setQueryData(["data-rights-case", scopeKey, updated.id], updated);
    await queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] });
  }, [queryClient, scopeKey]);

  const refreshCaseState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] }),
      queryClient.invalidateQueries({ queryKey: ["data-rights-case", scopeKey, caseId] }),
    ]);
  }, [caseId, queryClient, scopeKey]);

  const refreshGuestProjectionState = useCallback(async () => {
    if (scope.kind !== "guest") return;
    const propertyId = scope.propertyId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] }),
      queryClient.invalidateQueries({ queryKey: ["data-rights-case", scopeKey, caseId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-list", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-detail", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-picker", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-history", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-stays", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["ingestion-proposals", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["ingestion-receipts", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["ingestion-runs", propertyId] }),
    ]);
  }, [caseId, queryClient, scope, scopeKey]);

  const actionMutation = useMutation({
    mutationFn: ({ suffix, body }: CaseActionRequest) => request<DataRightsCase>(
      `${basePath}${suffix}`,
      { method: "POST", body: JSON.stringify(body) },
    ),
    onSuccess: async (updated) => {
      setConfirmation(null);
      await updateCase(updated);
    },
    onError: async () => {
      await caseQuery.refetch();
    },
  });
  const executeMutation = useMutation({
    mutationFn: ({
      currentCase,
      fingerprint,
    }: {
      currentCase: DataRightsCase;
      fingerprint: string;
    }) => {
      if (!operationAttempt.current || operationAttempt.current.fingerprint !== fingerprint) {
        operationAttempt.current = {
          fingerprint,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      return request<DataRightsExecution>(`${basePath}/execution`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: operationAttempt.current.idempotencyKey,
          expectedVersion: currentCase.version,
        }),
      });
    },
    onSuccess: async (result) => {
      operationAttempt.current = null;
      setConfirmation(null);
      setDestructiveConfirmation("");
      queryClient.setQueryData(["data-rights-execution", scopeKey, result.case.id], result);
      await updateCase(result.case);
    },
    onError: async () => {
      await caseQuery.refetch();
    },
  });
  const restrictionMutation = useMutation({
    mutationFn: ({
      currentCase,
      fingerprint,
    }: {
      currentCase: DataRightsCase;
      fingerprint: string;
    }) => {
      if (!operationAttempt.current || operationAttempt.current.fingerprint !== fingerprint) {
        operationAttempt.current = {
          fingerprint,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      return request<DataRightsRestrictionExecution>(`${basePath}/restriction`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: operationAttempt.current.idempotencyKey,
          expectedVersion: currentCase.version,
        }),
      });
    },
    onSuccess: async (result) => {
      operationAttempt.current = null;
      setConfirmation(null);
      setRestrictionExecution(result);
      await updateCase(result.case);
      await refreshGuestProjectionState();
    },
    onError: async () => {
      await caseQuery.refetch();
    },
  });

  useEffect(() => {
    setConfirmation(null);
    setDenialReason("3");
    setDestructiveConfirmation("");
    setRestrictionExecution(null);
    operationAttempt.current = null;
    observedTerminalExecution.current = null;
  }, [caseId, scopeKey]);

  useEffect(() => {
    const workItems = execution.data?.workItems;
    if (!workItems?.length || dataRightsExecutionBatchNeedsLiveRefresh(workItems)) return;
    const terminalKey = workItems
      .map((workItem) => `${workItem.id}:${workItem.version}:${workItem.status}`)
      .sort()
      .join("|");
    if (observedTerminalExecution.current === terminalKey) return;
    observedTerminalExecution.current = terminalKey;
    void refreshGuestProjectionState();
  }, [execution.data?.workItems, refreshGuestProjectionState]);

  function perform(suffix: string, body: Record<string, unknown> = {}) {
    if (!dataRightsCase) return;
    actionMutation.mutate({
      suffix,
      body: { ...body, expectedVersion: dataRightsCase.version },
    });
  }

  function execute(selectedOperation: DataRightsOperationKind) {
    if (!dataRightsCase) return;
    const fingerprint =
      `${selectedOperation}:${dataRightsCase.id}:${dataRightsCase.version}`;
    if (selectedOperation.startsWith("restriction")) {
      restrictionMutation.mutate({
        currentCase: dataRightsCase,
        fingerprint,
      });
      return;
    }
    executeMutation.mutate({
      currentCase: dataRightsCase,
      fingerprint,
    });
  }

  return (
    <Modal
      open={Boolean(caseId)}
      title={dataRightsCase ? `Privacy request ${shortDataRightsCaseId(dataRightsCase.id)}` : "Privacy request"}
      description="Explicit records, one controlled decision, and separately authorized execution."
      onClose={onClose}
      size="lg"
    >
      {caseQuery.isLoading
        ? <LoadingState label="Loading privacy request" />
        : caseQuery.error || !dataRightsCase
          ? <ErrorState error={caseQuery.error} retry={() => void caseQuery.refetch()} />
          : (
            <div className="space-y-5">
              <RequestSummary
                dataRightsCase={dataRightsCase}
                execution={execution.data}
                restrictionExecution={restrictionExecution}
                scopeKind={scope.kind}
              />
              <WorkflowProgress status={status} operationKind={operationKind} />

              {status === "discovery" && capabilities.discover && (
                <PrivacyRequestDiscovery
                  basePath={basePath}
                  scopeKind={scope.kind}
                  dataRightsCase={dataRightsCase}
                  selected={selected.data}
                  selectedLoading={selected.isLoading}
                  onCaseUpdated={updateCase}
                  refreshSelected={() => selected.refetch()}
                />
              )}

              {status !== "discovery" &&
                dataRightsCase.selectedSubjectCount > 0 &&
                capabilities.discover && (
                <section className="border-t border-base-300 pt-5">
                  <h3 className="font-display text-lg font-semibold">Selected records</h3>
                  {selected.isLoading
                    ? <p className="mt-3 text-sm text-base-content/50">Loading selections...</p>
                    : selected.data?.subjects.length
                      ? (
                        <div className="mt-3 divide-y divide-base-300 rounded-lg bg-base-200 px-4">
                          {selected.data.subjects.map((subject) => (
                            <p
                              key={`${subject.ownerKey}:${subject.recordType}:${subject.recordId}`}
                              className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                            >
                              <span>
                                {dataOwnerLabel(subject.ownerKey)}{" "}
                                <strong>{shortRecordId(subject.recordId)}</strong>
                              </span>
                              <span className="text-xs text-base-content/50">
                                Record version {subject.recordVersion}
                              </span>
                            </p>
                          ))}
                        </div>
                      )
                      : null}
                </section>
              )}

              {operationKind === "export" &&
                ["approved", "completed"].includes(status) &&
                capabilities.export && (
                <PrivacyRequestExport
                  basePath={basePath}
                  scopeKey={scopeKey}
                  dataRightsCase={dataRightsCase}
                  canGenerate={actions.includes("generate-export")}
                  canDownload={capabilities.downloadExport}
                  onTerminalState={refreshCaseState}
                />
              )}

              <PrivacyRequestActions
                actions={actions.filter((action) => action !== "generate-export")}
                operationKind={operationKind}
                confirmation={confirmation}
                denialReason={denialReason}
                destructiveConfirmation={destructiveConfirmation}
                pending={
                  actionMutation.isPending ||
                  executeMutation.isPending ||
                  restrictionMutation.isPending
                }
                onConfirmationChange={setConfirmation}
                onDenialReasonChange={setDenialReason}
                onDestructiveConfirmationChange={setDestructiveConfirmation}
                onPerform={perform}
                onExecute={execute}
              />

              {(actionMutation.error ||
                executeMutation.error ||
                restrictionMutation.error ||
                execution.error) && (
                <ErrorState
                  error={
                    actionMutation.error ??
                    executeMutation.error ??
                    restrictionMutation.error ??
                    execution.error
                  }
                />
              )}
            </div>
          )}
    </Modal>
  );
}

function RequestSummary({
  dataRightsCase,
  execution,
  restrictionExecution,
  scopeKind,
}: {
  dataRightsCase: DataRightsCase;
  execution: DataRightsExecution | undefined;
  restrictionExecution: DataRightsRestrictionExecution | null;
  scopeKind: DataRightsRequestScope["kind"];
}) {
  return (
    <section className="rounded-lg bg-base-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-base-content/45">
            {dataRightsRequestLabel(dataRightsCase)}
          </p>
          <p className="mt-2 font-display text-xl font-semibold">
            {dataRightsRequesterLabel(
              dataRightsCase.requesterRelationship,
              scopeKind,
            )}
          </p>
          <p className="mt-1 text-sm text-base-content/55">
            Opened {formatDateTime(dataRightsCase.createdAtUtc)}
            {dataRightsCase.dueAtUtc ? ` - due ${formatDateTime(dataRightsCase.dueAtUtc)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <StatusBadge status={dataRightsCaseStatusLabel(dataRightsCase.status)} />
          <p className="mt-2 text-xs text-base-content/45">Case version {dataRightsCase.version}</p>
        </div>
      </div>
      {execution && (
        <div className="mt-4 border-t border-base-300 pt-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="font-semibold">Removal work</span>
            <span className="text-xs text-base-content/50">
              {execution.workItems.length} of {execution.batch.selectedSubjectCount} records prepared
            </span>
          </div>
          <div className="mt-2 divide-y divide-base-300">
            {execution.workItems.map((workItem) => (
              <div
                key={workItem.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <span className="text-base-content/55">
                  {dataOwnerLabel(workItem.ownerKey)} {shortRecordId(workItem.recordId)}
                </span>
                <StatusBadge status={dataRightsExecutionStatusLabel(workItem.status)} />
              </div>
            ))}
          </div>
        </div>
      )}
      {restrictionExecution && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4 text-sm">
          <div>
            <p className="font-semibold">Processing limit receipt</p>
            <p className="mt-1 text-xs text-base-content/50">
              Owner revision {restrictionExecution.proof.resultingOwnerRevision} -
              projection revision {restrictionExecution.proof.resultingProjectionRevision}
            </p>
          </div>
          <StatusBadge
            status={restrictionExecution.proof.effectiveRestricted ? "Applied" : "Released"}
          />
        </div>
      )}
    </section>
  );
}

function WorkflowProgress({
  status,
  operationKind,
}: {
  status: string;
  operationKind: DataRightsOperationKind;
}) {
  const terminalStage = operationKind === "export"
    ? { key: "export", label: "Export", icon: FileOutput }
    : operationKind.startsWith("restriction")
      ? { key: "restriction", label: "Processing limit", icon: ShieldCheck }
      : { key: "removal", label: "Removal", icon: FileLock2 };
  const stages = [
    { key: "intake", label: "Intake", icon: UserCheck },
    { key: "match", label: "Match", icon: Search },
    { key: "review", label: "Review", icon: ShieldCheck },
    { key: "approval", label: "Approval", icon: CheckCircle2 },
    terminalStage,
  ];
  const activeIndex = stageIndex(status);
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Privacy request progress">
      {stages.map(({ key, label, icon: Icon }, index) => {
        const complete = index < activeIndex || status === "completed";
        const active = index === activeIndex && status !== "completed";
        return (
          <li
            key={key}
            className={`flex min-h-14 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
              complete
                ? "border-success/25 bg-success/8 text-success"
                : active
                  ? "border-primary/30 bg-primary/8 text-primary"
                  : "border-base-300 text-base-content/35"
            }`}
          >
            <Icon size={15} />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function stageIndex(status: string): number {
  if (status === "draft") return 0;
  if (status === "discovery") return 1;
  if (status === "reviewRequired") return 2;
  if (status === "decisionPending" || status === "approved" || status === "denied") return 3;
  return 4;
}

function shortRecordId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
}

function dataOwnerLabel(ownerKey: string): string {
  if (ownerKey === "staff") return "Staff profile";
  if (ownerKey === "guests") return "Guest record";
  if (ownerKey === "reservations") return "Reservation";
  if (ownerKey === "ingestion") return "Source evidence";
  return "Data record";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
