import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Bed } from "../../api/types";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { ErrorState, Modal } from "../../components/ui/primitives";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { createDefaultBedLabels, duplicateBedLabel } from "./propertyFormOptions";
import type { TopologyEditor } from "./useTopologyEditor";

export function TopologyEditorForm({ editor, beds, inline = false }: { editor: TopologyEditor; beds: readonly Bed[]; inline?: boolean }) {
  if (!editor.target) return null;
  return <EditorForm key={editor.instance} editor={editor} beds={beds} inline={inline} />;
}

function EditorForm({ editor, beds, inline }: { editor: TopologyEditor; beds: readonly Bed[]; inline: boolean }) {
  const target = editor.target!;
  const isRoom = target.kind === "room";
  const title = isRoom ? target.room ? "Edit room" : "Add room" : target.bed ? "Edit bed" : "Add beds";
  const existingLabels = beds.filter((bed) => target.kind !== "bed" || bed.bedId !== target.bed?.bedId).map((bed) => bed.label);
  const [count, setCount] = useState(() => editor.formDraft.current?.count ?? 1);
  const [labels, setLabels] = useState(() => editor.formDraft.current?.labels ?? (target.kind === "bed" && target.bed ? [target.bed.label] : createDefaultBedLabels(1, existingLabels)));
  const [customize, setCustomize] = useState(() => editor.formDraft.current?.customize ?? (target.kind === "bed" && Boolean(target.bed)));
  const [error, setError] = useState(() => editor.formDraft.current?.error ?? "");
  const [roomDraft, setRoomDraft] = useState(() => editor.formDraft.current?.roomDraft ?? { name: target.room?.name ?? "", buildingLabel: target.room?.buildingLabel ?? "", floorLabel: target.room?.floorLabel ?? "" });
  editor.formDraft.current = { count, labels, customize, error, roomDraft };
  const section = useRef<HTMLElement>(null);
  const heading = useId();
  const closeRef = useRef(editor.close);
  closeRef.current = editor.close;
  const close = useCallback(() => closeRef.current(), []);
  const frozen = editor.busy || Boolean(editor.mutation.error);
  const needsAuthentication = isInsufficientAuthenticationError(editor.mutation.error);
  const focusDraftIfNeeded = () => requestAnimationFrame(() => {
    if (document.activeElement === document.body) (section.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? section.current)?.focus();
  });
  useEffect(() => {
    const trigger = editor.opener.current;
    const fallback = section.current?.closest("[data-topology-region]")?.querySelector<HTMLElement>("h2");
    if (inline) {
      (section.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? section.current)?.focus({ preventScroll: true });
      // Reveal the selected identity and this one local task on entry. Ordinary
      // draft/currentness renders never repeat the entry scroll or change focus.
      const task = section.current?.closest<HTMLElement>("[data-topology-task]") ?? section.current;
      task?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
    return () => { requestAnimationFrame(() => {
      if (editor.opener.current !== trigger || document.activeElement !== document.body) return;
      const available = (node: HTMLElement | null | undefined) => Boolean(node?.isConnected && !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length);
      const destination = available(trigger) ? trigger : available(fallback) ? fallback : null;
      if (destination) { if (destination === fallback) destination.tabIndex = -1; destination.focus(); }
      editor.opener.current = null;
    }); };
  }, [inline, editor.opener]);
  useEffect(() => {
    if (document.activeElement !== document.body || editor.busy) return;
    const feedback = section.current?.querySelector<HTMLElement>('[role="alert"], [data-feedback-focus], [role="status"]');
    if (feedback) { feedback.tabIndex = -1; feedback.classList.add("focus:outline-2", "focus:outline-primary", "outline-offset-2"); feedback.focus(); }
    else (section.current?.querySelector<HTMLElement>('input[type="password"]:not(:disabled), input:not(:disabled)') ?? section.current)?.focus();
  }, [error, editor.mutation.error, editor.canSubmit, editor.busy]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor.canSubmit || frozen) return;
    if (isRoom) {
      const data = new FormData(event.currentTarget);
      const name = String(data.get("name") ?? "").trim();
      if (!name) { setError("Enter a room name or number."); return; }
      editor.save({ name, buildingLabel: String(data.get("buildingLabel") ?? ""), floorLabel: String(data.get("floorLabel") ?? "") });
    } else {
      const normalized = labels.map((label) => label.trim());
      if (normalized.some((label) => !label)) { setError("Every bed needs a label."); return; }
      const duplicate = duplicateBedLabel(normalized);
      if (duplicate) { setError(`Bed label ${duplicate} is used more than once.`); return; }
      const existing = normalized.find((label) => existingLabels.includes(label));
      if (existing) { setError(`A bed labeled ${existing} already exists in this room.`); return; }
      editor.save({ labels: normalized });
    }
  }
  const content = <section ref={section} tabIndex={-1} aria-labelledby={inline ? heading : undefined} data-topology-editor
    onFocusCapture={inline ? (event) => {
      const node = event.target;
      requestAnimationFrame(() => {
        if (!node.isConnected || node !== document.activeElement || node === section.current || !section.current?.contains(node)) return;
        const footer = document.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"]');
        if (!footer?.getClientRects().length) return;
        const bounds = node.getBoundingClientRect();
        const headerBottom = document.querySelector(".app-topbar")?.getBoundingClientRect().bottom ?? 0;
        if (bounds.bottom > footer.getBoundingClientRect().top - 12 || bounds.top < headerBottom + 12) node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      });
    } : undefined}
    className={inline ? "border-t border-base-300 bg-base-200/25 p-4 outline-offset-[-3px] sm:p-5" : "outline-offset-2"}>
    {inline && <h3 id={heading} className="mb-4 text-base font-semibold">{title}</h3>}
    <form onSubmit={submit} className="space-y-4">
      {isRoom ? <fieldset disabled={frozen} className="space-y-4">
        <TextInput label="Room name or number" name="name" value={roomDraft.name} onChange={(event) => { setRoomDraft({ ...roomDraft, name: event.target.value }); setError(""); }} required maxLength={128} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Building (optional)" name="buildingLabel" value={roomDraft.buildingLabel} onChange={(event) => setRoomDraft({ ...roomDraft, buildingLabel: event.target.value })} maxLength={128} />
          <TextInput label="Floor (optional)" name="floorLabel" value={roomDraft.floorLabel} onChange={(event) => setRoomDraft({ ...roomDraft, floorLabel: event.target.value })} maxLength={128} />
        </div>
      </fieldset> : <fieldset disabled={frozen} className="space-y-4">
        {!target.bed && <label className="block max-w-40"><span className="mb-1.5 block text-sm font-semibold">Number of beds</span>
          <input type="number" min={1} max={100} step={1} value={count} className="input input-bordered w-full" onChange={(event) => {
            const next = Math.max(1, Math.min(100, Math.trunc(Number(event.target.value)) || 1));
            setCount(next); setLabels((previous) => createDefaultBedLabels(next, existingLabels, previous)); setError("");
          }} />
        </label>}
        {!target.bed && <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="min-w-0 text-sm"><span className="font-semibold">Labels to create</span><br />
            <span className="break-words text-base-content/65">{labels.slice(0, 8).join(", ")}{labels.length > 8 ? `, +${labels.length - 8} more` : ""}</span></p>
          <button type="button" className="btn btn-sm btn-outline" aria-expanded={customize} onClick={() => setCustomize(!customize)}>{customize ? "Hide labels" : "Customize labels"}</button>
        </div>}
        {customize && <div className="grid max-h-72 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {labels.map((label, index) => <label key={index} className="block"><span className="mb-1.5 block text-xs font-semibold">{target.bed ? "Bed label" : `Bed ${index + 1}`}</span>
            <input className="input input-bordered w-full" value={label} required maxLength={128} onChange={(event) => { setLabels((previous) => previous.map((item, at) => at === index ? event.target.value : item)); setError(""); }} />
          </label>)}
        </div>}
      </fieldset>}
      {editor.conflict ? <div role="alert" className="space-y-2 text-sm">
        <p className="font-semibold">This {isRoom ? "room" : "room or bed"} was changed elsewhere.</p>
        <p>Your draft is kept. Refresh and review the current details before using a new version.</p>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => void editor.refresh()}>Refresh current details</button>
      </div> : editor.inputRejected ? <div data-feedback-focus className="space-y-2">
        <ErrorState error={editor.mutation.error} title="This change was not accepted" />
        <button type="button" className="btn btn-sm btn-outline" onClick={() => { editor.editRejectedDraft(); focusDraftIfNeeded(); }}>Edit draft</button>
      </div> : needsAuthentication ? null
        : editor.mutation.error ? <div data-feedback-focus className="space-y-3">
          <ErrorState error={editor.mutation.error} title={`Couldn't confirm ${isRoom ? "room" : "bed"} save`} />
          <p className="text-sm">The outcome may be unconfirmed. Retry sends the same request, without creating a second change.</p>
          <button type="button" className="btn btn-sm btn-outline" disabled={!editor.canRetry || editor.busy} onClick={editor.retry}>Retry same save</button>
        </div> : !editor.canSubmit && <div role="status" className="space-y-2 text-sm">
          <p>Current access or the exact room/bed details have changed or are unavailable. Your draft is kept; no other target will be used.</p>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => void editor.refresh()}>Refresh current details</button>
          <p>Review the current details before using a new version. A missing target cannot be replaced by another room or bed.</p>
        </div>}
      {!editor.canSubmit && !editor.busy && (!editor.mutation.error || editor.conflict) && editor.canUseCurrentVersion && <div className="space-y-2 border-l-2 border-primary pl-3 text-sm">
        <p className="font-semibold">Current saved details</p>
        <p>{editor.reviewTarget?.room ? `${editor.reviewTarget.room.name} · ${editor.reviewTarget.room.buildingLabel || "No building"} · ${editor.reviewTarget.room.floorLabel || "No floor"} · version ${editor.reviewTarget.room.version}` : `Property version ${editor.reviewTarget?.property.version}`}</p>
        {editor.reviewTarget?.kind === "bed" && editor.reviewTarget.bed && <p>Bed label: {editor.reviewTarget.bed.label}</p>}
        <button type="button" className="btn btn-sm btn-outline" onClick={() => { editor.useCurrentVersion(); focusDraftIfNeeded(); }}>Use current version and keep draft</button>
      </div>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-base-300 pt-4">
        <button type="button" className="btn btn-ghost" disabled={editor.busy} onClick={close}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!editor.canSubmit || frozen}>{editor.busy ? "Saving…" : isRoom ? target.room ? "Save room" : "Add room" : target.bed ? "Save bed" : labels.length === 1 ? "Add bed" : `Add ${labels.length} beds`}</button>
      </div>
    </form>
    {needsAuthentication && <div className="mt-4"><RecentAuthenticationPrompt error={editor.mutation.error} onAuthenticated={editor.retry} /></div>}
  </section>;
  return inline ? content : <Modal open title={title} onClose={close}>{content}</Modal>;
}

function TextInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold">{label}</span><input {...props} className="input input-bordered w-full" /></label>;
}

export function TopologyMutationNotice({ notice }: { notice: string }) {
  const element = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice && document.activeElement === document.body) element.current?.focus(); }, [notice]);
  return notice ? <p ref={element} role="status" tabIndex={-1} className="border-b border-base-300 px-4 py-3 text-sm focus:outline-2 focus:outline-primary outline-offset-[-3px]">{notice}</p> : null;
}
