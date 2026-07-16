import { AlertTriangle, CheckCircle2, Clock3, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
  onConfirm,
  onClose,
}: {
  target: RetirementTarget | null;
  outcome: TopologyRetirement | null;
  pending: boolean;
  error: Error | null;
  onConfirm: (reason: string) => void;
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm(reason.trim());
  }

  return (
    <Modal
      open
      title={outcome ? `${target.kind === "bed" ? "Bed" : "Room"} retirement started` : `Retire ${label}`}
      description={outcome
        ? `The ${target.kind} is no longer available for new reservations.`
        : isInventoryRetirement
          ? `Inventory will drain the ${target.kind} before Properties retires it.`
          : "This changes the physical setup and cannot be undone from this screen."}
      onClose={onClose}
    >
      {outcome ? (
        <RetirementOutcome outcome={outcome} targetKind={target.kind} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-warning/25 bg-warning/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={18} />
            <p>
              {isInventoryRetirement
                ? `Existing reservations and manual blocks stay intact. Retirement completes only after staff move or release every active claim${target.kind === "room" ? " and any bed retirement finishes" : ""}.`
                : "Review dependent rooms, beds, inventory and reservations before continuing."}
            </p>
          </div>
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
  onClose,
}: {
  outcome: TopologyRetirement;
  targetKind: RetirementTarget["kind"];
  onClose: () => void;
}) {
  const completed = outcome.status === 4;
  const activeBedRetirementCount = "activeBedRetirementCount" in outcome
    ? outcome.activeBedRetirementCount
    : 0;
  const waiting = outcome.activeAllocationCount > 0 ||
    outcome.activeManualBlockCount > 0 ||
    activeBedRetirementCount > 0;
  return (
    <div className="space-y-5">
      <div className={`flex gap-3 rounded-lg border p-4 ${completed ? "border-success/25 bg-success/10" : "border-info/25 bg-info/10"}`}>
        {completed
          ? <CheckCircle2 className="mt-0.5 shrink-0 text-success" size={19} />
          : <Clock3 className="mt-0.5 shrink-0 text-info-content" size={19} />}
        <div>
          <p className="font-semibold">{completed ? "Retirement completed" : waiting ? "Waiting for active claims" : "Finalization in progress"}</p>
          <p className="mt-1 text-sm text-base-content/60">
            {completed
              ? `The ${targetKind} is retired and remains available in historical records.`
              : waiting
                ? "Move affected reservations, release manual blocks, and finish nested retirements. The process will continue automatically."
                : "Properties is finalizing the physical topology change."}
          </p>
        </div>
      </div>
      {!completed && (
        <div className={`grid gap-3 ${activeBedRetirementCount > 0 ? "grid-cols-3" : "grid-cols-2"}`}>
          <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{outcome.activeAllocationCount}</p><p className="text-xs text-base-content/50">Reservations</p></div>
          <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{outcome.activeManualBlockCount}</p><p className="text-xs text-base-content/50">Manual blocks</p></div>
          {activeBedRetirementCount > 0 && <div className="rounded-lg bg-base-200 p-4"><p className="text-2xl font-semibold">{activeBedRetirementCount}</p><p className="text-xs text-base-content/50">Bed retirements</p></div>}
        </div>
      )}
      <ModalActions>
        {outcome.affectedReservationIds.length > 0 && <Link className="btn btn-outline btn-sm w-full sm:btn-md sm:w-auto" to="/reservations" onClick={onClose}>Open reservations</Link>}
        <button className="btn btn-primary btn-sm sm:btn-md" onClick={onClose}>Done</button>
      </ModalActions>
    </div>
  );
}
