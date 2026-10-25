import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import type { Reservation } from "../../api/types";
import { useSession } from "../../app/session";
import { focusModalRecoveryFeedback } from "../../components/ui/modalFocus";
import { ErrorState } from "../../components/ui/primitives";
import { clearReservationRecovery, recoveryMatchesSession, updateReservationRecovery, type ReservationRecoverySnapshot } from "./reservationCreationRecovery";
import { reservationCreateReceiptMatches } from "./reservationsMutationAuthority";

export function ReservationCreationRecovery({ snapshot, propertyId, mayReadCurrent, contextReady = true, pending, autoCheck, onRecovered, refresh }: {
  snapshot: ReservationRecoverySnapshot;
  propertyId: string;
  mayReadCurrent: boolean;
  contextReady?: boolean;
  pending: boolean;
  autoCheck: boolean;
  onRecovered: (reservation: Reservation, warning: string | null) => Promise<void>;
  refresh: () => void;
}) {
  const { session, request } = useSession();
  const [run, setRun] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const record = snapshot.kind === "record" ? snapshot.record : null;
  const matching = Boolean(record && recoveryMatchesSession(record, session));
  const exactProperty = matching && record?.propertyId === propertyId;
  const identity = `${session?.tenantId}:${session?.subjectId}:${session?.sessionId}:${propertyId}:${record?.operationId}`;
  const latest = useRef({ identity, mayReadCurrent, contextReady, onRecovered });
  latest.current = { identity, mayReadCurrent, contextReady, onRecovered };
  const started = useRef("");
  useLayoutEffect(() => { if (error) focusModalRecoveryFeedback(feedback.current); }, [error]);

  useEffect(() => {
    if (!record || !exactProperty || !mayReadCurrent || !contextReady || pending || (!autoCheck && run === 0)) return;
    const key = `${identity}:${run}`;
    if (started.current === key) return;
    started.current = key;
    const controller = new AbortController();
    let settled = false;
    setChecking(true); setError(null);
    void request<Reservation>(`/api/reservations/properties/${propertyId}/${record.operationId}`, { signal: controller.signal })
      .then(async (reservation) => {
        if (controller.signal.aborted || latest.current.identity !== identity || !latest.current.mayReadCurrent || !latest.current.contextReady) return;
        if (!reservationCreateReceiptMatches(reservation, propertyId) || reservation.reservationId !== record.operationId) throw new Error("The response did not match the saved request. No new reservation has been sent. Recheck or inspect the reservation directory.");
        updateReservationRecovery(record, "primary-confirmed");
        const warning = record.followOnNeeded ? "The reservation exists. Its optional Guest Record creation or linking has not been verified after recovery. Review the linked Guest Record here; no guest operation was repeated." : null;
        await latest.current.onRecovered(reservation, warning);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || latest.current.identity !== identity) return;
        setError(failure instanceof ApiError && failure.status === 404
          ? new Error("This reservation is not visible yet. The earlier save may still be finishing; this does not mean it failed. Recheck shortly or inspect Reservations before starting another booking.")
          : failure);
      })
      .finally(() => { settled = true; if (!controller.signal.aborted && latest.current.identity === identity) setChecking(false); });
    return () => { controller.abort(); if (!settled) started.current = ""; setChecking(false); };
  }, [identity, record?.operationId, exactProperty, mayReadCurrent, contextReady, pending, autoCheck, run, propertyId, request]);

  if (snapshot.kind === "none") return null;
  const busy = pending || checking;
  return <section className="space-y-3 rounded border border-warning/30 bg-warning/8 p-3" aria-label="Reservation save recovery">
    <div ref={feedback} tabIndex={-1} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <h3 className="font-semibold">{pending ? "Saving this reservation" : "Check the previous save before creating another"}</h3>
      <p className="mt-1 text-sm text-base-content/70">{snapshot.kind === "unavailable"
        ? "This tab cannot access its recovery marker. Allow session storage and retry. No untracked new save will be sent."
        : snapshot.kind === "malformed" ? "This tab has an unreadable or unsupported recovery marker. No reservation lookup has been made from it."
          : !matching ? "This recovery marker belongs to a different signed-in session. This account will not look up that session’s reservation."
            : !exactProperty ? "The earlier save belongs to another property. Open that property to check it, or deliberately stop recovery."
              : pending ? "Keep this page open while the result is being recorded. Reloading this tab can recover the request, but cannot restore guest fields."
                : "The previous request may already have created a reservation. Check its exact result; do not create a duplicate. Guest fields were not stored in this browser marker."}</p>
      {error ? <div className="mt-3"><ErrorState error={error} /></div> : null}
    </div>
    <div className="flex flex-wrap gap-2">
      {exactProperty ? <button type="button" className="btn btn-primary btn-sm" disabled={busy || !mayReadCurrent || !contextReady} onClick={() => setRun((value) => value + 1)}>{checking ? "Checking saved reservation…" : !contextReady ? "Checking return context…" : "Check saved reservation"}</button>
        : snapshot.kind === "unavailable" ? <button type="button" className="btn btn-primary btn-sm" onClick={refresh}>Retry tab storage</button>
          : matching && record ? <Link className="btn btn-primary btn-sm" to={`/reservations?${new URLSearchParams({ property: record.propertyId, new: "1" })}`}>Open saved request’s property</Link> : null}
      {!pending && <Link className="btn btn-ghost btn-sm" to={`/reservations?${new URLSearchParams({ property: exactProperty && record ? record.propertyId : propertyId })}`}>Inspect Reservations</Link>}
      {!acknowledging && snapshot.kind !== "unavailable" && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAcknowledging(true)}>Stop recovery…</button>}
    </div>
    {exactProperty && !mayReadCurrent && <p className="text-sm" role="status">Current reservation-read access is needed to check the result. The marker is retained while access recovers.</p>}
    {acknowledging && <div className="space-y-2 border-t border-warning/30 pt-3">
      <p className="text-sm">Removing this marker does not cancel or undo a reservation. Creating again could duplicate the earlier save. Inspect Reservations or ask an operator with access if the result is unclear.</p>
      <label className="flex items-start gap-2 text-sm"><input className="checkbox checkbox-sm mt-0.5" type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />I understand; remove this tab’s recovery marker.</label>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy || !acknowledged} onClick={() => {
        try { clearReservationRecovery(record); setError(null); refresh(); }
        catch { setError(new Error("The marker could not be removed safely. Retry tab storage before starting a new save.")); }
      }}>Remove marker</button>
    </div>}
  </section>;
}
