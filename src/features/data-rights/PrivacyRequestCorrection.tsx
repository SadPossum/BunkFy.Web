import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, PencilLine, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DataRightsCase,
  DataRightsCorrectionExecution,
  DataRightsCorrectionExecutionDetails,
  DataRightsSelectedSubject,
  GuestDataRightsCorrectionReceipt,
  GuestDataRightsCorrectionRequest,
  GuestProfile,
  Reservation,
  ReservationDataRightsCorrectionReceipt,
  ReservationDataRightsCorrectionRequest,
  WorkspaceStaffOnboardingDataRightsCorrectionReceipt,
  WorkspaceStaffOnboardingDataRightsCorrectionRequest,
  WorkspaceStaffOnboardingDataRightsCorrectionTarget,
} from "../../api/types";
import { useSession } from "../../app/session";
import { LoadingState, StatusBadge } from "../../components/ui/primitives";
import { CorrectionError } from "./CorrectionFormFields";
import { GuestCorrectionForm } from "./GuestCorrectionForm";
import { ReservationCorrectionForm } from "./ReservationCorrectionForm";
import { WorkspaceStaffOnboardingCorrectionForm } from "./WorkspaceStaffOnboardingCorrectionForm";
import {
  canEditCorrectionClaim,
  correctionCaseStatus,
  correctionClaimAction,
  correctionClaimExpired,
  correctionExecutionStatus,
  isSelectedCorrectionRevisionCurrent,
  workspaceStaffOnboardingCorrectionTargetPath,
} from "./dataRightsCorrectionWorkflow";

type AppliedReceipt =
  | GuestDataRightsCorrectionReceipt
  | ReservationDataRightsCorrectionReceipt
  | WorkspaceStaffOnboardingDataRightsCorrectionReceipt;

