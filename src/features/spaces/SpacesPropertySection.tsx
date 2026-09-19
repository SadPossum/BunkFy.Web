import { useLayoutEffect, useState } from "react";
import type { SetURLSearchParams } from "react-router";
import type { Property } from "../../api/types";
import { compositeSourceCurrent, type CompositeSource } from "../../app/compositeSourceState";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import { StatusBadge } from "../../components/ui/primitives";
import { PropertyEditorForms } from "../properties/PropertyEditorForms";
import { PropertyProcessingPanel } from "../properties/PropertyProcessingPanel";
import { timeZoneLabel } from "../properties/propertyFormOptions";
import { propertyTimeZoneHealthCopy } from "../properties/propertyTimeZoneCatalog";
import { usePropertyEditor } from "../properties/usePropertyEditor";
import { usePropertyRetirementEditor } from "../properties/usePropertyRetirementEditor";
import { PropertyRetirementPanel } from "../properties/PropertyRetirementPanel";
import type { SpacesEditorNavigationState } from "./spacesSectionRoute";

export function SpacesPropertySection({ property, directorySource, permissionsCurrent, mayManageIdentity, mayManageTimeZone, refreshPermissions, onNavigationStateChange, routeInput, actionsDisabled = false }: {
  property: Property;
  directorySource: CompositeSource;
  permissionsCurrent: boolean;
  mayManageIdentity: boolean;
  mayManageTimeZone: boolean;
  refreshPermissions: () => Promise<unknown>;
  onNavigationStateChange?: (state: SpacesEditorNavigationState) => void;
  routeInput?: { params: URLSearchParams; setParams: SetURLSearchParams };
  actionsDisabled?: boolean;
}) {
  const propertyCurrent = compositeSourceCurrent(directorySource);
  const canUpdate = permissionsCurrent && propertyCurrent && mayManageIdentity && property.status === "active" && !actionsDisabled;
  const canUpdateTimeZone = permissionsCurrent && propertyCurrent && mayManageTimeZone && property.status === "active" && !actionsDisabled;
  const editor = usePropertyEditor({
    property, canUpdate, canUpdateTimeZone, permissionsCurrent,
    mayUpdate: mayManageIdentity, mayUpdateTimeZone: mayManageTimeZone,
  });
  const [processingEngaged, setProcessingEngaged] = useState(false);
  const [processingPending, setProcessingPending] = useState(false);
  const retirement = usePropertyRetirementEditor({ property, permissionsCurrent, propertyCurrent, mayManage: mayManageIdentity,
    routeInput,
    competingEditor: actionsDisabled || processingEngaged || editor.busy || Boolean(editor.propertyForm || editor.timeZoneTarget),
    refreshAuthority: () => Promise.all([refreshPermissions(), directorySource.refetch()]),
  });
  const retirementEngaged = Boolean(retirement.target) || retirement.busy || Boolean(retirement.confirmed);
  const engaged = processingEngaged || retirementEngaged || editor.busy || Boolean(editor.propertyForm || editor.timeZoneTarget);
  const pending = processingPending || retirement.busy || editor.busy;
  const authorityLost = (permissionsCurrent && ((!mayManageIdentity && Boolean(processingEngaged || retirementEngaged || editor.propertyForm))
    || (!mayManageTimeZone && Boolean(editor.timeZoneTarget))))
    || (propertyCurrent && property.status !== "active" && Boolean(processingEngaged || editor.propertyForm || editor.timeZoneTarget));
  const label = `${editor.timeZoneTarget ? "the time zone" : processingEngaged ? "processing settings" : retirementEngaged ? "property retirement" : "property details"} for ${property.name}`;
  useLayoutEffect(() => { onNavigationStateChange?.({ engaged, pending, label, authorityLost }); }, [authorityLost, engaged, label, onNavigationStateChange, pending]);
  const timeZoneHealth = propertyTimeZoneHealthCopy(property.timeZoneStatus);
  return <section className="overflow-hidden rounded-lg border border-base-300 bg-base-100" aria-labelledby="spaces-property-heading">
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
      <h2 id="spaces-property-heading" data-property-retirement-heading tabIndex={-1} className="text-base font-semibold outline-offset-2 focus:outline-2 focus:outline-primary">Property settings</h2>
      <StatusBadge status={property.status} />
    </div>
    <CompositeSourceNotice className="mx-4 mb-3 sm:mx-5" sources={[directorySource]} title="Property details are not current" />
    {editor.notice && <p role="status" className="border-t border-base-300 px-4 py-3 text-sm sm:px-5">{editor.notice}</p>}
    <div className="flex items-start justify-between gap-3 border-t border-base-300 px-4 py-3 sm:px-5">
      <dl className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PropertyFact label="Name" value={property.name} />
        <PropertyFact label="Short code" value={property.code} />
      </dl>
      {mayManageIdentity && property.status === "active" && <button type="button" className="btn btn-ghost btn-sm shrink-0"
        disabled={!canUpdate || editor.busy || Boolean(editor.propertyForm || editor.timeZoneTarget) || retirementEngaged || processingEngaged}
        aria-expanded={Boolean(editor.propertyForm)} onClick={(event) => editor.openPropertyForm({ property }, event.currentTarget)}>Edit details</button>}
    </div>
    <PropertyEditorForms editor={editor} inline kind="identity" />
    <div className="flex items-start justify-between gap-3 border-t border-base-300 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <dl><PropertyFact label="Time zone" value={timeZoneLabel(property.canonicalTimeZoneId || property.timeZoneId)} /></dl>
        {timeZoneHealth && <p className="mt-1 text-sm text-warning-content">{timeZoneHealth.label}. {timeZoneHealth.description}</p>}
      </div>
      {mayManageTimeZone && <button type="button" className="btn btn-ghost btn-sm shrink-0"
        disabled={!canUpdateTimeZone || editor.busy || Boolean(editor.timeZoneTarget || editor.propertyForm) || retirementEngaged || processingEngaged}
        aria-expanded={Boolean(editor.timeZoneTarget)} onClick={(event) => editor.openTimeZoneForm(property, event.currentTarget)}>Change</button>}
    </div>
    <PropertyEditorForms editor={editor} inline kind="timezone" />
    <PropertyProcessingPanel embedded property={property} canManage={mayManageIdentity}
      permissionsCurrent={permissionsCurrent} propertyCurrent={propertyCurrent}
      actionsDisabled={retirementEngaged || actionsDisabled || editor.busy || Boolean(editor.propertyForm || editor.timeZoneTarget)} onEngagementChange={setProcessingEngaged} onPendingChange={setProcessingPending}
      onChanged={editor.refreshProperty} />
    {(mayManageIdentity || property.status === "retired" || retirementEngaged) && <section aria-label="Property retirement" className="border-t border-base-300 px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold">Property retirement</h3>
      <p className="mt-1 text-xs leading-5 text-base-content/60">{property.status === "retired" ? "This property is retired. Stored configuration is retained; effective processing is suspended. Retirement is not deletion or reinstatement." : "Retirement suspends effective processing and retains stored configuration. Active rooms must be resolved first."}</p>
      {mayManageIdentity && property.status === "active" && !retirement.confirmed && <button type="button" className="btn btn-ghost btn-sm mt-2 text-error" disabled={!retirement.canOpen} aria-expanded={Boolean(retirement.target)} onClick={(event) => retirement.open(event.currentTarget)}>Retire property</button>}
      <PropertyRetirementPanel editor={retirement} inline />
    </section>}
  </section>;
}

function PropertyFact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-base-content/65">{label}</dt><dd className="mt-1 whitespace-normal break-words text-sm font-medium">{value}</dd></div>;
}
