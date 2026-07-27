import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState } from "../../components/ui/primitives";
import { correctionErrorMessage } from "./dataRightsCorrectionWorkflow";

export function CorrectionFormHeader({
  title,
  revision,
  detail,
}: {
  title: string;
  revision: number;
  detail?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-4">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs text-base-content/50">
          Change only fields covered by this approved correction.
        </p>
      </div>
      <p className="text-xs text-base-content/45">
        Record version {revision}{detail ? ` - ${detail}` : ""}
      </p>
    </div>
  );
}

export function CorrectionTextInput({
  label,
  value,
  onChange,
  disabled,
  required = false,
  type = "text",
  maxLength,
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
  type?: string;
  maxLength?: number;
  min?: number;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <input
        className="input input-bordered w-full"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
        maxLength={maxLength}
        min={min}
      />
    </label>
  );
}

export function CorrectionTextArea({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      <textarea
        className="textarea textarea-bordered min-h-24 w-full"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        maxLength={4000}
      />
    </label>
  );
}

export function CorrectionPickerField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="form-control block">
      <span className="label-text mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}

export function CorrectionSubmit({
  disabled,
  pending,
}: {
  disabled: boolean;
  pending: boolean;
}) {
  return (
    <div className="flex justify-end border-t border-base-300 pt-4">
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={disabled || pending}
      >
        {pending
          ? <span className="loading loading-spinner loading-xs" />
          : <CheckCircle2 size={15} />}
        Apply correction
      </button>
    </div>
  );
}

export function CorrectionError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <ErrorState
      title="Correction unavailable"
      error={new Error(correctionErrorMessage(error))}
      retry={retry}
    />
  );
}
