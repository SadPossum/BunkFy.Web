import type { StaffProfileDraft } from "./staffOnboarding";

export function StaffProfileFields({
  value,
  onChange,
  compact = false,
}: {
  value: StaffProfileDraft;
  onChange: (value: StaffProfileDraft) => void;
  compact?: boolean;
}) {
  function update(field: keyof StaffProfileDraft, fieldValue: string) {
    onChange({ ...value, [field]: fieldValue });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileField label="Display name" value={value.displayName} onChange={(next) => update("displayName", next)} required autoComplete="name" />
        <ProfileField label="Legal name (optional)" value={value.legalName} onChange={(next) => update("legalName", next)} autoComplete="name" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileField label="Work email (optional)" type="email" value={value.workEmail} onChange={(next) => update("workEmail", next)} autoComplete="email" />
        <ProfileField label="Work phone (optional)" type="tel" value={value.workPhone} onChange={(next) => update("workPhone", next)} autoComplete="tel" />
      </div>
      {!compact && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileField label="Job title (optional)" value={value.jobTitle} onChange={(next) => update("jobTitle", next)} />
          <ProfileField label="Department (optional)" value={value.department} onChange={(next) => update("department", next)} />
        </div>
      )}
    </div>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        className="input input-bordered w-full bg-base-100"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoComplete={autoComplete}
        maxLength={type === "email" ? 320 : type === "tel" ? 64 : 256}
      />
    </label>
  );
}
