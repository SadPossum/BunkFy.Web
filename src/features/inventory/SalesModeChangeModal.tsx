import { useCallback, useEffect, useId, useRef } from "react";
import { Link } from "react-router";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { compositeSourceUsable } from "../../app/compositeSourceState";
import { CompositeSourceFallback, CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, LoadingState, Modal } from "../../components/ui/primitives";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { activeSalesBeds, canonicalSalesMode, salesBlockerSummary, salesModeLabel } from "./salesModeEditorModel";
import { affectedSalesReservationsUrl } from "./salesModeRoutes";
import type { SalesModeEditor } from "./useSalesModeEditor";

// Legacy Inventory keeps its modal entry; Spaces uses this exact form inline.
export function SalesModeChangeModal({ editor, inline = false, mayReadReservations }: { editor: SalesModeEditor; inline?: boolean; mayReadReservations: boolean }) {
  if (!editor.target) return null;
  return <SalesModeForm key={editor.instance} editor={editor} inline={inline} mayReadReservations={mayReadReservations} />;
}
function SalesModeForm({ editor, inline, mayReadReservations }: { editor: SalesModeEditor; inline: boolean; mayReadReservations: boolean }) {
  const target = editor.target!;
  const section = useRef<HTMLElement>(null);
  const heading = useId();
  const closeRef = useRef(editor.close);
  closeRef.current = editor.close;
  const close = useCallback(() => closeRef.current(), []);
  const frozen = editor.busy || Boolean(editor.mutation.error);
  const needsAuthentication = isInsufficientAuthenticationError(editor.mutation.error);
  const usable = compositeSourceUsable(editor.impactSource.state);
  const blockers = editor.impact ? salesBlockerSummary(editor.impact) : "";
  const reservationsHref = affectedSalesReservationsUrl(editor.impact, new URLSearchParams(target.originParams), mayReadReservations);
  const focusChoice = () => requestAnimationFrame(() => {
    if (document.activeElement === document.body) (section.current?.querySelector<HTMLElement>('input:checked:not(:disabled), input:not(:disabled)') ?? section.current)?.focus();
  });
  useEffect(() => {
    const trigger = editor.opener.current;
    const fallback = section.current?.closest("[data-sales-region]")?.querySelector<HTMLElement>("h2, h3");
    if (inline) (section.current?.querySelector<HTMLElement>('input:checked:not(:disabled), input:not(:disabled)') ?? section.current)?.focus();
    return () => { requestAnimationFrame(() => {
      if (editor.opener.current !== trigger || document.activeElement !== document.body) return;
      const available = (node: HTMLElement | null | undefined) => Boolean(node?.isConnected && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length);
      const destination = available(trigger) ? trigger : available(fallback) ? fallback : null;
      if (destination) { if (destination === fallback) { destination.tabIndex = -1; destination.classList.add("focus:outline-2", "focus:outline-primary", "outline-offset-2"); } destination.focus(); }
      editor.opener.current = null;
    }); };
  }, [inline, editor.opener]);
  useEffect(() => {
    if (document.activeElement !== document.body || editor.busy) return;
    const feedback = section.current?.querySelector<HTMLElement>('[data-sales-mutation-feedback]') ?? section.current?.querySelector<HTMLElement>('[role="alert"], [data-feedback-focus], [role="status"]');
    if (feedback) { feedback.tabIndex = -1; feedback.classList.add("focus:outline-2", "focus:outline-primary", "outline-offset-2"); feedback.focus(); }
    else focusChoice();
  }, [editor.mutation.error, editor.impactSource.state, editor.targetCurrent, editor.busy, editor.resumePending]);
  const content = <section ref={section} tabIndex={-1} data-sales-editor aria-labelledby={inline ? heading : undefined}
    className={inline ? "border-t border-base-300 bg-base-200/25 p-4 outline-offset-[-3px] sm:p-5" : "outline-offset-2"}
    onFocusCapture={inline ? (event) => {
      const node = event.target;
      requestAnimationFrame(() => {
        if (!node.isConnected || node !== document.activeElement || node === section.current || !section.current?.contains(node)) return;
        const footer = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (!footer?.getClientRects().length) return;
        const bounds = node.getBoundingClientRect();
        const top = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        if (bounds.bottom > footer.getBoundingClientRect().top - 12 || bounds.top < top + 12) node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    } : undefined}>
    {inline && <h3 id={heading} className="text-base font-semibold break-words">How {target.room.roomName} is sold</h3>}
    <p className="mt-2 text-sm text-base-content/65">{editor.roomReadCurrent ? "Current setup" : "Last confirmed setup"}: {salesModeLabel(editor.currentRoom?.salesMode ?? target.room.salesMode)}. Availability for specific dates is checked separately.</p>
    <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); editor.save(); }}>
      <fieldset disabled={frozen} className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Sell this room as</legend>
        {([{ value: "roomLevel", label: "Whole room", detail: "One booking reserves the room." }, { value: "bedLevel", label: "Individual beds", detail: "Beds can be booked separately." }] as const).map((option) => <label key={option.value} className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
          <input type="radio" className="radio radio-sm mt-0.5 shrink-0" name={heading} value={option.value} checked={target.salesMode === option.value} onChange={() => editor.setMode(option.value)} />
          <span className="min-w-0"><span className="font-semibold">{option.label}</span><span className="block text-xs text-base-content/65">{option.detail}</span></span>
        </label>)}
      </fieldset>
      {target.salesMode === "bedLevel" && activeSalesBeds(editor.currentRoom ?? target.room) === 0 && <p role="status" className="text-sm text-warning-content">Individual-bed sales require at least one active bed. Add a bed in Layout first.</p>}
      {!editor.rejected && usable && <CompositeSourceNotice className="mb-4 flex" sources={[editor.impactSource]} title="The latest room impact is delayed" />}
      {editor.impactSource.state === "loading" ? <LoadingState label="Checking room impact" /> : editor.impact && usable ? <>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-base-300 py-3 text-sm">
          {([["Reservations", editor.impact.activeAllocationCount], ["Blocks", editor.impact.activeManualBlockCount], ["Bed retirements", editor.impact.activeBedRetirementCount], ["Room retirements", editor.impact.activeRoomRetirementCount]] as const).map(([label, count]) => <div className="flex min-w-0 justify-between gap-2" key={label}><dt className="break-words text-base-content/65">{label}</dt><dd className="font-semibold">{count}</dd></div>)}
        </dl>
        <p className="text-sm">{blockers ? `Resolve ${blockers} before changing how this room is sold.` : !editor.impact.canChangeSalesMode ? "This room cannot change its selling setup yet. Refresh the impact before continuing." : "No active claims in the latest check. BunkFy checks again when you save."}</p>
        {editor.impact.affectedReservationIdsTruncated && <p className="text-xs text-base-content/65">Only the first {editor.impact.affectedReservationIds.length} affected reservation IDs were returned. Check again after resolving them.</p>}
        {reservationsHref && <Link className="btn btn-outline btn-sm max-w-full h-auto min-h-10 whitespace-normal" to={reservationsHref} onClick={close}>Review {editor.impact.affectedReservationIds.length} {editor.impact.affectedReservationIds.length === 1 ? "reservation" : "reservations"}</Link>}
      </> : editor.rejected ? <p className="text-sm" role="status">Current room impact is unavailable. Refresh current details below.</p> : <CompositeSourceFallback state={editor.impactSource.state} error={editor.impactError} label="room impact" retry={() => void editor.impactSource.refetch()} title="Room impact could not be loaded" />}
      {editor.rejected ? <div role="alert" data-sales-mutation-feedback className="space-y-2 text-sm">
        <ErrorState error={editor.mutation.error} title="This selling change was not accepted" />
        <p>Your choice is kept. Refresh and review the current room and impact before trying a new change.</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void editor.refresh()}>Refresh current details</button>
      </div> : needsAuthentication ? null : editor.mutation.error ? <div data-sales-mutation-feedback data-feedback-focus className="space-y-2 text-sm">
        <ErrorState error={editor.mutation.error} title="Selling change unconfirmed" />
        <p>Retry sends the same request, without creating another change.</p>
        <button type="button" className="btn btn-outline btn-sm" disabled={!editor.canRetry || editor.busy} onClick={editor.retry}>Retry same save</button>
      </div> : !editor.targetCurrent && <div role="status" className="space-y-2 text-sm">
        <p>Current access or this exact room changed or is unavailable. Your choice is kept; no other room will be used.</p>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => void editor.refresh()}>Refresh current details</button>
      </div>}
      {!editor.busy && (editor.rejected || !editor.targetCurrent) && editor.canUseCurrent && <div className="border-l-2 border-primary pl-3 text-sm space-y-2">
        <p className="font-semibold">Current saved setup</p>
        <p>{editor.currentRoom?.roomName} · {salesModeLabel(editor.currentRoom?.salesMode)} · version {editor.currentRoom?.version}</p>
        {canonicalSalesMode(editor.currentRoom?.salesMode) === target.salesMode ? <>
          <p>The current setup already matches your choice. No new save is needed.</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={close}>Keep current setup</button>
        </> : <button type="button" className="btn btn-outline btn-sm h-auto min-h-10 whitespace-normal" onClick={() => { editor.useCurrent(); focusChoice(); }}>Use current setup and keep choice</button>}
      </div>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-base-300 pt-4">
        <button type="button" className="btn btn-ghost" disabled={editor.busy} onClick={close}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!editor.canSubmit || frozen}>{editor.busy ? "Saving…" : "Save selling setup"}</button>
      </div>
    </form>
    {needsAuthentication && <div className="mt-4"><RecentAuthenticationPrompt error={editor.mutation.error} onAuthenticated={editor.resumeAfterAuthentication} />
      {editor.resumePending && <div role="status" className="mt-2 space-y-2 text-sm"><p>Sign-in confirmed. Waiting for current access and room details before retrying this same change.</p><button type="button" className="btn btn-outline btn-sm" onClick={() => void editor.refresh()}>Refresh current details</button></div>}
    </div>}
  </section>;
  return inline ? content : <Modal open title={`How ${target.room.roomName} is sold`} onClose={close}>{content}</Modal>;
}
export function SalesModeNotice({ notice }: { notice: string }) {
  return notice ? <p role="status" className="border-b border-base-300 px-4 py-3 text-sm sm:px-5">{notice}</p> : null;
}
