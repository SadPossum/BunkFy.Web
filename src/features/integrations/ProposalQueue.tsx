import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  FileDiff,
  LockKeyhole,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { proposalStatusLabel, proposalStatusValue } from "../../api/labels";
import type {
  ChangeProposal,
  ChangeProposalListItem,
  ChangeProposalListResponse,
  ChangeProposalMutationReceipt,
  Reservation,
} from "../../api/types";
import {
  LIVE_DETAIL_REFRESH_INTERVAL_MS,
  LIVE_LIST_REFRESH_INTERVAL_MS,
  proposalNeedsLiveRefresh,
} from "../../app/liveUpdates";
import { useSession } from "../../app/session";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  ModalActions,
  StatusBadge,
} from "../../components/ui/primitives";
import { PaginationBar } from "../../components/ui/PaginationBar";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { hasPrimaryGuestRecord } from "../reservations/guestRecordWorkflow";
import {
  integrationSelectionSearchParams,
  integrationViewState,
  proposalFilterSearchParams,
  proposalPageSearchParams,
  type ProposalStatusFilter,
} from "./integrationViewState";

const PAGE_SIZE = 25;
const filters = ["pending", "applying", "applied", "rejected", "superseded", "stale", "failed"] as const;

export function ProposalQueue({
  propertyId,
  canReadSensitiveHistory,
  canDecide,
  canSuggestGuestRecords,
}: {
  propertyId: string;
  canReadSensitiveHistory: boolean;
  canDecide: boolean;
  canSuggestGuestRecords: boolean;
}) {
  const { request } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = integrationViewState(searchParams);
  const status = view.proposalStatus;
  const page = view.proposalPage;
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (status !== "all") params.set("status", String(proposalStatusValue(status)));
  const proposals = useQuery({
    queryKey: ["ingestion-proposals", propertyId, status, page],
    queryFn: () => request<ChangeProposalListResponse>(
      `/api/ingestion/properties/${propertyId}/proposals?${params}`,
    ),
    refetchInterval: (query) => query.state.data?.proposals.some((item) => proposalNeedsLiveRefresh(item.status))
      ? LIVE_LIST_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const items = proposals.data?.proposals ?? [];

  function select(id: string | null) {
    setSearchParams(
      integrationSelectionSearchParams(searchParams, "proposal", id),
      { replace: true },
    );
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm" aria-labelledby="proposal-review-heading">
        <div className="flex flex-col gap-4 border-b border-base-300 p-5 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h2 id="proposal-review-heading" className="font-display text-xl font-semibold">Change review</h2>
            <p className="mt-1 text-sm leading-6 text-base-content/55">
              Suggestions appear here when an external update cannot safely replace the current reservation.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
            {!canReadSensitiveHistory && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-base-content/50">
                <LockKeyhole size={14} aria-hidden="true" />
                Difference details restricted
              </span>
            )}
            <SelectPicker
              className="w-full sm:w-56"
              size="sm"
              value={status}
              onValueChange={(value) => setSearchParams(
                proposalFilterSearchParams(searchParams, value as ProposalStatusFilter),
                { replace: true },
              )}
              ariaLabel="Proposal status"
              options={[
                { value: "all", label: "All statuses" },
                ...filters.map((value) => ({ value, label: capitalize(value) })),
              ]}
            />
          </div>
        </div>
        {proposals.isLoading ? (
          <LoadingState label="Loading change proposals" />
        ) : proposals.error ? (
          <div className="p-6"><ErrorState error={proposals.error} retry={() => void proposals.refetch()} /></div>
        ) : !items.length ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title={status === "pending" ? "Nothing needs review" : "No proposals match"}
            description={status === "pending"
              ? "New suggestions will appear here only when an external update needs a staff decision."
              : "Choose another status to inspect proposal history."}
          />
        ) : (
          <>
            <div className="divide-y divide-base-300">
              {items.map((proposal) => (
                <ProposalRow
                  key={proposal.proposalId}
                  proposal={proposal}
                  onOpen={canReadSensitiveHistory ? () => select(proposal.proposalId) : undefined}
                />
              ))}
            </div>
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              itemCount={items.length}
              hasMore={proposals.data?.hasMore}
              itemLabel="proposal"
              disabled={proposals.isFetching}
              onPageChange={(nextPage) => setSearchParams(
                proposalPageSearchParams(searchParams, nextPage),
                { replace: true },
              )}
            />
          </>
        )}
      </section>
      <ProposalDetail
        propertyId={propertyId}
        proposalId={canReadSensitiveHistory ? view.selectedProposalId : null}
        canDecide={canDecide}
        canSuggestGuestRecords={canSuggestGuestRecords}
        onClose={() => select(null)}
      />
    </>
  );
}

