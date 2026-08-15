import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, ShieldAlert, Target } from "lucide-react";
import { useEffect } from "react";
import type {
  DataRightsCase,
  DataRightsRestrictionReleaseTargetCandidate,
  DataRightsRestrictionReleaseTargetListResponse,
} from "../../api/types";
import { useSession } from "../../app/session";
import {
  dataRightsRestrictionTargetErrorMessage,
  restrictionTargetMatchesCandidate,
  shortRestrictionTargetId,
} from "./dataRightsRestrictionTarget";

export function PrivacyRequestRestrictionTarget({
  basePath,
  dataRightsCase,
  onCaseUpdated,
  refreshCase,
  onCurrentChange,
}: {
  basePath: string;
  dataRightsCase: DataRightsCase;
  onCaseUpdated: (updated: DataRightsCase) => Promise<void>;
  refreshCase: () => Promise<unknown>;
  onCurrentChange: (current: boolean) => void;
}) {
  const { request } = useSession();
  const targets = useQuery({
    queryKey: [
      "data-rights-restriction-release-targets",
      dataRightsCase.id,
      dataRightsCase.version,
    ],
    queryFn: () => request<DataRightsRestrictionReleaseTargetListResponse>(
      `${basePath}/restriction/release-targets`,
    ),
    retry: false,
    staleTime: 15_000,
  });
  const selectTarget = useMutation({
    mutationFn: (candidate: DataRightsRestrictionReleaseTargetCandidate) =>
      request<DataRightsCase>(`${basePath}/restriction/release-target`, {
        method: "POST",
        body: JSON.stringify({
          ownerOperationId: candidate.ownerOperationId,
          ownerOperationVersion: candidate.ownerOperationVersion,
          expectedVersion: dataRightsCase.version,
        }),
      }),
    onSuccess: async (updated) => {
      await onCaseUpdated(updated);
    },
    onError: async () => {
      await refreshCase();
      await targets.refetch();
    },
  });

  const candidates = targets.data?.targets ?? [];
  const selected = dataRightsCase.restrictionReleaseTarget;
  const responseCurrent = targets.data?.caseVersion === dataRightsCase.version;
  const selectedCurrent = Boolean(
    selected &&
    responseCurrent &&
    candidates.some((candidate) => restrictionTargetMatchesCandidate(selected, candidate)),
  );
  const error = targets.error ?? selectTarget.error;

  useEffect(() => {
    onCurrentChange(selectedCurrent);
  }, [onCurrentChange, selectedCurrent]);

  return (
    <section className="mt-5 border-t border-base-300 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 font-display text-base font-semibold">
            <Target size={17} className="text-primary" />
            Processing limit to release
          </h4>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-base-content/55">
            Choose the exact active obligation that will be reviewed. Other processing
            limits remain independent.
          </p>
        </div>
        {selectedCurrent && selected && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
            <CheckCircle2 size={14} />
            Target {shortRestrictionTargetId(selected.ownerOperationId)} selected
          </span>
        )}
      </div>

      {targets.isLoading && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-base-200 px-4 py-4 text-sm text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          Loading active processing limits
        </div>
      )}

      {error && (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/8 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warning-content" />
            <p className="text-sm leading-5 text-base-content/70">
              {dataRightsRestrictionTargetErrorMessage(error)}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost shrink-0"
            disabled={targets.isFetching || selectTarget.isPending}
            onClick={() => {
              selectTarget.reset();
              void targets.refetch();
            }}
          >
            <RefreshCw size={15} />
            Try again
          </button>
        </div>
      )}

      {!targets.isLoading && !targets.error && selected && !selectedCurrent && responseCurrent && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-base-content/70">
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-warning-content" />
          <p>
            Target {shortRestrictionTargetId(selected.ownerOperationId)} version {selected.ownerOperationVersion}
            {" "}is no longer current. Choose an active version before submitting for review.
          </p>
        </div>
      )}

      {targets.data?.limitReached && (
        <p className="mt-4 rounded-lg border border-info/25 bg-info/8 px-4 py-3 text-sm text-base-content/65">
          Showing the first 20 active processing limits. Selecting any listed target is safe;
          contact an administrator if the expected source case is not shown.
        </p>
      )}

      {!targets.isLoading && !targets.error && candidates.length === 0 && (
        <p className="mt-4 rounded-lg border border-base-300 bg-base-200 px-4 py-4 text-sm text-base-content/60">
          No active processing limit is available for this record. Remove the selected guest
          if the request points to the wrong record, or retry after owner data is corrected.
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {candidates.map((candidate) => {
            const isSelected = restrictionTargetMatchesCandidate(selected, candidate);
            const pending = selectTarget.isPending &&
              selectTarget.variables?.ownerOperationId === candidate.ownerOperationId &&
              selectTarget.variables.ownerOperationVersion === candidate.ownerOperationVersion;
            return (
              <button
                key={`${candidate.ownerOperationId}:${candidate.ownerOperationVersion}`}
                type="button"
                aria-pressed={isSelected}
                className={`min-h-24 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isSelected
                    ? "border-primary bg-primary/8"
                    : "border-base-300 bg-base-100 hover:border-primary/35 hover:bg-primary/5"
                }`}
                disabled={selectTarget.isPending || isSelected}
                onClick={() => selectTarget.mutate(candidate)}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold">
                      Source case {shortRestrictionTargetId(candidate.sourceCaseId)}
                    </span>
                    <span className="mt-1 block text-xs text-base-content/50">
                      Applied {formatDateTime(candidate.appliedAtUtc)}
                    </span>
                  </span>
                  {pending
                    ? <span className="loading loading-spinner loading-sm text-primary" />
                    : isSelected
                      ? <CheckCircle2 size={17} className="shrink-0 text-primary" />
                      : <span className="mt-0.5 size-4 shrink-0 rounded-full border border-primary" />}
                </span>
                <span className="mt-3 block text-xs font-semibold text-primary">
                  Target {shortRestrictionTargetId(candidate.ownerOperationId)} - version {candidate.ownerOperationVersion}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
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
