import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { ErrorState, Modal } from "../../components/ui/primitives";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import type { PropertyRetirementEditor } from "./usePropertyRetirementEditor";

export function PropertyRetirementPanel({ editor, inline = false }: { editor: PropertyRetirementEditor; inline?: boolean }) {
  const notice = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!editor.confirmed) return;
    requestAnimationFrame(() => { if (notice.current?.isConnected) notice.current.focus(); });
  }, [editor.confirmed]);
  return <>
    {editor.confirmed && <section ref={notice} tabIndex={-1} role="status" className="border-t border-base-300 px-4 py-3 text-sm outline-offset-[-3px] focus:outline-2 focus:outline-primary sm:px-5">
      <h3 className="font-semibold">Property retired · {editor.confirmed.property.name}</h3>
      <p className="mt-1">Retirement stops new processing for this property. Existing records are kept.</p>
      <p className="mt-1 text-xs text-base-content/65">Stored processing configuration at retirement: {editor.confirmed.receipt.processingStatus}. This is the recorded configuration, not the current effective processing status.</p>
      {!editor.readbackCurrent && <div className="mt-2">
        <p>Retirement is confirmed. The property details have not yet been confirmed at this revision.</p>
      </div>}
    </section>}
    {editor.target && <Confirmation key={`${editor.context}:${editor.instance}`} editor={editor} inline={inline} />}
  </>;
}

function Confirmation({ editor, inline }: { editor: PropertyRetirementEditor; inline: boolean }) {
  const target = editor.target!;
  const headingId = useId();
  const section = useRef<HTMLElement>(null);
  const closeRef = useRef(editor.close); closeRef.current = editor.close;
  const close = useCallback(() => closeRef.current(), []);
  const [confirmed, setConfirmed] = useState(false);
  const authentication = isInsufficientAuthenticationError(editor.mutation.error);
  useEffect(() => {
    const trigger = editor.opener.current;
    const fallback = document.querySelector<HTMLElement>("[data-property-retirement-heading]");
    if (inline) section.current?.focus();
    return () => { requestAnimationFrame(() => {
      if (editor.opener.current !== trigger || document.activeElement !== document.body) return;
      const visible = (node: HTMLElement | null) => Boolean(node?.isConnected && node.getClientRects().length && !node.matches(":disabled") && !node.closest("[inert]"));
      const destination = visible(trigger) ? trigger : visible(fallback) ? fallback : null;
      if (destination) { if (destination === fallback) destination.tabIndex = -1; destination.focus(); destination.scrollIntoView({ block: "nearest" }); }
      editor.opener.current = null;
    }); };
  }, [inline, editor.opener]);
  useEffect(() => {
    if (document.activeElement !== document.body || editor.busy) return;
    const feedback = section.current?.querySelector<HTMLElement>('[role="alert"], [role="status"], input:not(:disabled)') ?? section.current;
    if (feedback) { feedback.tabIndex = -1; feedback.classList.add("focus:outline-2", "focus:outline-primary", "outline-offset-2"); feedback.focus(); }
  }, [editor.busy, editor.mutation.error, editor.reviewed, editor.authorityCurrent]);
  const stale = !editor.canConfirm && !editor.busy && !editor.mutation.error;
  const content = <section ref={section} tabIndex={-1} aria-labelledby={headingId} data-retirement-editor
    className="border-t border-base-300 bg-base-200/25 p-4 text-sm outline-offset-[-3px] focus:outline-2 focus:outline-primary sm:p-5"
    onFocusCapture={inline ? (event) => {
      const node = event.target;
      requestAnimationFrame(() => {
        if (!node.isConnected || document.activeElement !== node || node === section.current || !section.current?.contains(node)) return;
        const footer = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (!footer?.getClientRects().length) return;
        const bounds = node.getBoundingClientRect();
        const top = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        if (bounds.bottom > footer.getBoundingClientRect().top - 12 || bounds.top < top + 12) node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    } : undefined}>
    <h3 id={headingId} className="font-semibold">Retire property · {target.name}</h3>
    <p className="mt-2">Every active room must be retired first. Property retirement cannot be reopened here.</p>
    <p className="mt-2">Retirement stops new processing for this property. Existing records and stored processing configuration are kept.</p>
    {authentication ? <div className="mt-4"><RecentAuthenticationPrompt error={editor.mutation.error} title="Confirm your password to retire this property" onAuthenticated={editor.resumeAfterAuthentication} /></div>
      : editor.mutation.error ? <div className="mt-4 space-y-2">
        <ErrorState error={editor.mutation.error} title={editor.rejected ? "Property retirement was not accepted" : "The retirement outcome is unconfirmed"} />
        {editor.activeRooms && <><p>At least one room is still active. Review this property's Layout; the response does not identify individual rooms.</p><Link className="link inline-flex min-h-10 items-center text-primary" to={editor.layoutHref}>Review rooms in Layout</Link></>}
        {editor.rejected ? <p>Refresh and review the property before confirming a new attempt.</p>
          : <><p>Retry sends the same operation and original property revision.</p><button type="button" className="btn btn-sm btn-outline" disabled={!editor.canReplay || editor.busy} onClick={editor.retrySame}>Retry same request</button></>}
      </div> : null}
    {(stale || editor.rejected) && <div className="mt-3 space-y-2">
      {stale && <p role="status">Property details or access changed. Refresh and review before confirming.</p>}
      <button type="button" className="btn btn-sm btn-outline" disabled={editor.refreshing || editor.busy} onClick={() => void editor.refresh()}>Refresh property</button>
      {editor.reviewed && editor.authorityCurrent && editor.property?.status === "retired" ? <p>The current property record is already retired. No new retirement is needed.</p>
        : editor.reviewed && <button type="button" className="btn btn-sm btn-outline ml-2" disabled={!editor.authorityCurrent || editor.busy} onClick={editor.reconfirm}>Review current property</button>}
    </div>}
    {editor.resumePending && <p role="status" className="mt-3">Password confirmed. Waiting for current access before retrying the same retirement…</p>}
    {!authentication && !editor.mutation.error && !stale && <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); if (confirmed && editor.canConfirm) editor.confirm(); }}>
      <label className="flex min-h-10 items-start gap-2"><input type="checkbox" className="checkbox checkbox-sm mt-0.5 shrink-0" disabled={editor.busy} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand that retiring {target.name} cannot be undone here.</span></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-sm btn-ghost" disabled={editor.busy} onClick={() => closeRef.current()}>Cancel</button><button type="submit" className="btn btn-sm btn-error" disabled={!confirmed || !editor.canConfirm || editor.busy}>{editor.busy ? "Retiring…" : "Confirm property retirement"}</button></div>
    </form>}
    {(authentication || editor.mutation.error || stale) && <button type="button" className="btn btn-sm btn-ghost mt-3" disabled={editor.busy} onClick={() => closeRef.current()}>Cancel</button>}
  </section>;
  return inline ? content : <Modal open title={`Retire ${target.name}`} onClose={close}>{content}</Modal>;
}
