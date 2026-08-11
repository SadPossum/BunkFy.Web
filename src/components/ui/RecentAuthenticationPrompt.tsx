import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSession } from "../../app/session";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { ErrorState } from "./primitives";

export function RecentAuthenticationPrompt({
  error,
  title = "Confirm your password to continue",
  description = "This sensitive action requires a recent sign-in.",
  submitLabel = "Confirm and retry",
  onAuthenticated,
}: {
  error: unknown;
  title?: string;
  description?: string;
  submitLabel?: string;
  onAuthenticated: () => void;
}) {
  const { stepUpWithPassword } = useSession();
  const [password, setPassword] = useState("");
  const [confirmationError, setConfirmationError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isInsufficientAuthenticationError(error)) return null;

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setConfirmationError(null);
    try {
      await stepUpWithPassword(password);
      setPassword("");
      onAuthenticated();
    } catch (nextError) {
      setConfirmationError(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      className="rounded-lg border border-warning/30 bg-warning/8 p-4"
      onSubmit={confirm}
    >
      <div className="flex items-start gap-3">
        <KeyRound size={18} className="mt-0.5 shrink-0 text-warning-content" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-base-content/55">{description}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="input input-bordered input-sm min-w-0 flex-1 bg-base-100"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              aria-label="Current password"
              required
              disabled={submitting}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!password || submitting}
            >
              {submitting && <span className="loading loading-spinner loading-xs" />}
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
      {confirmationError !== null && (
        <div className="mt-3"><ErrorState error={confirmationError} /></div>
      )}
    </form>
  );
}