function ProposalRow({
  proposal,
  onOpen,
}: {
  proposal: ChangeProposalListItem;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex w-full items-start gap-3 p-4 text-left transition enabled:hover:bg-base-200/65 enabled:focus-visible:bg-base-200/65 disabled:cursor-default disabled:opacity-100 sm:items-center sm:px-6 sm:py-5"
      disabled={!onOpen}
      onClick={onOpen}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning" aria-hidden="true">
        <FileDiff size={18} />
      </span>
      <span className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center sm:gap-5">
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{humanize(proposal.reasonCode)}</span>
          <span className="mt-1 block text-xs text-base-content/45">
            Reservation {proposal.reservationId.slice(0, 8).toUpperCase()} · revision {proposal.baseReservationDetailsRevision}
          </span>
        </span>
        <time className="mt-2 block text-xs text-base-content/50 sm:mt-0" dateTime={proposal.createdAtUtc}>
          {formatDateTime(proposal.createdAtUtc)}
        </time>
        <span className="mt-2 block sm:mt-0"><StatusBadge status={proposalStatusLabel(proposal.status)} /></span>
      </span>
      {onOpen ? (
        <ChevronRight className="mt-2 shrink-0 text-base-content/35 transition-transform group-hover:translate-x-0.5 sm:mt-0" size={18} aria-hidden="true" />
      ) : (
        <LockKeyhole className="mt-2 shrink-0 text-base-content/30 sm:mt-0" size={17} aria-label="Details restricted" />
      )}
    </button>
  );
}

