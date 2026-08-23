import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, PencilLine, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DataRightsCase,
  DataRightsCorrectionExecution,
  DataRightsCorrectionExecutionDetails,
  DataRightsSelectedSubject,
} from "../../api/types";
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { LoadingState, StatusBadge } from "../../components/ui/primitives";
import { CorrectionError } from "./CorrectionFormFields";
import {
  PrivacyRequestCorrectionOwnerEditor,
  type AppliedCorrectionReceipt as AppliedReceipt,
} from "./PrivacyRequestCorrectionOwnerEditor";
import {
  canEditCorrectionClaim,
  correctionCaseStatus,
  correctionClaimAction,
  correctionClaimExpired,
  correctionExecutionStatus,
} from "./dataRightsCorrectionWorkflow";
import {
  dataRightsCaseMatches,
  dataRightsCorrectionQueryKey,
  dataRightsMutationAllowed,
  dataRightsSourceChangedError,
  dataRightsSubmissionMatches,
  type DataRightsCaseSnapshot,
} from "./dataRightsSourceAuthority";

export function PrivacyRequestCorrection({
  basePath,
  scopeKey,
  propertyId,
  dataRightsCase,
  selectedSubject,
  canStart,
  canExecute,
  operatorScopeKey,
  permissionCurrent,
  caseCurrent,
  selectedEvidenceCurrent,
  onCaseUpdated,
}: {
  basePath: string;
  scopeKey: string;
  propertyId?: string;
  dataRightsCase: DataRightsCase;
  selectedSubject: DataRightsSelectedSubject | undefined;
  canStart: boolean;
  canExecute: boolean;
  operatorScopeKey: string;
  permissionCurrent: boolean;
  caseCurrent: boolean;
  selectedEvidenceCurrent: boolean;
  onCaseUpdated: (updated: DataRightsCase) => Promise<void>;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [appliedReceipt, setAppliedReceipt] = useState<AppliedReceipt | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const status = correctionCaseStatus(dataRightsCase.status);
  const correctionKey = dataRightsCorrectionQueryKey(
    scopeKey,
    dataRightsCase.id,
    operatorScopeKey,
  );
  const correction = useQuery({
    queryKey: correctionKey,
    queryFn: () => request<DataRightsCorrectionExecutionDetails>(
      `${basePath}/correction`,
    ),
    enabled: canExecute && ["executing", "completed"].includes(status),
    refetchOnWindowFocus: true,
  });
  const correctionSource = createCompositeSource({
    label: "Correction claim",
    hasData: correction.data !== undefined,
    isLoading: correction.isLoading,
    error: correction.error,
    isFetching: correction.isFetching,
    refetch: () => correction.refetch(),
  });
  const correctionCurrent = compositeSourceCurrent(correctionSource);
  const correctionUsable = compositeSourceUsable(correctionSource.state);
  const execution = correctionUsable ? correction.data : undefined;
  const completed = correctionExecutionStatus(execution?.status) === "completed";
  const expired = correctionClaimExpired(execution, now);
  const claimAction = correctionClaimAction(execution, now);
  const canEdit = canEditCorrectionClaim(execution, now);
  const authorityRef = useRef({
    operatorScopeKey,
    scopeKey,
    permissionCurrent,
    caseCurrent,
    selectedEvidenceCurrent,
    correctionCurrent,
    dataRightsCase,
    execution,
  });
  authorityRef.current = {
    operatorScopeKey,
    scopeKey,
    permissionCurrent,
    caseCurrent,
    selectedEvidenceCurrent,
    correctionCurrent,
    dataRightsCase,
    execution,
  };
  const start = useMutation({
    mutationFn: (submission: {
      existing?: DataRightsCorrectionExecutionDetails;
      basePath: string;
      scopeKey: string;
      operatorScopeKey: string;
      caseSnapshot: DataRightsCaseSnapshot;
    }) => {
      const current = authorityRef.current;
      const existingCurrent = !submission.existing || Boolean(
        current.execution &&
        current.execution.executionId === submission.existing.executionId &&
        current.execution.version === submission.existing.version &&
        current.execution.executionRevision === submission.existing.executionRevision,
      );
      const mutationKind = submission.existing
        ? "claim-correction"
        : "start-correction";
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      ) || !dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !existingCurrent || !dataRightsMutationAllowed(mutationKind, {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          selectedEvidenceCurrent: current.selectedEvidenceCurrent,
          supportingSourceCurrent: submission.existing
            ? current.correctionCurrent
            : true,
        })) {
        throw dataRightsSourceChangedError();
      }
      return request<DataRightsCorrectionExecution>(`${submission.basePath}/correction`, {
        method: "POST",
        body: JSON.stringify({
          executionId: submission.existing?.executionId ?? crypto.randomUUID(),
          expectedVersion: submission.existing?.selectedCaseVersion ??
            submission.caseSnapshot.version,
        }),
      });
    },
    onSuccess: async (result, submission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) return;
      const mutationKind = submission.existing
        ? "claim-correction"
        : "start-correction";
      if (!dataRightsCaseMatches(current.dataRightsCase, submission.caseSnapshot) ||
        !dataRightsMutationAllowed(mutationKind, {
          permissionsCurrent: current.permissionCurrent,
          caseCurrent: current.caseCurrent,
          supportingSourceCurrent: submission.existing
            ? current.correctionCurrent
            : true,
        })) {
        await correction.refetch();
        return;
      }
      queryClient.setQueryData(correctionKey, result.execution);
      await onCaseUpdated(result.case);
    },
    onError: async (_error, submission) => {
      const current = authorityRef.current;
      if (!dataRightsSubmissionMatches(
        current.operatorScopeKey,
        current.scopeKey,
        submission.operatorScopeKey,
        submission.scopeKey,
      )) return;
      await correction.refetch();
    },
  });

  useEffect(() => {
    setAppliedReceipt(null);
    setNow(Date.now());
    start.reset();
  }, [dataRightsCase.id, operatorScopeKey, scopeKey]);

  useEffect(() => {
    if (!execution || completed || expired) return;
    const delay = Math.max(
      0,
      new Date(execution.expiresAtUtc).getTime() - Date.now(),
    );
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      delay + 25,
    );
    return () => window.clearTimeout(timeout);
  }, [completed, execution, expired]);

  useEffect(() => {
    if (status === "completed" && canExecute && permissionCurrent && caseCurrent) {
      void correction.refetch();
    }
  }, [canExecute, caseCurrent, permissionCurrent, status]);

  function startCorrection(existing?: DataRightsCorrectionExecutionDetails) {
    start.mutate({
      existing,
      basePath,
      scopeKey,
      operatorScopeKey,
      caseSnapshot: dataRightsCase,
    });
  }

  async function ownerApplied(receipt: AppliedReceipt) {
    setAppliedReceipt(receipt);
    const privacyInvalidations = [
      queryClient.invalidateQueries({
        queryKey: ["data-rights-case", scopeKey, dataRightsCase.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["data-rights-cases", scopeKey] }),
    ];
    if (execution?.subject.ownerKey === "workspaces") {
      await Promise.all([
        ...privacyInvalidations,
        queryClient.invalidateQueries({
          queryKey: ["workspace-staff-onboarding"],
        }),
      ]);
      return;
    }
    if (!propertyId) {
      await Promise.all(privacyInvalidations);
      return;
    }
    await Promise.all([
      ...privacyInvalidations,
      queryClient.invalidateQueries({ queryKey: ["guest-detail", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-list", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["guest-picker", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation-history", propertyId] }),
    ]);
  }

  return (
    <section className="border-t border-base-300 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Correct selected data</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-base-content/55">
            The owning module validates the approved record revision and records a
            PII-free completion proof.
          </p>
        </div>
        {completed && <StatusBadge status="Completed" />}
      </div>

      {canExecute && ["executing", "completed"].includes(status) && (
        <CompositeSourceNotice
          className="mt-4"
          sources={[correctionSource]}
          title="Correction claim is delayed"
        />
      )}

      {status === "approved" && (
        <CorrectionStart
          selectedSubject={selectedSubject}
          canStart={canStart && dataRightsMutationAllowed("start-correction", {
            permissionsCurrent: permissionCurrent,
            caseCurrent,
            selectedEvidenceCurrent,
            supportingSourceCurrent: true,
          })}
          pending={start.isPending}
          onStart={() => startCorrection()}
        />
      )}

      {["executing", "completed"].includes(status) && !canExecute && (
        <div className="mt-4 rounded-lg border border-base-300 bg-base-200 p-4 text-sm text-base-content/60">
          This correction is being handled by an operator with data-rights execution access.
        </div>
      )}

      {canExecute && ["executing", "completed"].includes(status) && (
        correction.isLoading
          ? <LoadingState label="Loading correction claim" />
          : !correctionUsable || !execution
            ? (
              <div className="mt-4">
                <CompositeSourceFallback state={correctionSource.state} label="correction claim" />
              </div>
            )
            : completed
              ? <CorrectionCompletion execution={execution} />
              : (
                <div className="mt-4 space-y-4">
                  <CorrectionClaimWindow
                    execution={execution}
                    expired={expired}
                    action={claimAction}
                    renewing={start.isPending}
                    authorityCurrent={dataRightsMutationAllowed("claim-correction", {
                      permissionsCurrent: permissionCurrent,
                      caseCurrent,
                      supportingSourceCurrent: correctionCurrent,
                    })}
                    onRenew={() => startCorrection(execution)}
                  />
                  {appliedReceipt
                    ? <CompletionPending receipt={appliedReceipt} />
                    : canEdit && (
                      <PrivacyRequestCorrectionOwnerEditor
                        propertyId={propertyId}
                        execution={execution}
                        disabled={!dataRightsMutationAllowed("apply-correction", {
                          permissionsCurrent: permissionCurrent,
                          caseCurrent,
                          selectedEvidenceCurrent,
                          supportingSourceCurrent: correctionCurrent,
                        })}
                        operatorScopeKey={operatorScopeKey}
                        scopeKey={scopeKey}
                        caseSnapshot={dataRightsCase}
                        onApplied={ownerApplied}
                      />
                    )}
                </div>
              )
      )}

      {start.error && <div className="mt-4"><CorrectionError error={start.error} /></div>}
    </section>
  );
}

