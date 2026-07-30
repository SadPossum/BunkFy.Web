import { useMemo, useState, type FormEvent } from "react";
import type {
  DataRightsCorrectionExecutionDetails,
  WorkspaceStaffOnboardingDataRightsCorrectionRequest,
  WorkspaceStaffOnboardingDataRightsCorrectionTarget,
} from "../../api/types";
import {
  CorrectionError,
  CorrectionFormHeader,
  CorrectionSubmit,
  CorrectionTextInput,
} from "./CorrectionFormFields";
import {
  buildWorkspaceStaffOnboardingCorrectionRequest,
  workspaceStaffOnboardingCorrectionChanged,
  workspaceStaffOnboardingCorrectionValues,
} from "./dataRightsCorrectionWorkflow";

export function WorkspaceStaffOnboardingCorrectionForm({
  target,
  execution,
  disabled,
  pending,
  error,
  onSubmit,
}: {
  target: WorkspaceStaffOnboardingDataRightsCorrectionTarget;
  execution: DataRightsCorrectionExecutionDetails;
  disabled: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (
    body: WorkspaceStaffOnboardingDataRightsCorrectionRequest,
  ) => void;
}) {
  const initial = useMemo(
    () => workspaceStaffOnboardingCorrectionValues(target),
    [target],
  );
  const [values, setValues] = useState(initial);
  const request = buildWorkspaceStaffOnboardingCorrectionRequest(
    target,
    execution,
    values,
  );
  const changed = workspaceStaffOnboardingCorrectionChanged(target, values);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(request);
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-base-300 p-4 sm:p-5"
      onSubmit={submit}
    >
      <CorrectionFormHeader
        title="Staff enrollment profile"
        revision={execution.subject.recordVersion}
        detail="Editable until workspace review begins"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionTextInput
          label="Display name"
          value={values.displayName}
          onChange={(displayName) =>
            setValues((current) => ({ ...current, displayName }))}
          disabled={disabled}
          required
          maxLength={256}
        />
        <CorrectionTextInput
          label="Legal name"
          value={values.legalName}
          onChange={(legalName) =>
            setValues((current) => ({ ...current, legalName }))}
          disabled={disabled}
          maxLength={256}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CorrectionTextInput
          label="Work email"
          type="email"
          value={values.workEmail}
          onChange={(workEmail) =>
            setValues((current) => ({ ...current, workEmail }))}
          disabled={disabled}
          maxLength={320}
        />
        <CorrectionTextInput
          label="Work phone"
          type="tel"
          value={values.workPhone}
          onChange={(workPhone) =>
            setValues((current) => ({ ...current, workPhone }))}
          disabled={disabled}
          maxLength={64}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <CorrectionTextInput
          label="Employee number"
          value={values.employeeNumber}
          onChange={(employeeNumber) =>
            setValues((current) => ({ ...current, employeeNumber }))}
          disabled={disabled}
          maxLength={64}
        />
        <CorrectionTextInput
          label="Job title"
          value={values.jobTitle}
          onChange={(jobTitle) =>
            setValues((current) => ({ ...current, jobTitle }))}
          disabled={disabled}
          maxLength={128}
        />
        <CorrectionTextInput
          label="Department"
          value={values.department}
          onChange={(department) =>
            setValues((current) => ({ ...current, department }))}
          disabled={disabled}
          maxLength={128}
        />
      </div>
      {Boolean(error) && <CorrectionError error={error} />}
      <CorrectionSubmit
        disabled={disabled || !changed || !request.displayName}
        pending={pending}
      />
    </form>
  );
}
