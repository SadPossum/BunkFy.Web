import { Globe2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import type { Property } from "../../api/types";
import { SelectPicker } from "../../components/ui/SelectPicker";
import { ErrorState, FormActions, ModalActions } from "../../components/ui/primitives";
import { PropertyEditorFrame } from "./PropertyEditorFrame";
import { PropertyConflictNotice } from "./PropertyConflictNotice";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import {
  timeZoneLabel,
} from "./propertyFormOptions";
import {
  initialPropertyTimeZoneTarget,
  propertyTimeZoneRequiresConfirmation,
  withStoredTimeZoneOption,
  type PropertyTimeZoneCatalogState,
} from "./propertyTimeZoneCatalog";

export function PropertyTimeZoneModal({
  inline = false,
  opener,
  property,
  catalog,
  authorityCurrent,
  conflict,
  onRefresh,
  pending,
  error,
  authenticationPrompt,
  onSubmit,
  onClose,
}: {
  inline?: boolean;
  opener?: RefObject<HTMLElement | null>;
  property: Property | null;
  catalog: PropertyTimeZoneCatalogState;
  authorityCurrent: boolean;
  conflict: boolean;
  onRefresh: () => unknown;
  pending: boolean;
  error: unknown;
  authenticationPrompt: ReactNode;
  onSubmit: (timeZoneId: string, confirmed: boolean) => void;
  onClose: () => void;
}) {
  const [timeZoneId, setTimeZoneId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const options = useMemo(() => {
    if (!property) return [];
    return withStoredTimeZoneOption(catalog.options, property);
  }, [catalog.options, property]);

  useEffect(() => {
    setTimeZoneId(property ? initialPropertyTimeZoneTarget(property) : "");
    setConfirmed(false);
  }, [property]);

  const selectedTimeZoneId = timeZoneId || (
    property ? initialPropertyTimeZoneTarget(property) : ""
  );
  const changed = Boolean(
    property && selectedTimeZoneId && selectedTimeZoneId !== property.timeZoneId,
  );
  const requiresConfirmation = Boolean(
    property && propertyTimeZoneRequiresConfirmation(property, selectedTimeZoneId),
  );
  const selectionCurrent = catalog.current && catalog.isSelectable(selectedTimeZoneId);
  const canSubmit = authorityCurrent && changed && selectionCurrent && (
    !requiresConfirmation || confirmed
  );

  return (
    <PropertyEditorFrame
      inline={inline}
      opener={opener}
      feedback={error}
      open={Boolean(property)}
      title="Change property time zone"
      description={property ? `Set the local time used by ${property.name}.` : undefined}
      onClose={onClose}
    >
      {property && (authenticationPrompt ? (
        <div className="space-y-4">
          {authenticationPrompt}
          <ModalActions>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </ModalActions>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !pending) {
              onSubmit(selectedTimeZoneId, requiresConfirmation ? confirmed : false);
            }
          }}
        >
          {conflict && <PropertyConflictNotice onRefresh={onRefresh} pending={pending} actionLabel="Change" />}
          <CompositeSourceNotice
            className=""
            sources={[catalog.source]}
            title="The canonical time-zone catalogue is delayed"
          />
          <p className="text-sm leading-5 text-base-content/65">
                  {property.timeZoneStatus === "alias"
                    ? "Canonicalizing this alias keeps the same local-time rules."
                    : "Reservation times, reminders, and operational deadlines depend on this setting."}
          </p>

          <div className="form-control block">
            <span className="label-text mb-1.5 block text-sm font-semibold">Time zone</span>
            <SelectPicker
              className="w-full"
              value={selectedTimeZoneId}
              onValueChange={(value) => {
                setTimeZoneId(value);
                setConfirmed(false);
              }}
              ariaLabel="Property time zone"
              options={options}
              disabled={!catalog.current || pending}
              placeholder={catalog.source.state === "loading" ? "Loading time zones" : "Choose time zone"}
            />
          </div>

          {requiresConfirmation ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-primary/25 bg-primary/5 p-4 transition">
              <input
                type="checkbox"
                className="checkbox checkbox-primary checkbox-sm mt-0.5"
                checked={confirmed}
                disabled={pending}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span className="text-sm leading-5">
                <span className="inline-flex items-center gap-1.5 font-semibold"><Globe2 size={15} />Confirm local time zone</span>
                <span className="mt-1 block text-xs text-base-content/55">{timeZoneLabel(selectedTimeZoneId)} is the property's actual local time zone.</span>
              </span>
            </label>
          ) : changed ? (
            <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success/10 p-4 text-sm">
              <Globe2 size={16} className="mt-0.5 shrink-0 text-success" />
              <p><span className="font-semibold">Local-time rules stay the same.</span> The stored identifier will become {timeZoneLabel(selectedTimeZoneId)}.</p>
            </div>
          ) : null}

          {!authorityCurrent && !pending && !conflict && (
            <p className="text-sm text-warning-content">Refresh property access, current property data, and the canonical catalogue before changing the time zone.</p>
          )}
          {error != null && !conflict && <ErrorState error={error} title="Couldn't change the time zone" />}
          <FormActions
            submitting={pending}
            cancelDisabled={pending}
            disabled={!canSubmit}
            submitLabel={changed && !requiresConfirmation ? "Use canonical time zone" : "Change time zone"}
            onCancel={onClose}
          />
        </form>
      ))}
    </PropertyEditorFrame>
  );
}
