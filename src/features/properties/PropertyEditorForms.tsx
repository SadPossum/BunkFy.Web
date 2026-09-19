import { useEffect, useState, type FormEvent } from "react";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { ErrorState, FormActions } from "../../components/ui/primitives";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { OwnerOriginLink } from "../spaces/OwnerOriginLink";
import { PropertyEditorFrame } from "./PropertyEditorFrame";
import { PropertyConflictNotice } from "./PropertyConflictNotice";
import { PropertyTimeZoneModal } from "./PropertyTimeZoneModal";
import type { usePropertyEditor } from "./usePropertyEditor";

export function PropertyEditorForms({ editor, inline = false, kind = "all" }: {
  editor: ReturnType<typeof usePropertyEditor>;
  inline?: boolean;
  kind?: "all" | "identity" | "timezone";
}) {
  const { propertyForm, propertyMutation, catalog, timeZoneMutation } = editor;
  const editing = Boolean(propertyForm?.property);
  const [timeZoneId, setTimeZoneId] = useState("");
  useEffect(() => setTimeZoneId(""), [propertyForm]);
  const propertyCanSubmit = editor.propertyFormCanSubmit
    && (editing || (catalog.current && catalog.isSelectable(timeZoneId)));
  const identityNeedsAuthentication = !editor.propertyFormRetired && isInsufficientAuthenticationError(propertyMutation.error);
  const timeZoneNeedsAuthentication = isInsufficientAuthenticationError(timeZoneMutation.error);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!propertyCanSubmit || propertyMutation.isPending) return;
    const data = new FormData(event.currentTarget);
    editor.saveProperty({
      property: propertyForm?.property,
      name: String(data.get("name")).trim(),
      code: String(data.get("code")).trim().toUpperCase(),
      timeZoneId: propertyForm?.property?.timeZoneId ?? timeZoneId,
    });
  }

  return <>
    {kind !== "timezone" && <PropertyEditorFrame
      open={Boolean(propertyForm)}
      inline={inline}
      opener={editor.propertyOpener}
      feedback={propertyMutation.error}
      title={editing ? "Edit property details" : "New property"}
      description={editing ? (editor.propertyFormRetired ? "This property's saved identity is read-only." : "Update the property name and short code.") : "Property details are shared across rooms, inventory and reservations."}
      onClose={editor.closePropertyForm}
    >
      {!inline && <OwnerOriginLink className="mb-3" />}
      {identityNeedsAuthentication ? <div className="space-y-3">
        <RecentAuthenticationPrompt error={propertyMutation.error} onAuthenticated={editor.retryProperty} />
        <button type="button" className="btn btn-ghost" onClick={editor.closePropertyForm}>Cancel</button>
      </div> : <form onSubmit={submit} className="space-y-4">
        {editor.propertyFormRetired && <p role="status" className="text-sm text-warning-content">This property was retired. Your draft is kept here for reference; it cannot be saved.</p>}
        {!editor.propertyFormRetired && editor.propertyConflict && <PropertyConflictNotice onRefresh={editor.refreshProperty} pending={propertyMutation.isPending} />}
        {!editor.propertyFormRetired && !editor.propertyFormCanSubmit && !propertyMutation.isPending && !editor.propertyConflict && <div role="status" className="text-sm text-warning-content">
          <p>Property details or access changed. Refresh, then cancel and reopen Edit to use the current version.</p>
          <button type="button" className="btn btn-ghost btn-sm" disabled={propertyMutation.isPending} onClick={() => void editor.refreshProperty()}>Refresh property</button>
        </div>}
        {!editing && <CompositeSourceNotice className="" sources={[catalog.source]} title="Time zones are temporarily unavailable" />}
        <fieldset disabled={propertyMutation.isPending} className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(6rem,1fr)]">
          <label className="form-control block">
            <span className="mb-1.5 block text-sm font-semibold">Property name</span>
            <input className="input input-bordered w-full" name="name" defaultValue={propertyForm?.property?.name} readOnly={editor.propertyFormRetired} placeholder="Harbour House Hostel" required />
          </label>
          <label className="form-control block">
            <span className="mb-1.5 block text-sm font-semibold">Short code</span>
            <input className="input input-bordered w-full" name="code" defaultValue={propertyForm?.property?.code} readOnly={editor.propertyFormRetired} placeholder="HBR" maxLength={16} required />
          </label>
          {!editing && <div className="sm:col-span-2">
            <span className="mb-1.5 block text-sm font-semibold">Time zone</span>
            <SelectPicker className="w-full" value={timeZoneId} onValueChange={setTimeZoneId} ariaLabel="Time zone"
              options={catalog.options} disabled={!catalog.current || propertyMutation.isPending}
              placeholder={catalog.source.state === "loading" ? "Loading time zones" : "Choose time zone"} />
          </div>}
        </fieldset>
        {propertyMutation.error && !editor.propertyFormRetired && !editor.propertyConflict && <ErrorState error={propertyMutation.error} title="Couldn't save the property" />}
        <FormActions submitting={propertyMutation.isPending} cancelDisabled={propertyMutation.isPending} disabled={!propertyCanSubmit}
          submitLabel={editing ? "Save changes" : "Create property"} onCancel={editor.closePropertyForm} />
      </form>}
    </PropertyEditorFrame>}
    {kind !== "identity" && <PropertyTimeZoneModal
      inline={inline}
      opener={editor.timeZoneOpener}
      property={editor.timeZoneTarget}
      catalog={catalog}
      authorityCurrent={editor.timeZoneCanSubmit}
      conflict={editor.timeZoneConflict}
      onRefresh={editor.refreshTimeZone}
      pending={timeZoneMutation.isPending}
      error={timeZoneMutation.error}
      authenticationPrompt={timeZoneNeedsAuthentication ? <RecentAuthenticationPrompt
        error={timeZoneMutation.error} title="Confirm your password to change the property time zone"
        description="Time-zone changes affect reservation timing, reminders, and operational deadlines."
        onAuthenticated={editor.retryTimeZone} /> : null}
      onSubmit={editor.saveTimeZone}
      onClose={editor.closeTimeZoneForm}
    />}
  </>;
}
