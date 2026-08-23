import type { FormEvent } from "react";
import type { StaffMember } from "../../api/types";
import type { CompositeSource } from "../../app/compositeSourceState";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";
import {
  ErrorState,
  FormActions,
  InlineFormActions,
} from "../../components/ui/primitives";
import type { StaffCreatePayload } from "./staffCreateAttempt";
import { StaffAuthorityNotice } from "./StaffAuthorityNotice";

export function StaffProfileForm({
  member,
  submitting,
  error,
  submitLabel,
  sources,
  authorityCurrent,
  authorityMessage,
  onCancel,
  onSubmit,
}: {
  member?: StaffMember;
  submitting: boolean;
  error: unknown;
  submitLabel: string;
  sources: CompositeSource[];
  authorityCurrent: boolean;
  authorityMessage: string;
  onCancel: () => void;
  onSubmit: (payload: StaffCreatePayload) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorityCurrent) return;
    const data = new FormData(event.currentTarget);
    onSubmit({
      displayName: String(data.get("displayName") ?? "").trim(),
      legalName: emptyToNull(data.get("legalName")),
      workEmail: emptyToNull(data.get("workEmail")),
      workPhone: emptyToNull(data.get("workPhone")),
      employeeNumber: emptyToNull(data.get("employeeNumber")),
      jobTitle: emptyToNull(data.get("jobTitle")),
      department: emptyToNull(data.get("department")),
    });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <CompositeSourceNotice
        className="mb-0"
        sources={sources}
        title="Staff command context is delayed"
      />
      {!authorityCurrent && <StaffAuthorityNotice message={authorityMessage} />}
      <fieldset disabled={!authorityCurrent || submitting} className="space-y-4">
        <TextField
          label="Display name"
          name="displayName"
          defaultValue={member?.displayName}
          maxLength={256}
        />
        <TextField
          label="Legal name (optional)"
          name="legalName"
          defaultValue={member?.legalName || ""}
          required={false}
          maxLength={256}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Work email"
            name="workEmail"
            type="email"
            defaultValue={member?.workEmail || ""}
            required={false}
            maxLength={320}
          />
          <TextField
            label="Work phone"
            name="workPhone"
            type="tel"
            defaultValue={member?.workPhone || ""}
            required={false}
            maxLength={64}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Employee number"
            name="employeeNumber"
            defaultValue={member?.employeeNumber || ""}
            required={false}
            maxLength={64}
          />
          <TextField
            label="Job title"
            name="jobTitle"
            defaultValue={member?.jobTitle || ""}
            required={false}
            maxLength={128}
          />
        </div>
        <TextField
          label="Department"
          name="department"
          defaultValue={member?.department || ""}
          required={false}
          maxLength={128}
        />
      </fieldset>
      {Boolean(error) && <ErrorState error={error} />}
      {member ? (
        <InlineFormActions>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={submitting || !authorityCurrent}
          >
            {submitting && <span className="loading loading-spinner loading-xs" />}
            {submitLabel}
          </button>
        </InlineFormActions>
      ) : (
        <FormActions
          submitting={submitting}
          disabled={!authorityCurrent}
          submitLabel={submitLabel}
          onCancel={onCancel}
        />
      )}
    </form>
  );
}

function TextField({
  label,
  name,
  type = "text",
  defaultValue,
  required = true,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        className="input input-bordered w-full"
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
