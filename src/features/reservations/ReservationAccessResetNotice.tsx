import { useEffect, useRef, useState } from "react";

export type ReservationAccessReset = {
  accessCurrent: boolean;
  canStartFresh: boolean;
  onRetry: () => Promise<unknown>;
  onStartFresh: () => void;
};

export function ReservationAccessResetNotice({ recovery, hasSaveRecovery, pending }: {
  recovery: ReservationAccessReset;
  hasSaveRecovery: boolean;
  pending: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <section className="space-y-3 rounded border border-warning/30 bg-warning/10 p-3" aria-label="Reservation access recovery">
    <div role="status">
      <h3 className="font-semibold">Reservation access could not be confirmed</h3>
      <p className="mt-1 text-sm">The form was reset and its guest details were cleared. These details cannot be restored.</p>
      <p className="mt-2 text-sm">{hasSaveRecovery
        ? "Save recovery takes priority. A previous request may already have created a reservation; check its result before creating another."
        : recovery.canStartFresh ? "Access is confirmed for this property. Start a fresh form to re-enter the booking details."
          : recovery.accessCurrent ? "Reservation creation and inventory access are required for this property. Ask a workspace administrator for access."
            : "Check access again before starting a fresh reservation."}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-outline btn-sm" disabled={checking || pending} onClick={async () => {
        setChecking(true);
        try { await recovery.onRetry(); } finally { if (mounted.current) setChecking(false); }
      }}>{checking ? "Checking access…" : "Check access"}</button>
      {!hasSaveRecovery && recovery.canStartFresh && <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={recovery.onStartFresh}>Start a fresh reservation</button>}
    </div>
  </section>;
}
