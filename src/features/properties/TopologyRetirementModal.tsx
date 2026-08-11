import { AlertTriangle, CheckCircle2, Clock3, Trash2 } from "lucide-react";
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
  pending,
  error,
  authenticationPrompt,
  refreshError,
  retryPending,
  retryError,
  onConfirm,
  onRefresh,
  onRetry,
  onClose,
}: {
  target: RetirementTarget | null;
  outcome: TopologyRetirement | null;
  pending: boolean;
  error: Error | null;
  authenticationPrompt?: ReactNode;
  refreshError: Error | null;
  retryPending: boolean;
  retryError: Error | null;
  onConfirm: (reason: string) => void;
  onRefresh: () => void;
  onRetry: () => void;
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
    onConfirm(reason.trim());
  }

  return (
    <Modal
      open
      title={outcome
        ? rejected
          ? `${target.kind === "bed" ? "Bed" : "Room"} retirement needs attention`
          : `${target.kind === "bed" ? "Bed" : "Room"} retirement started`
        : `Retire ${label}`}
      description={outcome
        ? rejected
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
          retryPending={retryPending}
          refreshError={refreshError}
          retryError={retryError}
          onRefresh={onRefresh}
          onRetry={onRetry}
          onClose={onClose}
        />
      ) : authenticationPrompt ? (
        <div className="space-y-4">
          {warning}
          {authenticationPrompt}
          <ModalActions>
            <button type="button" className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Cancel</button>
          </ModalActions>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {warning}
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
            <button type="submit" className="btn btn-error btn-sm min-w-24 text-white sm:btn-md" disabled={pending || (isInventoryRetirement && !reason.trim())}>
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
  retryPending,
  refreshError,
  retryError,
  onRefresh,
  onRetry,
  onClose,
}: {
  outcome: TopologyRetirement;
  targetKind: RetirementTarget["kind"];
  retryPending: boolean;
  refreshError: Error | null;
  retryError: Error | null;
  onRefresh: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const completed = outcome.status === 4;
  const rejected = outcome.status === 5;
  const activeBedRetirementCount = "activeBedRetirementCount" in outcome
    ? outcome.activeBedRetirementCount
    : 0;
  const waiting = outcome.activeAllocationCount > 0 ||
    outcome.activeManualBlockCount > 0 ||
    activeBedRetirementCount > 0;
  const affectedReservationsPath = outcome.affectedReservationIds.length
    ? affectedReservationsUrl(outcome)
    : null;
  return (
    <div className="space-y-5">
      <div className={`flex gap-3 rounded-lg border p-4 ${completed ? "border-success/25 bg-success/10" : rejected ? "border-warning/30 bg-warning/10" : "border-info/25 bg-info/10"}`}>
        {completed
          ? <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={19} />
          : rejected
            ? <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={19} />
            : <Clock3 className="mt-0.5 shrink-0 text-info-content" size={19} />}
        <div>
          <p className="font-semibold">{completed ? "Retirement completed" : rejected ? "Finalization was rejected" : waiting ? "Waiting for active claims" : "Finalization in progress"}</p>
          <p className="mt-1 text-sm text-base-content/60">
            {completed
              ? `The ${targetKind} is retired and remains available in historical records.`
              : rejected
                ? retirementRejectionMessage(outcome, targetKind)
              : waiting
                ? "Move affected reservations, release manual blocks, and finish nested retirements. The process will continue automatically."
                : "Properties is finalizing the physical topology change."}
          </p>
        </div>
      </div>
      {!completed && !rejected && (
        <div className={`grid gap-3 ${activeBedRetirementCount > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{outcome.activeAllocationCount}</p><p className="text-xs text-base-content/50">Reservations</p></div>
          <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{outcome.activeManualBlockCount}</p><p className="text-xs text-base-content/50">Manual blocks</p></div>
          {activeBedRetirementCount > 0 && <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{activeBedRetirementCount}</p><p className="text-xs text-base-content/50">Bed retirements</p></div>}
        </div>
      )}
      {refreshError && <ErrorState error={refreshError} retry={onRefresh} title="Couldn't refresh retirement status" />}
      {retryError && <ErrorState error={retryError} title="Couldn't retry finalization" />}
      <ModalActions>
        {affectedReservationsPath && <Link className="btn btn-outline btn-sm w-full sm:btn-md sm:w-auto" to={affectedReservationsPath} onClick={onClose}>Open reservations</Link>}
        {rejected && <button className="btn btn-primary btn-sm sm:btn-md" onClick={onRetry} disabled={retryPending}>{retryPending && <span className="loading loading-spinner loading-sm" />}Try finalization again</button>}
        <button className={`btn btn-sm sm:btn-md ${rejected ? "btn-ghost" : "btn-primary"}`} onClick={onClose}>Done</button>
      </ModalActions>
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
