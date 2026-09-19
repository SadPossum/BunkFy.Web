import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { ErrorState, Modal } from "../../components/ui/primitives";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { retirementStatus, retirementStatusLabel } from "./topologyRetirementEditorModel";
import { withRetirementReturn } from "./topologyRetirementRoutes";
import type { TopologyRetirementEditor } from "./useTopologyRetirementEditor";

export function TopologyRetirementPanel({ editor, inline = false, mayReadReservations, blocksHref, mayUseTemporaryBlock = false }: {
  editor: TopologyRetirementEditor; inline?: boolean; mayReadReservations: boolean; blocksHref?: string | null; mayUseTemporaryBlock?: boolean;
}) {
  if (!editor.target) return null;
  return <RetirementPanel key={editor.context} editor={editor} inline={inline} mayReadReservations={mayReadReservations} blocksHref={blocksHref} mayUseTemporaryBlock={mayUseTemporaryBlock} />;
}

function RetirementPanel({ editor, inline, mayReadReservations, blocksHref, mayUseTemporaryBlock }: {
  editor: TopologyRetirementEditor; inline: boolean; mayReadReservations: boolean; blocksHref?: string | null; mayUseTemporaryBlock: boolean;
}) {
  const target = editor.target!;
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const section = useRef<HTMLElement>(null);
  const heading = useId();
  const process = editor.process;
  const status = retirementStatus(process?.status);
  const impact = editor.older ? null : editor.data?.impact;
  const asking = Boolean(editor.startingNew || (editor.data && !process && !editor.older && !editor.readPending && !editor.readError));
  const frozen = editor.busy || Boolean(editor.mutation.error);
  const needsAuthentication = isInsufficientAuthenticationError(editor.mutation.error);
  const closeRef = useRef(editor.close); closeRef.current = editor.close;
  const focusDraft = () => requestAnimationFrame(() => {
    if (document.activeElement === document.body) (section.current?.querySelector<HTMLElement>("textarea:not(:disabled)") ?? section.current)?.focus();
  });
  useEffect(() => {
    const trigger = editor.opener.current;
    const fallback = document.querySelector<HTMLElement>("[data-topology-region] h2, [data-retirement-fallback]");
    if (inline) (section.current?.querySelector<HTMLElement>("textarea:not(:disabled)") ?? section.current)?.focus();
    return () => { requestAnimationFrame(() => {
      if (editor.opener.current !== trigger || document.activeElement !== document.body) return;
      const visible = (node: HTMLElement | null) => Boolean(node?.isConnected && node.getClientRects().length && !node.matches(":disabled") && !node.closest("[inert]"));
      const destination = visible(trigger) ? trigger : visible(fallback) ? fallback : null;
      if (destination) { if (destination === fallback) destination.tabIndex = -1; destination.focus(); destination.scrollIntoView({ block: "nearest" }); }
      editor.opener.current = null;
    }); };
  }, [editor.opener, inline]);
  useEffect(() => {
    if (document.activeElement !== document.body || editor.busy) return;
    const feedback = section.current?.querySelector<HTMLElement>('[role="alert"], [data-retirement-feedback], [role="status"]');
    if (feedback) { feedback.tabIndex = -1; feedback.classList.add("focus:outline-2", "focus:outline-primary", "outline-offset-2"); feedback.focus(); }
    else (section.current?.querySelector<HTMLElement>('input[type="password"]:not(:disabled), textarea:not(:disabled)') ?? section.current)?.focus();
  }, [editor.busy, editor.mutation.error, editor.readError, editor.notice, editor.canRequest, editor.reviewed, editor.relatedReadState, stopping]);
  useEffect(() => { if (status !== 1) { setStopping(false); setStopConfirmed(false); } }, [status]);
  const reservations = impact?.affectedReservationIds ?? [];
  const reservationParams = new URLSearchParams({ property: target.propertyId });
  if (reservations.length) { reservationParams.set("affected", reservations.join(",")); reservationParams.set("reservation", reservations[0]); reservationParams.set("focus", reservations[0]); }
  const reservationsHref = mayReadReservations && reservations.length ? "/reservations?" + withRetirementReturn(reservationParams, editor.origin.pathname, editor.origin.params) : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!frozen && confirmed && reason.trim() && editor.canRequest) editor.request(reason.trim());
  }
  const content = <section ref={section} tabIndex={-1} aria-labelledby={inline ? heading : undefined} data-retirement-editor
    className={inline ? "border-t border-base-300 bg-base-200/25 p-4 outline-offset-[-3px] focus:outline-2 focus:outline-primary sm:p-5" : "outline-offset-2"}
    onFocusCapture={inline ? (event) => {
      const node = event.target;
      requestAnimationFrame(() => {
        if (!node.isConnected || document.activeElement !== node || node === section.current || !section.current?.contains(node)) return;
        const footer = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (!footer?.getClientRects().length) return;
        const bounds = node.getBoundingClientRect();
        const top = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        // The scoped inline-editor scroll-margin includes the fixed footer and
        // safe area; native Tab's own scrolling does not reliably honor it.
        if (bounds.bottom > footer.getBoundingClientRect().top - 12 || bounds.top < top + 12) node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    } : undefined}>
    {inline && <h3 id={heading} className="mb-3 break-words text-base font-semibold">{asking ? "Retire" : "Retirement"} {target.kind} · {target.label}</h3>}
    <div className="space-y-4">
      {editor.notice && <p role="status" className="border-l-2 border-success pl-3 text-sm">{editor.notice}</p>}
      {!editor.authorityCurrent && <p role="alert" className="text-sm">Current property access is required. No retirement action is available.</p>}
      {editor.relatedReadState === "refreshing" ? <p role="status" className="text-sm">Refreshing related room, bed and availability details. Treat the previous values as unconfirmed until this finishes.</p>
        : editor.relatedReadState === "unconfirmed" && inline ? <p className="text-sm">Retirement status is kept. Related room, bed and availability details are last confirmed, not current.</p>
        : editor.relatedReadState === "unconfirmed" ? <div role="alert" className="space-y-2 text-sm">
          <p>Some related room, bed or availability details are unconfirmed. The retirement result is kept separately.</p>
          <button type="button" className="btn btn-sm btn-outline" disabled={editor.busy} onClick={() => void editor.refreshRelated()}>Refresh related details</button>
        </div> : null}
      {editor.readPending && <p role="status" className="text-sm">Loading this {target.kind}'s retirement and current reservations or blocks…</p>}
      {editor.readError ? <div data-retirement-feedback className="space-y-2">
        <ErrorState error={editor.readError} title="Retirement details could not be confirmed" />
        <button type="button" className="btn btn-sm btn-outline" disabled={editor.busy || editor.readRefreshing} onClick={() => void editor.refresh()}>Try again</button>
      </div> : !editor.readPending && editor.data?.impact === null && !editor.older ? <div role="alert" className="space-y-2 text-sm">
        <p>Retirement status is shown, but current reservations and blocks could not be checked. Actions are paused.</p>
        <button type="button" className="btn btn-sm btn-outline" disabled={editor.busy || editor.readRefreshing} onClick={() => void editor.refresh()}>Try again</button>
      </div> : null}
      {editor.older && <div className="space-y-2 text-sm"><p>This saved link refers to an earlier attempt. It cannot control the current retirement.</p>
        <button type="button" className="btn btn-sm btn-outline" disabled={editor.busy} onClick={editor.showCurrent}>Show current retirement</button></div>}
      {process && <div className="space-y-2">
        <p className="font-semibold">{retirementStatusLabel(process.status)}</p>
        <p className="text-sm">{status === 4 ? "This space has been retired. It cannot be reopened through the current Spaces workflow."
          : status === 6 ? "The retirement restriction was removed. Existing reservations and blocks still apply."
          : status === 1 ? "This space is unavailable while retirement is in progress. Move or release the reservations and blocks below before it can finish."
          : status === 2 || status === 3 ? "Finalization is underway. It is too late to stop this retirement."
          : status === 5 ? "Retirement could not finish. Review current reservations, blocks and physical records before retrying."
          : "The process status is unconfirmed. No lifecycle action is available."}</p>
        <details className="text-xs"><summary className="min-h-10 cursor-pointer py-2 font-semibold">Reason and audit details</summary>
          <dl className="grid min-w-0 gap-2 break-words sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt>Reason</dt><dd>{process.reason}</dd>
            <dt>Requested by</dt><dd>{process.requestedBy}</dd>
            <dt>Requested (UTC)</dt><dd>{new Date(process.createdAtUtc).toISOString().replace("T", " ").replace(".000Z", " UTC")}</dd>
            {process.cancellationReason && <><dt>Stop reason</dt><dd>{process.cancellationReason}</dd><dt>Stopped by</dt><dd>{process.canceledBy}</dd></>}
            {process.canceledAtUtc && <><dt>Stopped (UTC)</dt><dd>{new Date(process.canceledAtUtc).toISOString().replace("T", " ").replace(".000Z", " UTC")}</dd></>}
            {process.rejectionReasonCode !== null && <><dt>Failure code</dt><dd>{process.rejectionReasonCode}</dd></>}
            <dt>Process / revision</dt><dd className="break-all">{process.topologyChangeId} · {process.version}</dd>
          </dl>
        </details>
      </div>}
      {impact && <div className="space-y-2 text-sm">
        <p className="font-semibold">Current dependencies{editor.readError || !editor.contextCurrent ? " · last confirmed" : ""}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div><dt className="text-xs text-base-content/60">Reservations</dt><dd>{impact.activeAllocationCount}</dd></div>
          <div><dt className="text-xs text-base-content/60">Blocks</dt><dd>{impact.activeManualBlockCount}</dd></div>
          {target.kind === "room" && <div><dt className="text-xs text-base-content/60">Bed retirements</dt><dd>{impact.activeBedRetirementCount}</dd></div>}
        </dl>
        {impact.parentRoomRetirementActive && <p>The parent room is already being retired. This bed cannot start a separate retirement.</p>}
        {reservationsHref && <Link className="link inline-flex min-h-10 items-center text-primary" to={reservationsHref}>Review affected reservations{impact.affectedReservationIdsTruncated ? " (first 25)" : ""}</Link>}
        {blocksHref && impact.activeManualBlockCount > 0 && <Link className="link inline-flex min-h-10 items-center text-primary" to={blocksHref}>Review blocks for this space</Link>}
      </div>}
      {asking && <div className="border-l-2 border-warning pl-3 text-sm">
        <p>Use retirement to take this {target.kind} out of service. It is unavailable while retirement is in progress. Existing reservations and blocks must be moved or released; they are not deleted.</p>
        <p className="mt-2">Once completed, retirement cannot be reopened through the current Spaces workflow.</p>
        <p className="mt-2">For a temporary closure, use a dated block instead.</p>
        {blocksHref && mayUseTemporaryBlock && editor.data?.isTopologyActive && <Link className="link mt-1 inline-flex min-h-10 items-center text-primary" to={blocksHref}>Open Blocks for this space</Link>}
      </div>}
      {needsAuthentication ? <RecentAuthenticationPrompt error={editor.mutation.error} title={"Confirm your password for this " + target.kind + " retirement"} onAuthenticated={editor.resumeAfterAuthentication} />
        : editor.mutation.error ? <div data-retirement-feedback className="space-y-2">
          <ErrorState error={editor.mutation.error} title={editor.rejected ? "This action was not accepted" : "The action outcome is unconfirmed"} />
          {editor.rejected ? <><p className="text-sm">Your reason is kept. Refresh and review the current retirement before using a new attempt.</p>
            <button type="button" className="btn btn-sm btn-outline" disabled={editor.busy || editor.readRefreshing} onClick={() => void editor.refresh()}>Refresh current retirement</button>
            {editor.reviewed && <button type="button" className="btn btn-sm btn-outline" disabled={!editor.contextCurrent || editor.busy} onClick={() => { editor.reviewCurrent(); focusDraft(); }}>Use reviewed status and keep reason</button>}</>
            : <><p className="text-sm">Retry sends the same operation, target and original revision.</p><button type="button" className="btn btn-sm btn-outline" disabled={!editor.canReplay || editor.busy} onClick={editor.retrySame}>Retry same request</button></>}
        </div> : null}
      {editor.resumePending && <p role="status" className="text-sm">Password confirmed. Waiting for current access before retrying the same action…</p>}
      {asking && !needsAuthentication && <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={frozen} className="space-y-3">
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Reason for retirement</span>
            <textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="textarea textarea-bordered min-h-20 w-full" /></label>
          <label className="flex min-h-10 items-start gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm mt-0.5 shrink-0" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I understand this takes the {target.kind} out of service and completed retirement cannot be reopened here.</span></label>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-ghost" disabled={editor.busy} onClick={() => closeRef.current()}>Cancel</button>
          <button type="submit" className="btn btn-sm btn-error" disabled={frozen || !confirmed || !reason.trim() || !editor.canRequest}>{editor.busy ? "Starting…" : "Confirm retirement"}</button>
        </div>
      </form>}
      {!asking && !editor.mutation.error && !editor.older && <div className="space-y-3">
        {editor.canRequest && <button type="button" className="btn btn-sm btn-outline text-error" disabled={editor.busy} onClick={() => { editor.startNew(); setConfirmed(false); focusDraft(); }}>Start a new retirement</button>}
        {status === 5 && <button type="button" className="btn btn-sm btn-outline" disabled={!editor.canRetry || editor.busy} onClick={editor.retryFinalization}>Retry finalization</button>}
        {status === 1 && !stopping && <button type="button" className="btn btn-sm btn-outline" disabled={!editor.canCancel || editor.busy} onClick={() => { setStopping(true); focusDraft(); }}>Stop retirement</button>}
        {stopping && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!frozen && stopConfirmed && stopReason.trim() && editor.canCancel) editor.stop(stopReason.trim()); }}>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold">Reason for stopping</span><textarea required maxLength={500} disabled={frozen} value={stopReason} onChange={(event) => setStopReason(event.target.value)} className="textarea textarea-bordered min-h-20 w-full" /></label>
          <label className="flex min-h-10 items-start gap-2 text-sm"><input type="checkbox" className="checkbox checkbox-sm mt-0.5 shrink-0" disabled={frozen} checked={stopConfirmed} onChange={(event) => setStopConfirmed(event.target.checked)} /><span>Stop this retirement. Existing reservations and blocks remain unchanged.</span></label>
          <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-sm btn-ghost" disabled={editor.busy} onClick={() => { setStopping(false); focusDraft(); }}>Keep retirement</button><button type="submit" className="btn btn-sm btn-primary" disabled={frozen || !stopConfirmed || !stopReason.trim() || !editor.canCancel}>Confirm stop</button></div>
        </form>}
      </div>}
      {(!asking || needsAuthentication) && <button type="button" className="btn btn-sm btn-ghost" disabled={editor.busy} onClick={() => closeRef.current()}>{process ? "Close" : "Cancel"}</button>}
    </div>
  </section>;
  return inline ? content : <Modal open title={`Retirement · ${target.label}`} onClose={() => { if (!editor.busy) closeRef.current(); }}>{content}</Modal>;
}
