import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, type ReactNode } from "react";
import type {
  DataRightsCorrectionExecutionDetails,
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
import {
  compositeSourceCurrent,
  compositeSourceUsable,
  createCompositeSource,
  type CompositeSource,
} from "../../app/compositeSourceState";
import { useSession } from "../../app/session";
import {
  CompositeSourceFallback,
  CompositeSourceNotice,
} from "../../components/ui/CompositeSourceNotice";
import { LoadingState } from "../../components/ui/primitives";
import { GuestCorrectionForm } from "./GuestCorrectionForm";
import { ReservationCorrectionForm } from "./ReservationCorrectionForm";
import { WorkspaceStaffOnboardingCorrectionForm } from "./WorkspaceStaffOnboardingCorrectionForm";
import {
  isSelectedCorrectionRevisionCurrent,
  workspaceStaffOnboardingCorrectionTargetPath,
} from "./dataRightsCorrectionWorkflow";
import {
  dataRightsCaseMatches,
  dataRightsMutationAllowed,
  dataRightsSourceChangedError,
  dataRightsSubmissionMatches,
  type DataRightsCaseSnapshot,
} from "./dataRightsSourceAuthority";

export type AppliedCorrectionReceipt =
  | GuestDataRightsCorrectionReceipt
  | ReservationDataRightsCorrectionReceipt
  | WorkspaceStaffOnboardingDataRightsCorrectionReceipt;

type OwnerSubmission<TBody> = {
  body: TBody;
  operatorScopeKey: string;
  scopeKey: string;
  caseSnapshot: DataRightsCaseSnapshot;
  executionId: string;
  executionVersion: number;
  ownerRecordVersion: number;
};

export function PrivacyRequestCorrectionOwnerEditor({
  propertyId,
  execution,
  disabled,
  operatorScopeKey,
  scopeKey,
  caseSnapshot,
  onApplied,
}: {
  propertyId?: string;
  execution: DataRightsCorrectionExecutionDetails;
  disabled: boolean;
  operatorScopeKey: string;
  scopeKey: string;
  caseSnapshot: DataRightsCaseSnapshot;
  onApplied: (receipt: AppliedCorrectionReceipt) => Promise<void>;
}) {
  const { request } = useSession();
  const ownerKey = execution.subject.ownerKey;
  const recordId = execution.subject.recordId;
  const ownerQueryKey = [
    "data-rights-correction-owner",
    scopeKey,
    caseSnapshot.id,
    operatorScopeKey,
    ownerKey,
    recordId,
    execution.subject.recordVersion,
  ] as const;
  const guest = useQuery({
    queryKey: ownerQueryKey,
    queryFn: () => request<GuestProfile>(
      `/api/guests/properties/${propertyId}/${recordId}`,
    ),
    enabled: ownerKey === "guests" && Boolean(propertyId),
  });
  const reservation = useQuery({
    queryKey: ownerQueryKey,
    queryFn: () => request<Reservation>(
      `/api/reservations/properties/${propertyId}/${recordId}`,
    ),
    enabled: ownerKey === "reservations" && Boolean(propertyId),
  });
  const onboarding = useQuery({
    queryKey: [
      "workspace-staff-onboarding",
      "data-rights-correction",
      ...ownerQueryKey.slice(1),
      execution.executionId,
    ],
    queryFn: () => request<WorkspaceStaffOnboardingDataRightsCorrectionTarget>(
      workspaceStaffOnboardingCorrectionTargetPath(execution),
    ),
    enabled: ownerKey === "workspaces" &&
      execution.subject.recordType === "staff-onboarding",
  });
  const guestSource = querySource("Guest Record correction source", guest);
  const reservationSource = querySource("Reservation correction source", reservation);
  const onboardingSource = querySource("Staff enrollment correction source", onboarding);
  const ownerSource = ownerKey === "guests"
    ? guestSource
    : ownerKey === "reservations"
      ? reservationSource
      : onboardingSource;
  const ownerRecordVersion = ownerKey === "guests"
    ? guest.data?.version
    : ownerKey === "reservations"
      ? reservation.data?.version
      : onboarding.data?.version;
  const ownerRecordCurrent = compositeSourceCurrent(ownerSource) &&
    ownerRecordVersion !== undefined &&
    isSelectedCorrectionRevisionCurrent(ownerRecordVersion, execution);
  const authorityRef = useRef({
    disabled,
    operatorScopeKey,
    scopeKey,
    caseSnapshot,
    execution,
    ownerRecordCurrent,
    ownerRecordVersion,
  });
  authorityRef.current = {
    disabled,
    operatorScopeKey,
    scopeKey,
    caseSnapshot,
    execution,
    ownerRecordCurrent,
    ownerRecordVersion,
  };

  function submission<TBody>(body: TBody): OwnerSubmission<TBody> | null {
    if (ownerRecordVersion === undefined) return null;
    return {
      body,
      operatorScopeKey,
      scopeKey,
      caseSnapshot,
      executionId: execution.executionId,
      executionVersion: execution.version,
      ownerRecordVersion,
    };
  }

  function assertCurrent<TBody>(candidate: OwnerSubmission<TBody>) {
    if (!ownerSubmissionCurrent(authorityRef.current, candidate)) {
      throw dataRightsSourceChangedError();
    }
  }

  async function applyReceipt<TBody>(
    receipt: AppliedCorrectionReceipt,
    candidate: OwnerSubmission<TBody>,
  ) {
    if (!ownerSubmissionCurrent(authorityRef.current, candidate)) return;
    await onApplied(receipt);
  }

  const guestCorrection = useMutation({
    mutationFn: (candidate: OwnerSubmission<GuestDataRightsCorrectionRequest>) => {
      assertCurrent(candidate);
      return request<GuestDataRightsCorrectionReceipt>(
        `/api/guests/properties/${propertyId}/data-rights-corrections`,
        { method: "POST", body: JSON.stringify(candidate.body) },
      );
    },
    onSuccess: applyReceipt,
  });
  const reservationCorrection = useMutation({
    mutationFn: (candidate: OwnerSubmission<ReservationDataRightsCorrectionRequest>) => {
      assertCurrent(candidate);
      return request<ReservationDataRightsCorrectionReceipt>(
        `/api/reservations/properties/${propertyId}/data-rights-corrections`,
        { method: "POST", body: JSON.stringify(candidate.body) },
      );
    },
    onSuccess: applyReceipt,
  });
  const onboardingCorrection = useMutation({
    mutationFn: (
      candidate: OwnerSubmission<WorkspaceStaffOnboardingDataRightsCorrectionRequest>,
    ) => {
      assertCurrent(candidate);
      return request<WorkspaceStaffOnboardingDataRightsCorrectionReceipt>(
        "/api/workspace-staff-enrollment/data-rights-corrections",
        { method: "POST", body: JSON.stringify(candidate.body) },
      );
    },
    onSuccess: applyReceipt,
  });

  if (ownerKey === "guests") {
    if (guest.isLoading) return <LoadingState label="Loading Guest Record" />;
    if (!compositeSourceUsable(guestSource.state) || !guest.data) {
      return <OwnerSourceFallback source={guestSource} />;
    }
    if (!isSelectedCorrectionRevisionCurrent(guest.data.version, execution)) {
      return <StaleRecord />;
    }
    return (
      <OwnerSourceFrame source={guestSource}>
        <GuestCorrectionForm
          key={`${guest.data.guestId}:${guest.data.version}`}
          profile={guest.data}
          execution={execution}
          disabled={disabled || !ownerRecordCurrent}
          pending={guestCorrection.isPending}
          error={guestCorrection.error}
          onSubmit={(body) => {
            const candidate = submission(body);
            if (candidate) guestCorrection.mutate(candidate);
          }}
        />
      </OwnerSourceFrame>
    );
  }

  if (ownerKey === "reservations") {
    if (reservation.isLoading) return <LoadingState label="Loading reservation" />;
    if (!compositeSourceUsable(reservationSource.state) || !reservation.data) {
      return <OwnerSourceFallback source={reservationSource} />;
    }
    if (!isSelectedCorrectionRevisionCurrent(reservation.data.version, execution)) {
      return <StaleRecord />;
    }
    return (
      <OwnerSourceFrame source={reservationSource}>
        <ReservationCorrectionForm
          key={`${reservation.data.reservationId}:${reservation.data.version}`}
          reservation={reservation.data}
          execution={execution}
          disabled={disabled || !ownerRecordCurrent}
          pending={reservationCorrection.isPending}
          error={reservationCorrection.error}
          onSubmit={(body) => {
            const candidate = submission(body);
            if (candidate) reservationCorrection.mutate(candidate);
          }}
        />
      </OwnerSourceFrame>
    );
  }

  if (ownerKey === "workspaces" && execution.subject.recordType === "staff-onboarding") {
    if (onboarding.isLoading) {
      return <LoadingState label="Loading Staff enrollment profile" />;
    }
    if (!compositeSourceUsable(onboardingSource.state) || !onboarding.data) {
      return <OwnerSourceFallback source={onboardingSource} />;
    }
    if (!isSelectedCorrectionRevisionCurrent(onboarding.data.version, execution)) {
      return <StaleRecord />;
    }
    return (
      <OwnerSourceFrame source={onboardingSource}>
        <WorkspaceStaffOnboardingCorrectionForm
          key={`${onboarding.data.applicationId}:${onboarding.data.version}`}
          target={onboarding.data}
          execution={execution}
          disabled={disabled || !ownerRecordCurrent}
          pending={onboardingCorrection.isPending}
          error={onboardingCorrection.error}
          onSubmit={(body) => {
            const candidate = submission(body);
            if (candidate) onboardingCorrection.mutate(candidate);
          }}
        />
      </OwnerSourceFrame>
    );
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm">
      The selected record owner does not provide an operator correction editor.
    </div>
  );
}

function ownerSubmissionCurrent<TBody>(
  current: {
    disabled: boolean;
    operatorScopeKey: string;
    scopeKey: string;
    caseSnapshot: DataRightsCaseSnapshot;
    execution: DataRightsCorrectionExecutionDetails;
    ownerRecordCurrent: boolean;
    ownerRecordVersion: number | undefined;
  },
  candidate: OwnerSubmission<TBody>,
): boolean {
  return dataRightsSubmissionMatches(
    current.operatorScopeKey,
    current.scopeKey,
    candidate.operatorScopeKey,
    candidate.scopeKey,
  ) && dataRightsCaseMatches(current.caseSnapshot, candidate.caseSnapshot) &&
    current.execution.executionId === candidate.executionId &&
    current.execution.version === candidate.executionVersion &&
    current.ownerRecordVersion === candidate.ownerRecordVersion &&
    dataRightsMutationAllowed("apply-correction", {
      permissionsCurrent: !current.disabled,
      caseCurrent: !current.disabled,
      supportingSourceCurrent: current.ownerRecordCurrent,
    });
}

function querySource(
  label: string,
  query: {
    data: unknown;
    isLoading: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  },
): CompositeSource {
  return createCompositeSource({
    label,
    hasData: query.data !== undefined,
    isLoading: query.isLoading,
    error: query.error,
    isFetching: query.isFetching,
    refetch: query.refetch,
  });
}

function OwnerSourceFrame({
  source,
  children,
}: {
  source: CompositeSource;
  children: ReactNode;
}) {
  return (
    <>
      <CompositeSourceNotice
        className="mb-3"
        sources={[source]}
        title={`${source.label} is delayed`}
      />
      {children}
    </>
  );
}

function OwnerSourceFallback({ source }: { source: CompositeSource }) {
  return (
    <div>
      <CompositeSourceNotice
        className="mb-3"
        sources={[source]}
        title={`${source.label} is delayed`}
      />
      <CompositeSourceFallback state={source.state} label={source.label} />
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
