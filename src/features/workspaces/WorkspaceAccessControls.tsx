import { Building2, Check, Globe2, ShieldCheck } from "lucide-react";
import type { Property, WorkspaceAccessProfile } from "../../api/types";
import { SelectPicker } from "../../components/ui/SelectPicker";

export function AccessProfilePicker({
  profiles,
  value,
  onValueChange,
  label = "Role",
  disabled = false,
}: {
  profiles: WorkspaceAccessProfile[];
  value: string;
  onValueChange: (profileId: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className="form-control block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      <SelectPicker
        className="w-full"
        value={value}
        onValueChange={onValueChange}
        ariaLabel={label}
        placeholder="Choose a role"
        disabled={disabled}
        options={profiles.map((profile) => ({
          value: profile.profileId,
          label: profile.displayName,
          description: profile.description,
        }))}
      />
    </label>
  );
}

export function PropertyScopeField({
  properties,
  propertyIds,
  onChange,
  disabled = false,
}: {
  properties: Property[];
  propertyIds: string[];
  onChange: (propertyIds: string[]) => void;
  disabled?: boolean;
}) {
  const selectedMode = propertyIds.length > 0;

  function toggleProperty(propertyId: string) {
    if (propertyIds.includes(propertyId)) {
      if (propertyIds.length === 1) return;
      onChange(propertyIds.filter((id) => id !== propertyId));
      return;
    }

    onChange([...propertyIds, propertyId]);
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-semibold">Property access</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className={`flex min-h-20 items-start gap-3 rounded-lg border p-3 text-left transition ${
            !selectedMode
              ? "border-primary bg-primary/8 shadow-[inset_3px_0_0_var(--color-primary)]"
              : "border-base-300 bg-base-100 hover:border-primary/35"
          }`}
          onClick={() => onChange([])}
        >
          <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${!selectedMode ? "bg-primary text-white" : "bg-base-200 text-base-content/55"}`}>
            <Globe2 size={16} />
          </span>
          <span>
            <span className="block text-sm font-semibold">All properties</span>
            <span className="mt-0.5 block text-xs leading-5 text-base-content/50">Include current and future properties.</span>
          </span>
        </button>
        <button
          type="button"
          className={`flex min-h-20 items-start gap-3 rounded-lg border p-3 text-left transition ${
            selectedMode
              ? "border-primary bg-primary/8 shadow-[inset_3px_0_0_var(--color-primary)]"
              : "border-base-300 bg-base-100 hover:border-primary/35"
          }`}
          onClick={() => onChange(properties[0] ? [properties[0].propertyId] : [])}
          disabled={!properties.length}
        >
          <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${selectedMode ? "bg-primary text-white" : "bg-base-200 text-base-content/55"}`}>
            <Building2 size={16} />
          </span>
          <span>
            <span className="block text-sm font-semibold">Selected properties</span>
            <span className="mt-0.5 block text-xs leading-5 text-base-content/50">Limit access to specific locations.</span>
          </span>
        </button>
      </div>

      {selectedMode && (
        <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-2">
          {properties.map((property) => {
            const checked = propertyIds.includes(property.propertyId);
            return (
              <label key={property.propertyId} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-base-200">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary checkbox-sm"
                  checked={checked}
                  disabled={checked && propertyIds.length === 1}
                  onChange={() => toggleProperty(property.propertyId)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{property.name}</span>
                  <span className="block truncate text-xs text-base-content/45">{property.code}</span>
                </span>
                {checked && <Check size={15} className="shrink-0 text-primary" />}
              </label>
            );
          })}
        </div>
      )}

      <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-base-content/50">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
        The selected role is applied at this scope. Owner access is managed separately.
      </p>
    </fieldset>
  );
}
