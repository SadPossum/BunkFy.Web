import { AlertTriangle, CheckCircle2, Clock3, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import type { Bed, Property, Room, TopologyRetirement } from "../../api/types";
import { ErrorState, Modal, ModalActions } from "../../components/ui/primitives";

export type RetirementTarget =
  | { kind: "property"; entity: Property }
  | { kind: "room"; entity: Room }
  | { kind: "bed"; entity: Bed; roomId: string };

export function TopologyRetirementModal({
  target,
  outcome,
  canConfirm,
  canRetry,
  canCancel,
  pending,
  error,
  authenticationPrompt,
  refreshError,
  retryPending,
  retryError,
  cancellationPending,
  cancellationError,
  onConfirm,
  onRefresh,
  onRetry,
  onCancelRetirement,
  onClose,
}: {
  target: RetirementTarget | null;
  outcome: TopologyRetirement | null;
  canConfirm: boolean;
  canRetry: boolean;
  canCancel: boolean;
  pending: boolean;
  error: Error | null;
  authenticationPrompt?: ReactNode;
  refreshError: Error | null;
  retryPending: boolean;
  retryError: Error | null;
  cancellationPending: boolean;
  cancellationError: Error | null;
  onConfirm: (reason: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onCancelRetirement: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    setReason("");
  }, [target]);

  if (!target) return null;
  const isInventoryRetirement = target.kind === "bed" || target.kind === "room";
  const label = target.kind === "property"
    ? target.entity.name
    : target.kind === "room"
      ? target.entity.name
      : `bed ${target.entity.label}`;
  const rejected = outcome?.status === 5;
  const canceled = outcome?.status === 6;
  const warning = (
    <div className="flex gap-3 rounded-lg border border-warning/25 bg-warning/10 p-4 text-sm">
      <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={18} />
      <p>
        {isInventoryRetirement
          ? `Existing reservations and manual blocks stay intact. Retirement completes only after staff move or release every active claim${target.kind === "room" ? " and any bed retirement finishes" : ""}.`
          : "Review dependent rooms, beds, inventory and reservations before continuing."}
      </p>
    </div>
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm) return;
    onConfirm(reason.trim());
  }

  return (
    <Modal
      open
      title={outcome
        ? canceled
          ? `${target.kind === "bed" ? "Bed" : "Room"} retirement stopped`
          : rejected
          ? `${target.kind === "bed" ? "Bed" : "Room"} retirement needs attention`
          : `${target.kind === "bed" ? "Bed" : "Room"} retirement started`
        : `Retire ${label}`}
      description={outcome
        ? canceled
          ? `The ${target.kind} is available for new reservations again.`
          : rejected
          ? `Properties could not finalize this ${target.kind} change.`
          : `The ${target.kind} is no longer available for new reservations.`
        : isInventoryRetirement
          ? `Inventory will drain the ${target.kind} before Properties retires it.`
          : "This changes the physical setup and cannot be undone from this screen."}
      onClose={onClose}
    >
      {outcome ? (
        <RetirementOutcome
          outcome={outcome}
          targetKind={target.kind}
          canRetry={canRetry}
          canCancel={canCancel}
          retryPending={retryPending}
          cancellationPending={cancellationPending}
          refreshError={refreshError}
          retryError={retryError}
          cancellationError={cancellationError}
          onRefresh={onRefresh}
          onRetry={onRetry}
          onCancelRetirement={onCancelRetirement}
          onClose={onClose}
        />
      ) : authenticationPrompt ? (
        <div className="space-y-4">
          {warning}
          {!canConfirm && <RetirementAuthorityNotice />}
          {authenticationPrompt}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Cancel</button>
          </ModalActions>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {warning}
          {!canConfirm && <RetirementAuthorityNotice />}
          {isInventoryRetirement && (
            <label className="form-control block">
              <span className="label-text mb-1.5 block text-sm font-semibold">Reason</span>
              <textarea
                className="textarea textarea-bordered min-h-20 w-full"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                placeholder={target.kind === "room" ? "Renovation, repurposing, permanent closure..." : "Damaged frame, room reconfiguration, replacement..."}
                required
              />
            </label>
          )}
          {error && <ErrorState error={error} title={`Couldn't retire ${label}`} />}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-error btn-sm min-w-24 text-white sm:btn-md" disabled={!canConfirm || pending || (isInventoryRetirement && !reason.trim())}>
              {pending ? <span className="loading loading-spinner loading-sm" /> : <Trash2 size={17} />}
              Retire
            </button>
          </ModalActions>
        </form>
      )}
    </Modal>
  );
}