function CorrectionStart({
  selectedSubject,
  canStart,
  pending,
  onStart,
}: {
  selectedSubject: DataRightsSelectedSubject | undefined;
  canStart: boolean;
  pending: boolean;
  onStart: () => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4 rounded-lg border border-success/25 bg-success/8 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-success/12 text-success">
          <PencilLine size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            {selectedSubject ? ownerLabel(selectedSubject.ownerKey) : "Selected record"}
          </p>
          <p className="mt-1 text-xs text-base-content/50">
            Starting opens a ten-minute, operator-bound editing window.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm shrink-0"
        disabled={!canStart || pending}
        onClick={onStart}
      >
        {pending
          ? <span className="loading loading-spinner loading-xs" />
          : <PencilLine size={15} />}
        Start correction
      </button>
    </div>
  );
}

export function CorrectionClaimWindow({
  execution,
  expired,
  action,
  renewing,
  authorityCurrent = true,
  onRenew,
}: {
  execution: DataRightsCorrectionExecutionDetails;
  expired: boolean;
  action: "none" | "renew" | "takeover";
  renewing: boolean;
  authorityCurrent?: boolean;
  onRenew: () => void;
}) {
  const ownedByCurrentActor = execution.isCurrentActor;
  const ownerReference = execution.claimedBy || "another operator";
  const title = expired
    ? ownedByCurrentActor
      ? "Your editing window expired"
      : "Editing window available for takeover"
    : ownedByCurrentActor
      ? "Your correction claim is active"
      : "Correction claim held by another operator";
  const detail = expired
    ? ownedByCurrentActor
      ? "Renew with recent authentication before submitting corrected values."
      : `The claim held by ${ownerReference} has expired. Take it over with recent authentication to continue.`
    : ownedByCurrentActor
      ? `Your editing window is available until ${formatDateTime(execution.expiresAtUtc)}.`
      : `Claimed by ${ownerReference} until ${formatDateTime(execution.expiresAtUtc)}. Editing is unavailable until the claim expires.`;

  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
      expired
        ? "border-warning/30 bg-warning/8"
        : "border-primary/20 bg-primary/6"
    }`}>
      <div className="flex items-start gap-3">
        <Clock3 size={18} className={`mt-0.5 shrink-0 ${expired ? "text-warning" : "text-primary"}`} />
        <div>
          <p className="text-sm font-semibold">
            {title}
          </p>
          <p className="mt-1 max-w-2xl break-words text-xs leading-5 text-base-content/55">
            {detail}
          </p>
        </div>
      </div>
      {action !== "none" && (
        <button
          type="button"
          className="btn btn-primary btn-sm shrink-0"
          disabled={renewing || !authorityCurrent}
          onClick={onRenew}
        >
          {renewing
            ? <span className="loading loading-spinner loading-xs" />
            : <RefreshCw size={15} />}
          {action === "renew" ? "Renew window" : "Take over window"}
        </button>
      )}
    </div>
  );
}

function CompletionPending({ receipt }: { receipt: AppliedReceipt }) {
  const changedFieldCount = "changedFieldKeys" in receipt
    ? receipt.changedFieldKeys.length
    : receipt.changedFields?.length ?? 0;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-info/25 bg-info/8 p-4">
      <span className="loading loading-spinner loading-sm mt-0.5 shrink-0 text-info" />
      <div>
        <p className="text-sm font-semibold">Correction applied</p>
        <p className="mt-1 text-xs leading-5 text-base-content/55">
          The owner changed {changedFieldCount} fields. BunkFy is
          recording the case completion proof.
        </p>
      </div>
    </div>
  );
}

function CorrectionCompletion({
  execution,
}: {
  execution: DataRightsCorrectionExecutionDetails;
}) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-lg border border-success/25 bg-success/8 p-4">
      <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-success" />
      <div>
        <p className="font-semibold">Correction completed</p>
        <p className="mt-1 text-xs leading-5 text-base-content/55">
          {execution.changedFieldCount ?? 0} fields changed in{" "}
          {ownerLabel(execution.subject.ownerKey).toLowerCase()}. Current record
          version {execution.currentRecordVersion ?? "recorded"}.
        </p>
        {execution.completedAtUtc && (
          <p className="mt-2 text-xs text-base-content/45">
            Completed {formatDateTime(execution.completedAtUtc)}
          </p>
        )}
      </div>
    </div>
  );
}

function ownerLabel(ownerKey: string): string {
  if (ownerKey === "guests") return "Guest Record";
  if (ownerKey === "reservations") return "Reservation";
  if (ownerKey === "workspaces") return "Staff enrollment profile";
  return "selected record";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
