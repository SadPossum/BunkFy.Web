import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import { Link } from "react-router-dom";
import type { RoomInventory, RoomInventoryChangeImpact } from "../../api/types";
import { ErrorState, LoadingState, Modal, ModalActions } from "../../components/ui/primitives";

export type PendingSalesModeChange = {
  room: RoomInventory;
  salesMode: "roomLevel" | "bedLevel";
};

export function SalesModeChangeModal({
  change,
  impact,
  loading,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  change: PendingSalesModeChange | null;
  impact?: RoomInventoryChangeImpact;
  loading: boolean;
  pending: boolean;
  error: Error | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!change) return null;
  const targetLabel = change.salesMode === "roomLevel" ? "Private room" : "Shared room";
  const affectedReservationsPath = impact?.affectedReservationIds.length
    ? affectedReservationsUrl(impact)
    : null;

  return (
    <Modal
      open
      title={`Change ${change.room.roomName} to ${targetLabel.toLowerCase()}?`}
      description="Inventory checks every active reservation, block and bed retirement before changing how this room is sold."
      onClose={onClose}
    >
      {loading ? <LoadingState label="Checking room impact" /> : impact ? (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3 rounded-lg bg-base-200 px-4 py-3 font-semibold">
            <span>{salesModeLabel(change.room.salesMode)}</span>
            <ArrowRight size={17} className="text-base-content/40" />
            <span>{targetLabel}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
            <ImpactCount value={impact.activeAllocationCount} label="Reservations" />
            <ImpactCount value={impact.activeManualBlockCount} label="Blocks" />
            <ImpactCount value={impact.activeBedRetirementCount} label="Bed retirements" />
          </div>
          {!impact.canChangeSalesMode && (
            <div className="flex gap-3 rounded-lg border border-warning/25 bg-warning/10 p-4">
              <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={18} />
              <div>
                <p className="font-semibold">This room cannot change mode yet</p>
                <p className="mt-1 text-sm text-base-content/60">Move active reservations, release blocks and finish bed retirements first.</p>
              </div>
            </div>
          )}
          {error && <ErrorState error={error} title="Couldn't change the sales mode" />}
          <ModalActions>
            {affectedReservationsPath && <Link className="btn btn-outline btn-sm w-full sm:btn-md sm:w-auto" to={affectedReservationsPath} onClick={onClose}><CalendarClock size={17} />Review {impact.affectedReservationIds.length} {impact.affectedReservationIds.length === 1 ? "reservation" : "reservations"}</Link>}
            <button className="btn btn-ghost btn-sm sm:btn-md" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm sm:btn-md" onClick={onConfirm} disabled={!impact.canChangeSalesMode || pending}>
              {pending && <span className="loading loading-spinner loading-sm" />}
              Change mode
            </button>
          </ModalActions>
        </div>
      ) : error ? <ErrorState error={error} retry={onClose} title="Couldn't check the room" /> : null}
    </Modal>
  );
}

function ImpactCount({ value, label }: { value: number; label: string }) {
  return <div className="rounded-lg bg-base-200 p-3 text-center"><p className="text-xl font-semibold">{value}</p><p className="mt-1 text-xs text-base-content/50">{label}</p></div>;
}

function salesModeLabel(mode: RoomInventory["salesMode"]) {
  if (mode === 2 || String(mode).toLowerCase() === "roomlevel") return "Private room";
  if (mode === 3 || String(mode).toLowerCase() === "bedlevel") return "Shared room";
  return "Not configured";
}

function affectedReservationsUrl(impact: RoomInventoryChangeImpact) {
  const params = new URLSearchParams({
    property: impact.propertyId,
    affected: impact.affectedReservationIds.join(","),
    focus: impact.affectedReservationIds[0],
    reservation: impact.affectedReservationIds[0],
  });
  return `/reservations?${params}`;
}
