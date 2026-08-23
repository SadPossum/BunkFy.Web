import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  FileOutput,
  FileLock2,
  PencilLine,
  Search,
  ShieldCheck,
  Target,
  TriangleAlert,
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
import { PrivacyRequestCorrection } from "./PrivacyRequestCorrection";
import { PrivacyRequestExport } from "./PrivacyRequestExport";
import {
  PrivacyRequestActions,
} from "./PrivacyRequestActions";
import {
  createDataRightsConfirmation,
  isDataRightsConfirmationCurrent,
  type DataRightsConfirmationAction,
  type DataRightsConfirmationSnapshot,
} from "./dataRightsConfirmation";
import { shortRestrictionTargetId } from "./dataRightsRestrictionTarget";
import {
  availableDataRightsActions,
  dataRightsActionRequiresReviewEvidence,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsCaseStatusKey,
  dataRightsCaseStatusLabel,
  dataRightsExecutionBatchNeedsLiveRefresh,
  dataRightsExecutionStatusLabel,
  dataRightsCasesPath,
  dataRightsOperationKind,
  dataRightsRequestLabel,
  dataRightsResponseDeadlineRightLabel,
  dataRightsResponseDeadlineState,
  dataRightsRequesterLabel,
  dataRightsSelectedEvidencePath,
  dataRightsScopeKey,
  isDataRightsSelectedEvidenceCurrent,
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
  const [confirmation, setConfirmation] =
    useState<DataRightsConfirmationSnapshot | null>(null);
  const [denialReason, setDenialReason] = useState("3");
  const [destructiveConfirmation, setDestructiveConfirmation] = useState("");
  const [restrictionExecution, setRestrictionExecution] =
    useState<DataRightsRestrictionExecution | null>(null);
  const [validatedRestrictionTarget, setValidatedRestrictionTarget] = useState<{
    caseId: string;
    caseVersion: number;
  } | null>(null);
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
  const selectedEvidencePath = caseId
    ? dataRightsSelectedEvidencePath(scope, caseId, capabilities)
    : null;
  const selected = useQuery({
    queryKey: [
      "data-rights-subjects",
      scopeKey,
      caseId,
      dataRightsCase?.version,
      selectedEvidencePath,
    ],
    queryFn: () => request<DataRightsSelectedSubjectsResponse>(selectedEvidencePath!),
    enabled: Boolean(
      caseId &&
      dataRightsCase &&
      dataRightsCase.selectedSubjectCount > 0 &&
      selectedEvidencePath,
    ),
  });
  const execution = useQuery({
    queryKey: ["data-rights-execution", scopeKey, caseId],
    queryFn: () => request<DataRightsExecution>(`${basePath}/execution`),
    enabled: Boolean(
      caseId &&
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
  const selectedEvidenceCurrent = Boolean(
    dataRightsCase &&
    !selected.error &&
    isDataRightsSelectedEvidenceCurrent(dataRightsCase, selected.data),
  );
  const selectedEvidenceRequired = actions.some(dataRightsActionRequiresReviewEvidence);
  let selectedEvidenceError: Error | null = null;
  if (selectedEvidenceRequired &&
      (!dataRightsCase || dataRightsCase.selectedSubjectCount <= 0)) {
    selectedEvidenceError = new Error(
      "This privacy request has no selected records to review.",
    );
  } else if (selectedEvidenceRequired && !selectedEvidencePath) {
    selectedEvidenceError = new Error(
      "This permission profile cannot read the selected records required for review.",
    );
  } else if (selectedEvidencePath && selected.error) {
    selectedEvidenceError = selected.error;
  } else if (selectedEvidencePath && selected.data && !selectedEvidenceCurrent) {
    selectedEvidenceError = new Error(
      "Refresh the selected records before continuing this privacy request.",
    );
  }
  const restrictionTargetValidationRequired = Boolean(
    dataRightsCase &&
    operationKind === "restriction-release" &&
    dataRightsCase.restrictionTargetingContractVersion !== null &&
    dataRightsCase.restrictionTargetingContractVersion !== undefined,
  );
  const restrictionTargetCurrent = Boolean(
    dataRightsCase &&
    validatedRestrictionTarget?.caseId === dataRightsCase.id &&
    validatedRestrictionTarget.caseVersion === dataRightsCase.version,
  );
  const visibleActions = useMemo(
    () => actions.filter((action) =>
      action !== "generate-export" &&
      action !== "execute-correction" &&
      !(dataRightsActionRequiresReviewEvidence(action) && !selectedEvidenceCurrent) &&
      !(action === "review" && restrictionTargetValidationRequired && !restrictionTargetCurrent)),
    [
      actions,
      restrictionTargetCurrent,
      restrictionTargetValidationRequired,
      selectedEvidenceCurrent,
    ],
  );
  const activeConfirmation = useMemo(
    () => confirmation && dataRightsCase && isDataRightsConfirmationCurrent(
      confirmation,
      dataRightsCase,
      operationKind,
      visibleActions,
    )
      ? confirmation
      : null,
    [confirmation, dataRightsCase, operationKind, visibleActions],
  );

  const updateCase = useCallback(async (updated: DataRightsCase) => {
    queryClient.setQueryData(["data-rights-case", scopeKey, updated.id], updated);
    await queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] });
  }, [queryClient, scopeKey]);

  const updateRestrictionTargetCurrent = useCallback((current: boolean) => {
    if (!current || !dataRightsCase) {
      setValidatedRestrictionTarget(null);
      return;
    }
    setValidatedRestrictionTarget({
      caseId: dataRightsCase.id,
      caseVersion: dataRightsCase.version,
    });
  }, [dataRightsCase]);

  const refreshCaseState = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] }),
      queryClient.invalidateQueries({ queryKey: ["data-rights-case", scopeKey, caseId] }),
    ]);
  }, [caseId, queryClient, scopeKey]);

  const refreshAffectedProjectionState = useCallback(async () => {
    const privacyQueries = [
      queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] }),
      queryClient.invalidateQueries({ queryKey: ["data-rights-case", scopeKey, caseId] }),
    ];
    if (scope.kind === "staff") {
      await Promise.all([
        ...privacyQueries,
        queryClient.invalidateQueries({ queryKey: ["staff-members"] }),
        queryClient.invalidateQueries({ queryKey: ["staff-member"] }),
      ]);
      return;
    }

    const propertyId = scope.propertyId;
    await Promise.all([
      ...privacyQueries,
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
      setDestructiveConfirmation("");
      await updateCase(updated);
    },
    onError: async () => {
      await caseQuery.refetch();
    },
  });
  const executeMutation = useMutation({
    mutationFn: ({
      expectedVersion,
      fingerprint,
    }: {
      expectedVersion: number;
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
          expectedVersion,
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
      expectedVersion,
      fingerprint,
    }: {
      expectedVersion: number;
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
          expectedVersion,
        }),
      });
    },
    onSuccess: async (result) => {
      operationAttempt.current = null;
      setConfirmation(null);
      setRestrictionExecution(result);
      await updateCase(result.case);
      await refreshAffectedProjectionState();
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
    if (!confirmation || activeConfirmation) return;
    setConfirmation(null);
    setDenialReason("3");
    setDestructiveConfirmation("");
  }, [activeConfirmation, confirmation]);

  useEffect(() => {
    const workItems = execution.data?.workItems;
    if (!workItems?.length || dataRightsExecutionBatchNeedsLiveRefresh(workItems)) return;
    const terminalKey = workItems
      .map((workItem) => `${workItem.id}:${workItem.version}:${workItem.status}`)
      .sort()
      .join("|");
    if (observedTerminalExecution.current === terminalKey) return;
    observedTerminalExecution.current = terminalKey;
    void refreshAffectedProjectionState();
  }, [execution.data?.workItems, refreshAffectedProjectionState]);

  function perform(
    suffix: string,
    body: Record<string, unknown> = {},
    expectedVersion?: number,
  ) {
    if (!dataRightsCase) return;
    actionMutation.mutate({
      suffix,
      body: {
        ...body,
        expectedVersion: expectedVersion ?? dataRightsCase.version,
      },
    });
  }

  function execute(
    selectedOperation: DataRightsOperationKind,
    expectedVersion?: number,
  ) {
    if (!dataRightsCase) return;
    const reviewedVersion = expectedVersion ?? dataRightsCase.version;
    const fingerprint =
      `${selectedOperation}:${dataRightsCase.id}:${reviewedVersion}`;
    if (selectedOperation.startsWith("restriction")) {
      restrictionMutation.mutate({
        expectedVersion: reviewedVersion,
        fingerprint,
      });
      return;
    }
    executeMutation.mutate({
      expectedVersion: reviewedVersion,
      fingerprint,
    });
  }

  function changeConfirmation(
    action: DataRightsConfirmationAction | null,
  ) {
    setDenialReason("3");
    setDestructiveConfirmation("");
    if (!action || !dataRightsCase || !visibleActions.includes(action)) {
      setConfirmation(null);
      return;
    }

    setConfirmation(createDataRightsConfirmation(
      action,
      dataRightsCase,
      operationKind,
    ));
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
                  refreshCase={() => caseQuery.refetch()}
                  onRestrictionTargetCurrentChange={updateRestrictionTargetCurrent}
                />
              )}

              {dataRightsCase.selectedSubjectCount > 0 &&
                selectedEvidencePath &&
                (status !== "discovery" || !capabilities.discover) && (
                <section className="border-t border-base-300 pt-5">
                  <h3 className="font-display text-lg font-semibold">Selected records</h3>
                  {selected.isLoading
                    ? <p className="mt-3 text-sm text-base-content/50">Loading selections...</p>
                    : selectedEvidenceCurrent && selected.data?.subjects.length
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

              {selectedEvidenceError && (
                <ErrorState
                  title="Review evidence unavailable"
                  error={selectedEvidenceError}
                  retry={selectedEvidencePath ? () => void selected.refetch() : undefined}
                />
              )}

              {status !== "discovery" && operationKind === "restriction-release" && (
                <RestrictionTargetSummary dataRightsCase={dataRightsCase} />
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

              {operationKind === "correction" &&
                ["approved", "executing", "completed"].includes(status) && (
                <PrivacyRequestCorrection
                  basePath={basePath}
                  scopeKey={scopeKey}
                  propertyId={
                    scope.kind === "guest"
                      ? scope.propertyId
                      : undefined
                  }
                  dataRightsCase={dataRightsCase}
                  selectedSubject={selected.data?.subjects[0]}
                  canStart={actions.includes("execute-correction")}
                  canExecute={capabilities.execute}
                  onCaseUpdated={updateCase}
                />
              )}

              <PrivacyRequestActions
                actions={visibleActions}
                operationKind={operationKind}
                confirmation={activeConfirmation}
                denialReason={denialReason}
                destructiveConfirmation={destructiveConfirmation}
                pending={
                  actionMutation.isPending ||
                  executeMutation.isPending ||
                  restrictionMutation.isPending
                }
                onConfirmationChange={changeConfirmation}
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
  const restrictionProof = restrictionExecution?.proof ??
    dataRightsCase.restrictionExecutionProof;
  const restrictionOutcome = restrictionProof
    ? restrictionOutcomeSummary(restrictionProof.directive, restrictionProof.effectiveRestricted)
    : null;
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
      <ResponseDeadlineSummary dataRightsCase={dataRightsCase} />
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
      {restrictionProof && restrictionOutcome && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4 text-sm">
          <div>
            <p className="font-semibold">{restrictionOutcome.title}</p>
            <p className="mt-1 text-xs text-base-content/50">
              {restrictionOutcome.description} Owner revision {restrictionProof.resultingOwnerRevision} -
              projection revision {restrictionProof.resultingProjectionRevision}.
            </p>
          </div>
          <StatusBadge status={restrictionOutcome.status} />
        </div>
      )}
    </section>
  );
}

function RestrictionTargetSummary({ dataRightsCase }: { dataRightsCase: DataRightsCase }) {
  const target = dataRightsCase.restrictionReleaseTarget;
  return (
    <section className="border-t border-base-300 pt-5">
      <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
        <Target size={17} className="text-primary" />
        Reviewed processing limit
      </h3>
      {target
        ? (
          <dl className="mt-3 grid gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:grid-cols-3">
            <DeadlineCoordinate
              label="Target"
              value={shortRestrictionTargetId(target.ownerOperationId)}
            />
            <DeadlineCoordinate
              label="Owner version"
              value={String(target.ownerOperationVersion)}
            />
            <DeadlineCoordinate
              label="Selected"
              value={formatDateTime(target.selectedAtUtc)}
            />
          </dl>
        )
        : (
          <p className="mt-3 rounded-lg border border-warning/25 bg-warning/8 px-4 py-3 text-sm text-base-content/65">
            This legacy release case predates target binding. It can release only one
            unambiguous active processing restriction.
          </p>
        )}
    </section>
  );
}

function restrictionOutcomeSummary(
  directive: number,
  effectiveRestricted: boolean,
): { title: string; description: string; status: string } {
  if (directive === 2 && effectiveRestricted) {
    return {
      title: "Selected restriction released",
      description: "Another processing restriction remains active.",
      status: "Still restricted",
    };
  }
  if (directive === 2) {
    return {
      title: "Restriction released",
      description: "No other active processing restriction remains for this owner record.",
      status: "Released",
    };
  }
  return {
    title: "Processing restriction applied",
    description: "The selected owner record remains processing-restricted.",
    status: "Applied",
  };
}

function ResponseDeadlineSummary({ dataRightsCase }: { dataRightsCase: DataRightsCase }) {
  const state = dataRightsResponseDeadlineState(dataRightsCase);
  if (state === "not-applicable") return null;

  const evidence = dataRightsCase.responseDeadlineEvidence;
  if (state === "pending") {
    return (
      <div className="mt-4 flex items-start gap-3 border-t border-warning/30 pt-4 text-sm">
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning-content" />
        <div>
          <p className="font-semibold">Response deadline policy pending</p>
          <p className="mt-1 text-base-content/60">
            Routing stays paused until this property has a deadline-ready country policy binding.
          </p>
        </div>
      </div>
    );
  }

  const dueAtUtc = dataRightsCase.dueAtUtc;
  if (!dueAtUtc) return null;

  const stateLabel = state === "overdue"
    ? "Overdue"
    : state === "due-soon"
      ? "Due soon"
      : state === "closed"
        ? "Deadline recorded"
        : "On schedule";
  const stateClassName = state === "overdue"
    ? "bg-error/10 text-error"
    : state === "due-soon"
      ? "bg-warning/15 text-warning-content"
      : "bg-success/10 text-success";

  return (
    <div className="mt-4 border-t border-base-300 pt-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Clock3 size={18} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">Response deadline</p>
            <p className="mt-1 text-base-content/60">
              {formatDeadlineDateTime(
                dueAtUtc,
                evidence?.timeZoneId,
              )}
            </p>
          </div>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${stateClassName}`}>
          {stateLabel}
        </span>
      </div>

      {evidence && (
        <>
          <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-base-300 pt-4 sm:grid-cols-2">
            <DeadlineCoordinate
              label="Controlling right"
              value={dataRightsResponseDeadlineRightLabel(Number(evidence.controllingRight))}
            />
            <DeadlineCoordinate
              label="Response period"
              value={responsePeriodLabel(evidence.periodYears, evidence.periodMonths, evidence.periodDays)}
            />
            <DeadlineCoordinate
              label="Country policy"
              value={`${evidence.operatingCountryCode} - ${evidence.policyId} v${evidence.policyVersion}`}
            />
            <DeadlineCoordinate label="Policy time zone" value={evidence.timeZoneId} />
          </dl>
          <details className="mt-3 border-t border-base-300 pt-3 text-xs text-base-content/55">
            <summary className="cursor-pointer font-semibold text-base-content/70">
              Deadline evidence
            </summary>
            <p className="mt-2 leading-5">
              Rule {evidence.ruleReference}. Evaluated {formatDateTime(evidence.evaluatedAtUtc)}
              {` from property topology revision ${evidence.propertyTopologySourceVersion} and policy revision ${evidence.propertyPolicySourceVersion}.`}
            </p>
          </details>
        </>
      )}
    </div>
  );
}

function DeadlineCoordinate({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-base-content/45">{label}</dt>
      <dd className="mt-1 font-medium text-base-content/75">{value}</dd>
    </div>
  );
}

function responsePeriodLabel(years: number, months: number, days: number): string {
  const parts = [
    years > 0 ? `${years} ${years === 1 ? "year" : "years"}` : null,
    months > 0 ? `${months} ${months === 1 ? "month" : "months"}` : null,
    days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(", ");
}

function formatDeadlineDateTime(value: string, timeZoneId?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZoneId,
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return formatDateTime(value);
  }
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
    : operationKind === "correction"
      ? { key: "correction", label: "Correction", icon: PencilLine }
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
