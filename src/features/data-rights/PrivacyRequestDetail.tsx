import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileLock2,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DataRightsCase,
  DataRightsExecution,
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
import {
  PrivacyRequestActions,
  type PrivacyRequestConfirmation,
} from "./PrivacyRequestActions";
import {
  availableDataRightsActions,
  dataRightsCaseNeedsLiveRefresh,
  dataRightsCaseStatusKey,
  dataRightsCaseStatusLabel,
  dataRightsExecutionNeedsLiveRefresh,
  dataRightsExecutionStatusLabel,
  shortDataRightsCaseId,
  type DataRightsCapabilities,
} from "./dataRightsWorkflow";

type CaseActionRequest = { suffix: string; body: Record<string, unknown> };

export function PrivacyRequestDetail({
  propertyId,
  caseId,
  capabilities,
  onClose,
}: {
  propertyId: string;
  caseId: string | null;
  capabilities: DataRightsCapabilities;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<PrivacyRequestConfirmation | null>(null);
  const [denialReason, setDenialReason] = useState("3");
  const [destructiveConfirmation, setDestructiveConfirmation] = useState("");
  const executionAttempt = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const observedTerminalExecution = useRef<string | null>(null);
  const basePath = `/api/data-rights/properties/${propertyId}/cases/${caseId}`;
  const caseQuery = useQuery({
    queryKey: ["data-rights-case", propertyId, caseId],
    queryFn: () => request<DataRightsCase>(basePath),
    enabled: Boolean(caseId && capabilities.read),
    refetchInterval: (query) => dataRightsCaseNeedsLiveRefresh(query.state.data?.status)
      ? 2_000
      : false,
    refetchIntervalInBackground: false,
  });
  const dataRightsCase = caseQuery.data;
  const status = dataRightsCase ? dataRightsCaseStatusKey(dataRightsCase.status) : "unknown";
  const selected = useQuery({
    queryKey: ["data-rights-subjects", propertyId, caseId],
    queryFn: () => request<DataRightsSelectedSubjectsResponse>(`${basePath}/subjects`),
    enabled: Boolean(
      caseId &&
      dataRightsCase &&
      dataRightsCase.selectedSubjectCount > 0 &&
      capabilities.discover,
    ),
  });
  const execution = useQuery({
    queryKey: ["data-rights-execution", propertyId, caseId],
    queryFn: () => request<DataRightsExecution>(`${basePath}/execution`),
    enabled: Boolean(caseId && ["executing", "blocked", "completed", "partiallyCompleted"].includes(status)),
    refetchInterval: (query) => dataRightsExecutionNeedsLiveRefresh(query.state.data?.workItem.status)
      ? 2_000
      : false,
    refetchIntervalInBackground: false,
  });
  const actions = useMemo(
    () => dataRightsCase ? availableDataRightsActions(dataRightsCase, capabilities) : [],
    [capabilities, dataRightsCase],
  );

  async function updateCase(updated: DataRightsCase) {
    queryClient.setQueryData(["data-rights-case", propertyId, updated.id], updated);
    await queryClient.invalidateQueries({ queryKey: ["data-rights-cases", propertyId] });
  }

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
      if (!executionAttempt.current || executionAttempt.current.fingerprint !== fingerprint) {
        executionAttempt.current = {
          fingerprint,
          idempotencyKey: crypto.randomUUID(),
        };
      }
      return request<DataRightsExecution>(`${basePath}/execution`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: executionAttempt.current.idempotencyKey,
          expectedVersion: currentCase.version,
        }),
      });
    },
    onSuccess: async (result) => {
      executionAttempt.current = null;
      setConfirmation(null);
      setDestructiveConfirmation("");
      queryClient.setQueryData(["data-rights-execution", propertyId, result.case.id], result);
      await updateCase(result.case);
    },
    onError: async () => {
      await caseQuery.refetch();
    },
  });

  useEffect(() => {
    setConfirmation(null);
    setDenialReason("3");
    setDestructiveConfirmation("");
    executionAttempt.current = null;
    observedTerminalExecution.current = null;
  }, [caseId, propertyId]);

  useEffect(() => {
    const workItem = execution.data?.workItem;
    if (!workItem || dataRightsExecutionNeedsLiveRefresh(workItem.status)) return;
    const terminalKey = `${workItem.id}:${workItem.version}:${workItem.status}`;
    if (observedTerminalExecution.current === terminalKey) return;
    observedTerminalExecution.current = terminalKey;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["data-rights-cases", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["data-rights-case", propertyId, caseId] }),
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-history", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-stays", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
    ]);
  }, [caseId, execution.data?.workItem, propertyId, queryClient]);

  function perform(suffix: string, body: Record<string, unknown> = {}) {
    if (!dataRightsCase) return;
    actionMutation.mutate({
      suffix,
      body: { ...body, expectedVersion: dataRightsCase.version },
    });
  }

  function execute() {
    if (!dataRightsCase) return;
    executeMutation.mutate({
      currentCase: dataRightsCase,
      fingerprint: `${dataRightsCase.id}:${dataRightsCase.version}`,
    });
  }

  return (
    <Modal
      open={Boolean(caseId)}
      title={dataRightsCase ? `Privacy request ${shortDataRightsCaseId(dataRightsCase.id)}` : "Privacy request"}
      description="One reservation, one controlled decision, and a separately authorized removal."
      onClose={onClose}
      size="lg"
    >
      {caseQuery.isLoading
        ? <LoadingState label="Loading privacy request" />
        : caseQuery.error || !dataRightsCase
          ? <ErrorState error={caseQuery.error} retry={() => void caseQuery.refetch()} />
          : (
            <div className="space-y-5">
              <RequestSummary dataRightsCase={dataRightsCase} execution={execution.data} />
              <WorkflowProgress status={status} />

              {status === "discovery" && capabilities.discover && (
                <PrivacyRequestDiscovery
                  propertyId={propertyId}
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
                  <h3 className="font-display text-lg font-semibold">Selected reservation</h3>
                  {selected.isLoading
                    ? <p className="mt-3 text-sm text-base-content/50">Loading selection...</p>
                    : selected.data?.subjects[0]
                      ? (
                        <p className="mt-3 rounded-lg bg-base-200 px-4 py-3 text-sm">
                          Reservation <strong>{shortRecordId(selected.data.subjects[0].recordId)}</strong>
                          <span className="ml-2 text-base-content/50">
                            at record version {selected.data.subjects[0].recordVersion}
                          </span>
                        </p>
                      )
                      : null}
                </section>
              )}

              <PrivacyRequestActions
                actions={actions}
                confirmation={confirmation}
                denialReason={denialReason}
                destructiveConfirmation={destructiveConfirmation}
                pending={actionMutation.isPending || executeMutation.isPending}
                onConfirmationChange={setConfirmation}
                onDenialReasonChange={setDenialReason}
                onDestructiveConfirmationChange={setDestructiveConfirmation}
                onPerform={perform}
                onExecute={execute}
              />

              {(actionMutation.error || executeMutation.error || execution.error) && (
                <ErrorState error={actionMutation.error ?? executeMutation.error ?? execution.error} />
              )}
            </div>
          )}
    </Modal>
  );
}

