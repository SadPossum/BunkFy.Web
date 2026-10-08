import { useEffect, useRef, useState } from "react";
import type { BeginStationJob } from "./StationPage";
import { stationApi, StationRequestError } from "./stationClient";
import { clearConfirmedCheckOut, type StationAttempt } from "./stationRecovery";
import type { StationCurrent } from "./stationTypes";

/** Recovery stays available even when the new actor has no checkout permission. */
export function StationCheckOutRecovery({ attempt, view, canRetry, beginJob, onResolved, onAuthorityChanged }: {
  attempt: StationAttempt; view: StationCurrent; canRetry: boolean; beginJob: BeginStationJob;
  onResolved: () => void; onAuthorityChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const session = view.runtime.session;
  const sameBrowser = session?.browserSessionId === attempt.browserSessionId;
  const matches = canRetry && sameBrowser && session.generation === attempt.generation &&
    session.actor?.actorSessionId === attempt.actorSessionId;
  async function resolve() {
    if (!sameBrowser || needsReview || inFlight.current || !attempt.reservationId || !attempt.expectedVersion || !attempt.actorSessionId) return;
    inFlight.current = true; setPending(true);
    const job = await beginJob();
    if (!job) { inFlight.current = false; setPending(false); return; }
    try {
      if (!alive.current) return;
      const current = job.view.runtime.session;
      const mayRetry = canRetry && job.view.jobs?.checkOut === 0 && current?.browserSessionId === attempt.browserSessionId &&
        current.generation === attempt.generation && current.actor?.actorSessionId === attempt.actorSessionId;
      let outcome: number;
      if (mayRetry) {
        const result = await stationApi.checkOut({ operationId: attempt.operationId, reservationId: attempt.reservationId,
          expectedVersion: attempt.expectedVersion, actorSessionId: attempt.actorSessionId,
          expectedGeneration: attempt.generation }, job.view.csrfToken!);
        outcome = result.state === 6 && result.receipt ? result.checkout ?? 0 : 0;
      } else {
        const result = await stationApi.checkOutOutcome({ operationId: attempt.operationId, reservationId: attempt.reservationId,
          expectedVersion: attempt.expectedVersion, browserSessionId: attempt.browserSessionId,
          actorSessionId: attempt.actorSessionId, expectedGeneration: attempt.generation }, job.view.csrfToken!);
        outcome = result.state;
      }
      if (!alive.current) return;
      if (outcome === 2 || outcome === 3) {
        try { clearConfirmedCheckOut(attempt.operationId); }
        catch { setMessage("The outcome is confirmed, but this browser could not clear the saved reference. Check again before continuing."); return; }
        onResolved();
      } else if (outcome === 4 || outcome === 6) {
        setNeedsReview(true);
        setMessage("The original checkout needs a manager’s review. Nothing was repeated. Other reservations remain available.");
      } else setMessage(outcome === 1 ? "Checkout is processing. Inventory release is not confirmed yet. Check again shortly."
        : "The original result is not confirmed. Check again or ask a manager to review the reservation history.");
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof StationRequestError && error.status === 409 && error.state === 4 && !error.code) {
        setNeedsReview(true); setMessage("This saved checkout cannot be matched to a confirmed outcome. Ask a manager to review its history.");
      } else {
        setMessage("The original result is unavailable. Your recovery reference is kept; no second checkout was created.");
        if (error instanceof StationRequestError && [401, 403, 409].includes(error.status)) onAuthorityChanged();
      }
    } finally { job.release(); inFlight.current = false; if (alive.current) setPending(false); }
  }
  return <div className="mb-4 rounded-lg border border-warning/50 bg-base-100 p-4" role="status">
    <h3 className="text-sm font-semibold">A checkout needs its result confirmed</h3>
    <p className="mt-1 text-sm leading-6">{matches
      ? "Check the original operation before another checkout. A retry keeps the same reference."
      : "Staff or access changed. Check the original result without repeating a colleague’s action."}</p>
    {message && <p className="mt-2 text-sm leading-6">{message}</p>}
    {sameBrowser && !needsReview && <button className="btn btn-outline btn-sm mt-3" disabled={pending} onClick={() => void resolve()}>
      {pending ? "Checking…" : "Check original checkout"}</button>}
  </div>;
}
