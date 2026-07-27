import { useMemo, useState, type FormEvent } from "react";
import type {
  DataRightsCorrectionExecutionDetails,
  GuestDataRightsCorrectionRequest,
  GuestProfile,
} from "../../api/types";
import { DatePicker } from "../../components/ui/DatePicker";
import {
  CorrectionError,
  CorrectionFormHeader,
  CorrectionPickerField,
  CorrectionSubmit,
  CorrectionTextArea,
  CorrectionTextInput,
} from "./CorrectionFormFields";
import {
  buildGuestCorrectionRequest,
  guestCorrectionChanged,
  guestCorrectionValues,
} from "./dataRightsCorrectionWorkflow";

export function GuestCorrectionForm({
  profile,
  execution,
  disabled,
  pending,
  error,
  onSubmit,
}: {
  profile: GuestProfile;
  execution: DataRightsCorrectionExecutionDetails;
  disabled: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (body: GuestDataRightsCorrectionRequest) => void;
}) {
  const initial = useMemo(() => guestCorrectionValues(profile), [profile]);
  const [values, setValues] = useState(initial);
  const request = buildGuestCorrectionRequest(profile, execution, values);
  const changed = guestCorrectionChanged(profile, values);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(request);
  }

  return (
    <form className="space-y-4 rounded-lg border border-base-300 p-4 sm:p-5" onSubmit={submit}>
      <CorrectionFormHeader
        title="Guest Record"
        revision={execution.subject.recordVersion}
      />
      <CorrectionTextInput
        label="Display name"
        value={values.displayName}
        onChange={(displayName) => setValues((current) => ({ ...current, displayName }))}
        disabled={disabled}
        required
        maxLength={256}
      />
      <CorrectionTextInput
        label="Legal name"
        value={values.legalName}
        onChange={(legalName) => setValues((current) => ({ ...current, legalName }))}
        disabled={disabled}
        maxLength={256}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionTextInput
          label="Email"
          type="email"
          value={values.email}
          onChange={(email) => setValues((current) => ({ ...current, email }))}
          disabled={disabled}
          maxLength={320}
        />
        <CorrectionTextInput
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={(phone) => setValues((current) => ({ ...current, phone }))}
          disabled={disabled}
          maxLength={64}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <CorrectionPickerField label="Date of birth">
          <DatePicker
            className="w-full"
            value={values.dateOfBirth}
            onChange={(dateOfBirth) => setValues((current) => ({ ...current, dateOfBirth }))}
            ariaLabel="Date of birth"
            disabled={disabled}
          />
        </CorrectionPickerField>
        <CorrectionTextInput
          label="Nationality"
          value={values.nationalityCountryCode}
          onChange={(nationalityCountryCode) =>
            setValues((current) => ({ ...current, nationalityCountryCode }))}
          disabled={disabled}
          maxLength={2}
        />
        <CorrectionTextInput
          label="Language"
          value={values.preferredLanguageTag}
          onChange={(preferredLanguageTag) =>
            setValues((current) => ({ ...current, preferredLanguageTag }))}
          disabled={disabled}
          maxLength={35}
        />
      </div>
      <CorrectionTextArea
        label="Staff notes"
        value={values.notes}
        onChange={(notes) => setValues((current) => ({ ...current, notes }))}
        disabled={disabled}
      />
      {Boolean(error) && <CorrectionError error={error} />}
      <CorrectionSubmit
        disabled={disabled || !changed || !request.displayName}
        pending={pending}
      />
    </form>
  );
}