export function PrivacyRequestCorrection({
  basePath,
  scopeKey,
  propertyId,
  dataRightsCase,
  selectedSubject,
  canStart,
  canExecute,
  onCaseUpdated,
}: {
  basePath: string;
  scopeKey: string;
  propertyId?: string;
  dataRightsCase: DataRightsCase;
  selectedSubject: DataRightsSelectedSubject | undefined;
  canStart: boolean;
  canExecute: boolean;
  onCaseUpdated: (updated: DataRightsCase) => Promise<void>;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [appliedReceipt, setAppliedReceipt] = useState<AppliedReceipt | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const status = correctionCaseStatus(dataRightsCase.status);
  const correctionKey = ["data-rights-correction", scopeKey, dataRightsCase.id] as const;
  const correction = useQuery({
    queryKey: correctionKey,
    queryFn: () => request<DataRightsCorrectionExecutionDetails>(
      `${basePath}/correction`,
    ),
    enabled: canExecute && ["executing", "completed"].includes(status),
    refetchOnWindowFocus: true,
  });
  const execution = correction.data;
  const completed = correctionExecutionStatus(execution?.status) === "completed";
  const expired = correctionClaimExpired(execution, now);
  const claimAction = correctionClaimAction(execution, now);
  const canEdit = canEditCorrectionClaim(execution, now);
  const start = useMutation({
    mutationFn: (existing?: DataRightsCorrectionExecutionDetails) =>
      request<DataRightsCorrectionExecution>(`${basePath}/correction`, {
        method: "POST",
        body: JSON.stringify({
          executionId: existing?.executionId ?? crypto.randomUUID(),
          expectedVersion: existing?.selectedCaseVersion ?? dataRightsCase.version,
        }),
      }),
    onSuccess: async (result) => {
      queryClient.setQueryData(correctionKey, result.execution);
      await onCaseUpdated(result.case);
    },
  });

  useEffect(() => {
    setAppliedReceipt(null);
    setNow(Date.now());
    start.reset();
  }, [dataRightsCase.id]);

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
    if (status === "completed" && canExecute) void correction.refetch();
  }, [canExecute, status]);

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

      {status === "approved" && (
        <CorrectionStart
          selectedSubject={selectedSubject}
          canStart={canStart}
          pending={start.isPending}
          onStart={() => start.mutate(undefined)}
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
          : correction.error || !execution
            ? (
              <div className="mt-4">
                <CorrectionError error={correction.error} retry={() => void correction.refetch()} />
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
                    onRenew={() => start.mutate(execution)}
                  />
                  {appliedReceipt
                    ? <CompletionPending receipt={appliedReceipt} />
                    : canEdit && (
                      <CorrectionOwnerEditor
                        propertyId={propertyId}
                        execution={execution}
                        disabled={false}
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
  onRenew,
}: {
  execution: DataRightsCorrectionExecutionDetails;
  expired: boolean;
  action: "none" | "renew" | "takeover";
  renewing: boolean;
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
          disabled={renewing}
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

function CorrectionOwnerEditor({
  propertyId,
  execution,
  disabled,
  onApplied,
}: {
  propertyId?: string;
  execution: DataRightsCorrectionExecutionDetails;
  disabled: boolean;
  onApplied: (receipt: AppliedReceipt) => Promise<void>;
}) {
  const { request } = useSession();
  const ownerKey = execution.subject.ownerKey;
  const recordId = execution.subject.recordId;
  const guest = useQuery({
    queryKey: ["guest-detail", propertyId, recordId],
    queryFn: () => request<GuestProfile>(`/api/guests/properties/${propertyId}/${recordId}`),
    enabled: ownerKey === "guests" && Boolean(propertyId),
  });
  const reservation = useQuery({
    queryKey: ["reservation", propertyId, recordId],
    queryFn: () => request<Reservation>(
      `/api/reservations/properties/${propertyId}/${recordId}`,
    ),
    enabled: ownerKey === "reservations" && Boolean(propertyId),
  });
  const workspaceStaffOnboarding = useQuery({
    queryKey: [
      "workspace-staff-onboarding",
      "data-rights-correction",
      execution.executionId,
      recordId,
      execution.subject.recordVersion,
    ],
    queryFn: () =>
      request<WorkspaceStaffOnboardingDataRightsCorrectionTarget>(
        workspaceStaffOnboardingCorrectionTargetPath(execution),
      ),
    enabled:
      ownerKey === "workspaces" &&
      execution.subject.recordType === "staff-onboarding",
  });
  const guestCorrection = useMutation({
    mutationFn: (body: GuestDataRightsCorrectionRequest) =>
      request<GuestDataRightsCorrectionReceipt>(
        `/api/guests/properties/${propertyId}/data-rights-corrections`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: onApplied,
  });
  const reservationCorrection = useMutation({
    mutationFn: (body: ReservationDataRightsCorrectionRequest) =>
      request<ReservationDataRightsCorrectionReceipt>(
        `/api/reservations/properties/${propertyId}/data-rights-corrections`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: onApplied,
  });
  const workspaceStaffOnboardingCorrection = useMutation({
    mutationFn: (
      body: WorkspaceStaffOnboardingDataRightsCorrectionRequest,
    ) =>
      request<WorkspaceStaffOnboardingDataRightsCorrectionReceipt>(
        "/api/workspace-staff-enrollment/data-rights-corrections",
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: onApplied,
  });

  if (ownerKey === "guests") {
    if (guest.isLoading) return <LoadingState label="Loading Guest Record" />;
    if (guest.error || !guest.data) {
      return <CorrectionError error={guest.error} retry={() => void guest.refetch()} />;
    }
    if (!isSelectedCorrectionRevisionCurrent(guest.data.version, execution)) {
      return <StaleRecord />;
    }
    return (
      <GuestCorrectionForm
        key={`${guest.data.guestId}:${guest.data.version}`}
        profile={guest.data}
        execution={execution}
        disabled={disabled}
        pending={guestCorrection.isPending}
        error={guestCorrection.error}
        onSubmit={(body) => guestCorrection.mutate(body)}
      />
    );
  }

  if (ownerKey === "reservations") {
    if (reservation.isLoading) return <LoadingState label="Loading reservation" />;
    if (reservation.error || !reservation.data) {
      return (
        <CorrectionError
          error={reservation.error}
          retry={() => void reservation.refetch()}
        />
      );
    }
    if (!isSelectedCorrectionRevisionCurrent(reservation.data.version, execution)) {
      return <StaleRecord />;
    }
    return (
      <ReservationCorrectionForm
        key={`${reservation.data.reservationId}:${reservation.data.version}`}
        reservation={reservation.data}
        execution={execution}
        disabled={disabled}
        pending={reservationCorrection.isPending}
        error={reservationCorrection.error}
        onSubmit={(body) => reservationCorrection.mutate(body)}
      />
    );
  }

  if (
    ownerKey === "workspaces" &&
    execution.subject.recordType === "staff-onboarding"
  ) {
    if (workspaceStaffOnboarding.isLoading) {
      return <LoadingState label="Loading Staff enrollment profile" />;
    }
    if (
      workspaceStaffOnboarding.error ||
      !workspaceStaffOnboarding.data
    ) {
      return (
        <CorrectionError
          error={workspaceStaffOnboarding.error}
          retry={() => void workspaceStaffOnboarding.refetch()}
        />
      );
    }
    if (
      !isSelectedCorrectionRevisionCurrent(
        workspaceStaffOnboarding.data.version,
        execution,
      )
    ) {
      return <StaleRecord />;
    }
    return (
      <WorkspaceStaffOnboardingCorrectionForm
        key={`${workspaceStaffOnboarding.data.applicationId}:${
          workspaceStaffOnboarding.data.version
        }`}
        target={workspaceStaffOnboarding.data}
        execution={execution}
        disabled={disabled}
        pending={workspaceStaffOnboardingCorrection.isPending}
        error={workspaceStaffOnboardingCorrection.error}
        onSubmit={(body) =>
          workspaceStaffOnboardingCorrection.mutate(body)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm">
      The selected record owner does not provide an operator correction editor.
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

function StaleRecord() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm">
      This record changed after it was selected. The approved revision cannot be
      edited; review the request again before correcting current data.
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