function ProposalDetail({
  propertyId,
  proposalId,
  canDecide,
  canSuggestGuestRecords,
  onClose,
}: {
  propertyId: string;
  proposalId: string | null;
  canDecide: boolean;
  canSuggestGuestRecords: boolean;
  onClose: () => void;
}) {
  const { request } = useSession();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<"accept" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const observedVersion = useRef<{ proposalId: string; version: number } | null>(null);

  useEffect(() => {
    setDecision(null);
    setReason("");
  }, [proposalId]);

  const proposal = useQuery({
    queryKey: ["ingestion-proposal", propertyId, proposalId],
    queryFn: () => request<ChangeProposal>(
      `/api/ingestion/properties/${propertyId}/proposals/${proposalId}`,
    ),
    enabled: Boolean(proposalId),
    refetchInterval: (query) => proposalNeedsLiveRefresh(query.state.data?.status)
      ? LIVE_DETAIL_REFRESH_INTERVAL_MS
      : false,
    refetchIntervalInBackground: false,
  });
  const reservation = useQuery({
    queryKey: ["reservation", propertyId, proposal.data?.reservationId],
    queryFn: () => request<Reservation>(
      `/api/reservations/properties/${propertyId}/${proposal.data?.reservationId}`,
    ),
    enabled: Boolean(proposal.data?.reservationId),
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ingestion-proposal", propertyId, proposalId] }),
      queryClient.invalidateQueries({ queryKey: ["ingestion-proposals", propertyId] }),
    ]);
  }

  const mutation = useMutation({
    mutationFn: ({ item, action }: { item: ChangeProposal; action: "accept" | "reject" }) =>
      request<ChangeProposalMutationReceipt>(
        `/api/ingestion/properties/${propertyId}/proposals/${item.proposalId}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(action === "accept"
            ? {
                expectedProposalVersion: item.version,
                expectedReservationDetailsRevision: reservation.data?.detailsRevision
                  ?? item.baseReservationDetailsRevision,
              }
            : { expectedProposalVersion: item.version, reason: reason.trim() }),
        },
      ),
    onSuccess: async () => {
      setDecision(null);
      await refresh();
    },
  });
  const item = proposal.data;
  const isPending = item && proposalStatusLabel(item.status) === "pending";
  const revisionChanged = item
    && reservation.data
    && reservation.data.detailsRevision !== item.baseReservationDetailsRevision;
  const suggestGuestRecord = canSuggestGuestRecords
    && item
    && proposalStatusLabel(item.status) === "applied"
    && reservation.data
    && !hasPrimaryGuestRecord(reservation.data);

  useEffect(() => {
    if (!item) return;
    const previous = observedVersion.current;
    observedVersion.current = { proposalId: item.proposalId, version: item.version };
    if (!previous || previous.proposalId !== item.proposalId || previous.version === item.version) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["ingestion-proposals", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["reservation", propertyId, item.reservationId] }),
      queryClient.invalidateQueries({ queryKey: ["reservations", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["availability", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["ingestion-runs", propertyId] }),
      queryClient.invalidateQueries({ queryKey: ["ingestion-receipts", propertyId] }),
    ]);
  }, [item, propertyId, queryClient]);

  return (
    <Modal
      open={Boolean(proposalId)}
      size="lg"
      title={item ? humanize(item.reasonCode) : "Change proposal"}
      description={item
        ? `Reservation ${item.reservationId.slice(0, 8).toUpperCase()} · proposal ${item.proposalId.slice(0, 8).toUpperCase()}`
        : "Loading proposal"}
      onClose={onClose}
    >
      {proposal.isLoading ? (
        <LoadingState label="Loading change proposal" />
      ) : proposal.error ? (
        <ErrorState error={proposal.error} retry={() => void proposal.refetch()} />
      ) : item ? (
        <div className="space-y-5">
          <section className="rounded-lg border border-base-300 bg-base-200/55 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">External update received {formatDateTime(item.createdAtUtc)}</p>
                <p className="mt-1 text-xs text-base-content/50">
                  Connection {item.connectionId.slice(0, 8).toUpperCase()} · receipt {item.receiptId.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <StatusBadge status={proposalStatusLabel(item.status)} />
            </div>
            <dl className="mt-4 grid gap-3 border-t border-base-300 pt-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-base-content/45">Compared with</dt>
                <dd className="mt-1 font-semibold">Reservation revision {item.baseReservationDetailsRevision}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/45">Decision</dt>
                <dd className="mt-1 font-semibold">{proposalDecisionSummary(item)}</dd>
              </div>
            </dl>
          </section>
          {revisionChanged && (
            <div className="alert border border-warning/25 bg-warning/8 text-base-content">
              <AlertTriangle size={18} className="text-warning" />
              <span className="text-sm">
                This reservation is now at revision {reservation.data?.detailsRevision}. BunkFy will validate the current revision again before applying anything.
              </span>
            </div>
          )}
          {suggestGuestRecord && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/15 bg-primary/5 p-4 sm:flex-row sm:items-center">
              <UserPlus size={19} className="shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Keep this guest for future stays?</p>
                <p className="mt-1 text-xs leading-5 text-base-content/55">
                  The update is applied. Create a Guest Record from the reservation or link an existing profile.
                </p>
              </div>
              <Link className="btn btn-primary btn-sm shrink-0" to={`/reservations?reservation=${item.reservationId}&section=guest`}>
                <UserPlus size={15} />
                Review guest
              </Link>
            </div>
          )}
          <section aria-labelledby="proposal-difference-heading">
            <h3 id="proposal-difference-heading" className="font-display text-lg font-semibold">Proposed difference</h3>
            {item.diff ? (
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-base-300 bg-base-200/70 p-4 font-mono text-xs leading-6 text-base-content/75">
                {formatDiff(item.diff)}
              </pre>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-base-300 p-6 text-center text-sm text-base-content/50">
                The difference is unavailable or has been redacted by retention policy.
              </div>
            )}
          </section>
          {item.decisionReason && (
            <section className="rounded-lg border border-base-300 p-4">
              <p className="text-xs font-semibold uppercase text-base-content/45">Decision reason</p>
              <p className="mt-2 text-sm leading-6 text-base-content/70">{item.decisionReason}</p>
            </section>
          )}
          {decision && (
            <section className="rounded-lg border border-warning/30 bg-warning/8 p-4">
              <h3 className="font-semibold">
                {decision === "accept" ? "Apply this external update?" : "Reject this external update?"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-base-content/60">
                {decision === "accept"
                  ? "BunkFy will re-check both the proposal and reservation revision before applying the change."
                  : "The proposal will remain in history with the reason recorded below."}
              </p>
              {decision === "reject" && (
                <label className="form-control mt-4 block">
                  <span className="label-text mb-2 block text-sm font-semibold">Rejection reason</span>
                  <textarea
                    className="textarea textarea-bordered min-h-24 w-full"
                    value={reason}
                    maxLength={1000}
                    onChange={(event) => setReason(event.target.value)}
                    required
                  />
                </label>
              )}
              {mutation.error && <div className="mt-4"><ErrorState error={mutation.error} /></div>}
            </section>
          )}
          <ModalActions>
            {decision ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm sm:btn-md"
                  onClick={() => {
                    setDecision(null);
                    mutation.reset();
                  }}
                  disabled={mutation.isPending}
                >
                  Back
                </button>
                <button
                  type="button"
                  className={`btn btn-sm sm:btn-md ${decision === "accept" ? "btn-primary" : "btn-error"}`}
                  disabled={mutation.isPending || (decision === "reject" && !reason.trim())}
                  onClick={() => mutation.mutate({ item, action: decision })}
                >
                  {mutation.isPending && <span className="loading loading-spinner loading-xs" />}
                  {decision === "accept" ? "Apply update" : "Reject proposal"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Close</button>
                <Link className="btn btn-outline btn-sm sm:btn-md" to={`/reservations?reservation=${item.reservationId}`}>
                  <ExternalLink size={15} />
                  Reservation
                </Link>
                {isPending && canDecide && (
                  <>
                    <button type="button" className="btn btn-outline btn-sm sm:btn-md" onClick={() => setDecision("reject")}>
                      <XCircle size={15} />
                      Reject
                    </button>
                    <button type="button" className="btn btn-primary btn-sm sm:btn-md" onClick={() => setDecision("accept")}>
                      <CheckCircle2 size={15} />
                      Review and apply
                    </button>
                  </>
                )}
              </>
            )}
          </ModalActions>
        </div>
      ) : null}
    </Modal>
  );
}

function proposalDecisionSummary(proposal: ChangeProposal): string {
  const status = proposalStatusLabel(proposal.status);
  if (status === "pending") return "Waiting for staff review";
  if (status === "applying") return "Applying after validation";
  if (status === "superseded") return "Replaced by a newer source update";
  if (status === "stale") return "Reservation changed before application";
  if (status === "applied") return proposal.completedAtUtc ? `Applied ${formatDateTime(proposal.completedAtUtc)}` : "Applied";
  if (status === "rejected") return proposal.decidedAtUtc ? `Rejected ${formatDateTime(proposal.decidedAtUtc)}` : "Rejected";
  return capitalize(status);
}

function formatDiff(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function humanize(value: string) {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
