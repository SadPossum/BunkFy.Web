import { useState, type FormEvent } from "react";
import type {
  MultiFactorChallenge,
  MultiFactorCodeType,
} from "../../api/types";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { preferredMultiFactorCodeType } from "./authenticationFlow";

export function MultiFactorChallengeForm({
  challenge,
  error,
  submitting,
  submitLabel = "Verify and sign in",
  onSubmit,
  onCancel,
}: {
  challenge: MultiFactorChallenge;
  error: string;
  submitting: boolean;
  submitLabel?: string;
  onSubmit: (codeType: MultiFactorCodeType, code: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [codeType, setCodeType] = useState<MultiFactorCodeType | null>(
    () => preferredMultiFactorCodeType(challenge),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!codeType) return;
    const code = String(
      new FormData(event.currentTarget).get("code") ?? "",
    ).trim();
    await onSubmit(codeType, code);
  }

  if (!codeType) {
    return (
      <div className="mt-8">
        <div className="alert alert-error py-3 text-sm">
          <span>No verification method is available for this account.</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost mt-4 h-11 w-full"
          onClick={onCancel}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={(event) => void submit(event)}>
      {challenge.availableCodeTypes.length > 1 && (
        <SegmentedTabs
          value={codeType}
          ariaLabel="Verification code type"
          stretch
          onValueChange={(value) =>
            setCodeType(value as MultiFactorCodeType)
          }
          options={challenge.availableCodeTypes.map((value) => ({
            value,
            label:
              value === "totp"
                ? "Authenticator code"
                : "Recovery code",
          }))}
        />
      )}
      <label className="form-control block">
        <span className="label-text mb-1.5 block text-sm font-semibold">
          {codeType === "totp" ? "Authenticator code" : "Recovery code"}
        </span>
        <input
          name="code"
          className="input input-bordered h-12 w-full bg-base-100 font-mono"
          inputMode={codeType === "totp" ? "numeric" : "text"}
          autoComplete="one-time-code"
          autoFocus
          required
        />
      </label>
      <p className="text-xs text-base-content/45">
        This challenge expires{" "}
        {new Date(challenge.expiresAtUtc).toLocaleTimeString()}.
      </p>
      {error && (
        <div className="alert alert-error py-3 text-sm">
          <span>{error}</span>
        </div>
      )}
      <button
        className="btn btn-primary h-12 w-full text-base text-white"
        disabled={submitting}
      >
        {submitting && <span className="loading loading-spinner loading-sm" />}
        {submitLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost h-11 w-full"
        disabled={submitting}
        onClick={onCancel}
      >
        Back to sign in
      </button>
    </form>
  );
}