function RetirementOutcome({
  outcome,
  targetKind,
  canRetry,
  canCancel,
  retryPending,
  cancellationPending,
  refreshError,
  retryError,
  cancellationError,
  onRefresh,
  onRetry,
  onCancelRetirement,
  onClose,
}: {
  outcome: TopologyRetirement;
  targetKind: RetirementTarget["kind"];
  canRetry: boolean;
  canCancel: boolean;
  retryPending: boolean;
  cancellationPending: boolean;
  refreshError: Error | null;
  retryError: Error | null;
  cancellationError: Error | null;
  onRefresh: () => void;
  onRetry: () => void;
  onCancelRetirement: (reason: string) => void;
  onClose: () => void;
}) {
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const completed = outcome.status === 4;
  const rejected = outcome.status === 5;
  const canceled = outcome.status === 6;
  const draining = outcome.status === 1;
  const activeBedRetirementCount = "activeBedRetirementCount" in outcome
    ? outcome.activeBedRetirementCount
    : 0;
  const waiting = outcome.activeAllocationCount > 0 ||
    outcome.activeManualBlockCount > 0 ||
    activeBedRetirementCount > 0;
  const affectedReservationsPath = outcome.affectedReservationIds.length
    ? affectedReservationsUrl(outcome)
    : null;

  useEffect(() => {
    setConfirmingCancellation(false);
    setCancellationReason("");
  }, [outcome.status, outcome.topologyChangeId]);

  return (
    <div className="space-y-5">
      <div className={`flex gap-3 rounded-lg border p-4 ${completed ? "border-success/25 bg-success/10" : canceled ? "border-primary/25 bg-primary/8" : rejected ? "border-warning/30 bg-warning/10" : "border-info/25 bg-info/10"}`}>
        {completed
          ? <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={19} />
          : canceled
            ? <RotateCcw className="mt-0.5 shrink-0 text-primary" size={19} />
          : rejected
            ? <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={19} />
            : <Clock3 className="mt-0.5 shrink-0 text-info-content" size={19} />}
        <div>
          <p className="font-semibold">{completed ? "Retirement completed" : canceled ? "Retirement stopped" : rejected ? "Finalization was rejected" : waiting ? "Waiting for active claims" : "Finalization in progress"}</p>
          <p className="mt-1 text-sm text-base-content/60">
            {completed
              ? `The ${targetKind} is retired and remains available in historical records.`
              : canceled
                ? `The ${targetKind} is available for new reservations again. The canceled attempt remains in history.`
              : rejected
                ? retirementRejectionMessage(outcome, targetKind)
              : waiting
                ? "Move affected reservations, release manual blocks, and finish nested retirements. The process will continue automatically."
                : "Properties is finalizing the physical topology change."}
          </p>
          {canceled && outcome.cancellationReason && (
            <p className="mt-3 break-words text-sm text-base-content/70">
              <span className="font-semibold text-base-content">Reason:</span> {outcome.cancellationReason}
            </p>
          )}
        </div>
      </div>
      {!completed && !rejected && !canceled && (
        <div className={`grid gap-3 ${activeBedRetirementCount > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{outcome.activeAllocationCount}</p><p className="text-xs text-base-content/50">Reservations</p></div>
          <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{outcome.activeManualBlockCount}</p><p className="text-xs text-base-content/50">Manual blocks</p></div>
          {activeBedRetirementCount > 0 && <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{activeBedRetirementCount}</p><p className="text-xs text-base-content/50">Bed retirements</p></div>}
        </div>
      )}
      {refreshError && <ErrorState error={refreshError} retry={onRefresh} title="Couldn't refresh retirement status" />}
      {((rejected && !canRetry) || (draining && !canCancel)) && <RetirementAuthorityNotice />}
      {retryError && <ErrorState error={retryError} title="Couldn't retry finalization" />}
      {draining && confirmingCancellation ? (
        <section className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={19} />
            <div>
              <h3 className="font-semibold">Stop this retirement?</h3>
              <p className="mt-1 text-sm leading-6 text-base-content/60">
                New reservations can use the {targetKind} again. Existing reservations and blocks are unchanged.
              </p>
            </div>
          </div>
          <label className="form-control mt-4 block">
            <span className="label-text mb-1.5 block text-sm font-semibold">Reason</span>
            <textarea
              className="textarea textarea-bordered min-h-20 w-full"
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              maxLength={500}
              placeholder="Why this room or bed should remain in service"
              required
            />
          </label>
          {cancellationError && <div className="mt-4"><ErrorState error={cancellationError} title="Couldn't stop retirement" /></div>}
          <ModalActions>
            <button
              type="button"
              className="btn btn-ghost btn-sm sm:btn-md"
              onClick={() => {
                setConfirmingCancellation(false);
                setCancellationReason("");
              }}
              disabled={cancellationPending}
            >
              Keep draining
            </button>
            <button
              type="button"
              className="btn btn-error btn-sm text-white sm:btn-md"
              onClick={() => onCancelRetirement(cancellationReason.trim())}
              disabled={!canCancel || cancellationPending || !cancellationReason.trim()}
            >
              {cancellationPending && <span className="loading loading-spinner loading-sm" />}
              Stop retirement
            </button>
          </ModalActions>
        </section>
      ) : (
        <ModalActions>
          {!canceled && affectedReservationsPath && <Link className="btn btn-outline btn-sm w-full sm:btn-md sm:w-auto" to={affectedReservationsPath} onClick={onClose}>Open reservations</Link>}
          {draining && <button type="button" className="btn btn-outline btn-sm text-error sm:btn-md" onClick={() => setConfirmingCancellation(true)} disabled={!canCancel}><RotateCcw size={16} />Stop retirement</button>}
          {rejected && <button type="button" className="btn btn-primary btn-sm sm:btn-md" onClick={onRetry} disabled={!canRetry || retryPending}>{retryPending && <span className="loading loading-spinner loading-sm" />}Try finalization again</button>}
          <button type="button" className={`btn btn-sm sm:btn-md ${rejected ? "btn-ghost" : "btn-primary"}`} onClick={onClose}>Done</button>
        </ModalActions>
      )}
    </div>
  );
}

function RetirementAuthorityNotice() {
  return (
    <div className="alert border border-warning/25 bg-warning/10 text-base-content" role="status">
      <AlertTriangle className="text-warning-content" size={18} />
      <p className="text-sm">Refresh property access and retirement status before continuing. If the room, bed, or property changed, close and reopen this action.</p>
    </div>
  );
}

function retirementRejectionMessage(
  outcome: TopologyRetirement,
  targetKind: RetirementTarget["kind"],
) {
  const reason = Number(outcome.rejectionReason);
  if (targetKind === "bed") {
    if (reason === 1) return "The room was not found in Properties. Review the current topology before trying again.";
    if (reason === 2) return "The bed was not found in Properties. Review the current topology before trying again.";
    if (reason === 3) return "The room has already been retired. Review the room before trying this bed finalization again.";
  }
  if (targetKind === "room" && reason === 1) {
    return "The room was not found in Properties. Review the current topology before trying again.";
  }
  return "Review the current topology, then try finalization again. The same retirement process and history will be preserved.";
}

function affectedReservationsUrl(outcome: TopologyRetirement) {
  const params = new URLSearchParams({
    property: outcome.propertyId,
    affected: outcome.affectedReservationIds.join(","),
    focus: outcome.affectedReservationIds[0],
    reservation: outcome.affectedReservationIds[0],
  });
  return `/reservations?${params}`;
}
