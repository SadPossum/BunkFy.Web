import { useMemo, useRef, useState, type FormEvent } from "react";
import type {
  DataRightsCorrectionExecutionDetails,
  GuestDataRightsCorrectionRequest,
  GuestProfile,
} from "../../api/types";
import { DatePicker } from "../../components/ui/DatePicker";
import { NationalityPicker } from "../guests/NationalityPicker";
import { LanguagePicker } from "../guests/LanguagePicker";
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
  editingDisabled = true,
  pending,
  error,
  onSubmit,
}: {
  profile: GuestProfile;
  execution: DataRightsCorrectionExecutionDetails;
  disabled: boolean;
  editingDisabled?: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (body: GuestDataRightsCorrectionRequest) => void;
}) {
  const initial = useMemo(() => guestCorrectionValues(profile), [profile]);
  const [values, setValues] = useState(initial);
  const recoveryHeading = useRef<HTMLDivElement>(null);
  const request = buildGuestCorrectionRequest(profile, execution, values);
  const changed = guestCorrectionChanged(profile, values);
  const fieldsDisabled = editingDisabled || pending;
  const submitDisabled = disabled || fieldsDisabled || !changed || !request.displayName;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled) return;
    onSubmit(request);
  }

  return (
    <form className="space-y-4 rounded-lg border border-base-300 p-4 sm:p-5" onSubmit={submit}>
      <div ref={recoveryHeading} tabIndex={-1} className="rounded outline-none focus:ring-2 focus:ring-primary"><CorrectionFormHeader
        title="Guest Record"
        revision={execution.subject.recordVersion}
      /></div>
      <CorrectionTextInput
        label="Display name"
        value={values.displayName}
        onChange={(displayName) => setValues((current) => ({ ...current, displayName }))}
        disabled={fieldsDisabled}
        required
        maxLength={256}
      />
      <CorrectionTextInput
        label="Legal name"
        value={values.legalName}
        onChange={(legalName) => setValues((current) => ({ ...current, legalName }))}
        disabled={fieldsDisabled}
        maxLength={256}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionTextInput
          label="Email"
          type="email"
          value={values.email}
          onChange={(email) => setValues((current) => ({ ...current, email }))}
          disabled={fieldsDisabled}
          maxLength={320}
        />
        <CorrectionTextInput
          label="Phone"
          type="tel"
          value={values.phone}
          onChange={(phone) => setValues((current) => ({ ...current, phone }))}
          disabled={fieldsDisabled}
          maxLength={64}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionPickerField label="Date of birth">
          <DatePicker
            className="w-full"
            value={values.dateOfBirth}
            onChange={(dateOfBirth) => setValues((current) => ({ ...current, dateOfBirth }))}
            ariaLabel="Date of birth"
            disabled={fieldsDisabled}
          />
        </CorrectionPickerField>
        <CorrectionPickerField label="Nationality (optional)">
          <NationalityPicker
            value={values.nationalityCountryCode}
            onChange={(nationalityCountryCode) => setValues((current) => ({ ...current, nationalityCountryCode }))}
            disabled={fieldsDisabled}
          />
        </CorrectionPickerField>
      </div>
      <LanguagePicker value={values.languageTags} onChange={languageTags => setValues(current => ({ ...current, languageTags }))}
        disabled={fieldsDisabled} onDisabledClose={() => recoveryHeading.current?.focus()} />
      <CorrectionTextArea
        label="Staff notes"
        value={values.notes}
        onChange={(notes) => setValues((current) => ({ ...current, notes }))}
        disabled={fieldsDisabled}
      />
      {Boolean(error) && <CorrectionError error={error} />}
      <CorrectionSubmit
        disabled={submitDisabled}
        pending={pending}
      />
    </form>
  );
}