function RequestSummary({
  dataRightsCase,
  execution,
}: {
  dataRightsCase: DataRightsCase;
  execution: DataRightsExecution | undefined;
}) {
  return (
    <section className="rounded-lg bg-base-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-base-content/45">Reservation data removal</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {requesterLabel(dataRightsCase.requesterRelationship)}
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
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-base-300 pt-4 text-sm">
          <span className="text-base-content/55">Removal work item</span>
          <StatusBadge status={dataRightsExecutionStatusLabel(execution.workItem.status)} />
        </div>
      )}
    </section>
  );
}

function WorkflowProgress({ status }: { status: string }) {
  const stages = [
    { key: "intake", label: "Intake", icon: UserCheck },
    { key: "match", label: "Match", icon: Search },
    { key: "review", label: "Review", icon: ShieldCheck },
    { key: "approval", label: "Approval", icon: CheckCircle2 },
    { key: "removal", label: "Removal", icon: FileLock2 },
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

function requesterLabel(relationship: number): string {
  if (relationship === 1) return "Requested by the guest";
  if (relationship === 2) return "Requested by an authorized representative";
  if (relationship === 3) return "Workspace initiated";
  return "Privacy request";
}

function shortRecordId(value: string): string {
  return value.replaceAll("-", "").slice(0, 8).toUpperCase();
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
