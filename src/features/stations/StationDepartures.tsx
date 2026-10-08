import { LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { components } from "../../api/contracts.generated";
import type { BeginStationJob } from "./StationPage";
import { stationApi, StationRequestError } from "./stationClient";
import { clearConfirmedCheckOut,
  saveStationAttempt, type StationAttempt } from "./stationRecovery";
import type { StationCurrent, StationDeparture, StationDeparturesPage } from "./stationTypes";

const day = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T12:00:00Z`));
/** Guest data is memory-only and disappears with the active actor boundary. */
export function StationDepartures({ view, beginJob, onAuthorityChanged, attempt, review, recoveryVersion, onRecoveryChanged, onFlightChanged }: {
  view: StationCurrent; beginJob: BeginStationJob; onAuthorityChanged: () => void;
  attempt: StationAttempt | null; review: StationAttempt | null; recoveryVersion: number; onRecoveryChanged: () => void;
  onFlightChanged: (operationId: string, pending: boolean) => void;
}) {
  const [page, setPage] = useState<StationDeparturesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sequence = useRef(0);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const actorId = view.runtime.session?.actor?.actorSessionId;
  const generation = view.runtime.session?.generation;
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current += 1; }; }, []);

  const load = useCallback(async (cursor?: string) => {
    const ticket = ++sequence.current;
    setLoading(true); setConfirming(null);
    const job = await beginJob();
    if (!job) { if (alive.current && ticket === sequence.current) setLoading(false); return; }
    try {
      const result = await stationApi.departures(job.view.runtime.session!.actor!, cursor);
      if (alive.current && ticket === sequence.current) { setPage(result); setLoadError(""); }
    } catch (error) {
      if (alive.current && ticket === sequence.current) {
        // A denied/stale response invalidates guest facts, not the other task's permission.
        setPage(null);
        setLoadError(error instanceof Error ? error.message : "Departures are unavailable. Try again.");
        if (error instanceof StationRequestError && [401, 403, 409].includes(error.status)) onAuthorityChanged();
      }
    } finally { job.release(); if (alive.current && ticket === sequence.current) setLoading(false); }
  }, [beginJob, onAuthorityChanged]);
  useEffect(() => { void load(); }, [actorId, generation, recoveryVersion, load]);

  function terminal(operationId: string, rejected: boolean) {
    let cleared = true;
    try { clearConfirmedCheckOut(operationId); }
    catch { cleared = false; }
    onRecoveryChanged(); setConfirming(null);
    // The latest owner version must be read before another operation is offered.
    // Recovery version changes trigger the one fresh owner read.
    setPage(null);
    setMessage(!cleared ? "The result is confirmed, but this browser could not clear its recovery reference. Check the original result again before continuing."
      : rejected ? "Checkout was not completed. The guest is still in house; refresh and review before trying again." : "Checkout completed.");
  }
  function acceptOutcome(outcome: components["schemas"]["StationCheckOutOutcomeState"], operation: StationAttempt) {
    if (outcome === 2 || outcome === 3) { terminal(operation.operationId, outcome === 3); return; }
    if (outcome === 4 || outcome === 6) {
      setMessage("The original checkout needs a manager’s review. Nothing was repeated. Other departures remain available.");
    } else setMessage(outcome === 1
      ? "Checkout is processing. Inventory release is not confirmed yet. Check the original result before another checkout."
      : "The original result is not confirmed. Nothing was repeated. Check again when the station reconnects.");
  }

  async function send(item: StationDeparture) {
    if (inFlight.current) return;
    inFlight.current = true; setSending(true);
    const job = await beginJob();
    if (!job) { inFlight.current = false; setSending(false); return; }
    const actor = job.view.runtime.session!.actor!;
    const operation: StationAttempt = { kind: "check-out", operationId: crypto.randomUUID(),
      browserSessionId: job.view.runtime.session!.browserSessionId, generation: actor.generation,
      actorSessionId: actor.actorSessionId, reservationId: item.reservation.reservationId,
      expectedVersion: item.reservation.expectedVersion };
    try {
      if (!alive.current || job.view.runtime.session?.actor?.actorSessionId !== actorId ||
        job.view.runtime.session?.generation !== generation) return;
      if (!operation?.actorSessionId || !operation.reservationId || !operation.expectedVersion) return;
      try { saveStationAttempt("check-out", operation); }
      catch { if (alive.current) setMessage("This browser cannot save a recovery reference. Checkout was not sent."); return; }
      onFlightChanged(operation.operationId, true);
      if (alive.current) onRecoveryChanged();
      const result = await stationApi.checkOut({ operationId: operation.operationId, reservationId: operation.reservationId,
        expectedVersion: operation.expectedVersion, actorSessionId: operation.actorSessionId,
        expectedGeneration: operation.generation }, job.view.csrfToken!);
      if (!alive.current) return;
      setConfirming(null);
      if (result.state === 6 && result.receipt && result.checkout != null) acceptOutcome(result.checkout, operation);
      else setMessage("Checkout is not confirmed. Check the original result before starting another operation.");
    } catch (error) {
      if (!alive.current) return;
      setConfirming(null);
      setMessage("Result not confirmed. Check the original checkout; do not start it again with a new reference.");
      if (error instanceof StationRequestError && [401, 403, 409].includes(error.status)) {
        setPage(null); onAuthorityChanged();
      }
    } finally {
      job.release(); inFlight.current = false; onFlightChanged(operation.operationId, false);
      if (alive.current) setSending(false);
    }
  }

  const held = [review, attempt].filter((item): item is StationAttempt => Boolean(item));
  return <section id="station-panel-check-out" role="tabpanel" aria-labelledby="station-tab-check-out" tabIndex={0}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Due departures</h2>
        <p className="mt-1 text-sm text-base-content/65">Today and overdue{page?.propertyLocalDate ? ` · ${day(page.propertyLocalDate)}` : ""}</p></div>
      <button className="btn btn-outline btn-sm aria-disabled:opacity-50" aria-disabled={loading || sending} aria-busy={loading}
        onClick={() => { if (!loading && !sending) void load(); }}><RefreshCw size={16} /> Refresh departures</button>
    </div>
    {message && <p role="status" className="mb-4 rounded-lg border border-base-300 bg-base-100 p-4 text-sm leading-6">{message}</p>}
    {loadError && <p role="status" className="mb-4 text-sm leading-6">{loadError}</p>}
    {loading && <p role="status" className="mb-4 text-sm">Checking current departures…</p>}
    {!loading && !page && !message && !loadError && <p role="status" className="py-6 text-sm">Departure information is unavailable. Refresh to try again.</p>}
    {page && page.state !== 0 ? <p role="status" className="rounded-lg border border-base-300 bg-base-100 p-5 text-sm leading-6">
      {page.state === 4 ? "Reservation and room information is still being checked. Refresh departures to try again."
        : "Departures are unavailable. Ask a manager to check your access and property configuration."}</p>
      : page && !page.items?.length ? <p className="rounded-lg border border-base-300 bg-base-100 p-6 text-sm">No guests are currently due to check out.</p>
        : page && <ul className="divide-y divide-base-300 rounded-lg border border-base-300 bg-base-100">
          {(page.items ?? []).map(item => {
            const reservation = item.reservation;
            const blocked = Boolean(attempt) || held.some(operation => operation.reservationId === reservation.reservationId);
            return <li key={reservation.reservationId} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0"><h3 className="font-semibold [overflow-wrap:anywhere]">{reservation.primaryGuestName}</h3>
                  <p className="mt-1 text-sm text-base-content/70">{day(reservation.arrival)} – {day(reservation.departure)}
                    {page.propertyLocalDate && reservation.departure < page.propertyLocalDate ? " · Overdue" : ""}</p>
                  <p className="mt-2 text-sm [overflow-wrap:anywhere]">{(item.places ?? []).map(place => `${place.roomName}${place.bedLabel ? ` · ${place.bedLabel}` : ""}`).join(", ")}</p>
                  {reservation.state === 1 && <p className="mt-2 text-sm" role="status">Checkout is processing; inventory release is pending.</p>}
                  {reservation.state === 2 && <p className="mt-2 text-sm text-warning-content">Previous checkout did not complete. Guest remains in house.</p>}
                </div>
                {reservation.state !== 1 && <button className="btn btn-primary btn-sm" disabled={blocked || sending || loading}
                  onClick={() => setConfirming(reservation.reservationId)}><LogOut size={16} /> Check out</button>}
              </div>
              {held.some(operation => operation.reservationId === reservation.reservationId) &&
                <p className="mt-3 text-sm">Resolve the saved checkout above before another action on this reservation.</p>}
              {confirming === reservation.reservationId && <div className="mt-4 border-t border-base-300 pt-4">
                <p className="text-sm leading-6">Confirm the guest is leaving. Checkout will be recorded under {view.staffDisplayName}; the space becomes free only when inventory release is confirmed.</p>
                <div className="mt-3 flex flex-wrap gap-3"><button className="btn btn-primary" disabled={sending} onClick={() => void send(item)}>
                  {sending ? "Requesting checkout…" : "Confirm checkout"}</button>
                  <button className="btn btn-ghost" disabled={sending} onClick={() => setConfirming(null)}>Keep in house</button></div>
              </div>}
            </li>;
          })}
        </ul>}
    {page?.continuation && <button className="btn btn-outline mt-4" disabled={loading || sending} onClick={() => void load(page.continuation!)}>Next departures</button>}
  </section>;
}
