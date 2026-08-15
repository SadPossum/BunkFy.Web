import { AlertTriangle, RotateCcw } from "lucide-react";
import { isInsufficientAuthenticationError } from "../../app/authenticationAssurance";
import { RecentAuthenticationPrompt } from "../../components/ui/RecentAuthenticationPrompt";
import { ErrorState, Modal, ModalActions } from "../../components/ui/primitives";
import { humanizeRetentionKey } from "./retentionHealth";
import type { RetentionRetryIntent } from "./retentionRetryAttempt";

export function RetentionRetryModal({
  intent,
  current,
  error,
  submitting,
  onClose,
  onConfirm,
  onRefresh,
}: {
  intent: RetentionRetryIntent | null;
  current: boolean;
  error: unknown;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (intent: RetentionRetryIntent) => void;
  onRefresh: () => void;
}) {
  const needsAuthentication = isInsufficientAuthenticationError(error);

  return (
    <Modal
      open={Boolean(intent)}
      title="Retry failed retention run?"
      description="Review the exact failed evidence before scheduling another attempt."
      onClose={onClose}
    >
      {intent && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/8 p-4">
            <AlertTriangle className="mt-0.5 shrink-0 text-warning-content" size={19} />
            <div>
              <p className="text-sm font-semibold">This may delete or redact eligible records</p>
              <p className="mt-1 text-xs leading-5 text-base-content/60">
                BunkFy will retry only the failed run shown below, using the same owner,
                scope, policy, and evidence version. Current holds and safeguards still apply.
              </p>
            </div>
          </div>

          <dl className="grid gap-x-5 gap-y-4 border-y border-base-300 py-4 text-sm sm:grid-cols-2">
            <EvidenceFact label="Data class" value={humanizeRetentionKey(intent.dataClassKey)} />
            <EvidenceFact label="Owner" value={humanizeRetentionKey(intent.ownerKey)} />
            <EvidenceFact label="Scope" value={intent.propertyId
              ? `Property ${intent.propertyId.slice(0, 8).toUpperCase()}`
              : "Workspace"} />
            <EvidenceFact label="Policy" value={`Version ${intent.executionPolicyVersion}`} />
            <EvidenceFact label="Failed run" value={shortReference(intent.runId)} mono />
            <EvidenceFact label="Evidence" value={intent.evidenceAtUtc
              ? `${formatDateTime(intent.evidenceAtUtc)} · v${intent.evidenceVersion}`
              : `Version ${intent.evidenceVersion}`} />
          </dl>

          {!current && (
            <div className="alert border border-warning/25 bg-warning/8 text-base-content">
              <AlertTriangle size={18} className="text-warning-content" />
              <div>
                <p className="font-semibold">This schedule changed</p>
                <p className="text-sm text-base-content/60">
                  Refresh the latest evidence before deciding whether another retry is needed.
                </p>
              </div>
            </div>
          )}

          {needsAuthentication && (
            <RecentAuthenticationPrompt
              error={error}
              title="Confirm your password to retry this run"
              description="Retention recovery requires a recent sign-in. The same run and evidence version will be retried after confirmation."
              submitLabel="Confirm and retry"
              onAuthenticated={() => onConfirm(intent)}
            />
          )}

          {Boolean(error) && !needsAuthentication && current && (
            <ErrorState
              error={error}
              title="The retry was not accepted"
              retry={onRefresh}
            />
          )}

          <ModalActions>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            {!current ? (
              <button type="button" className="btn btn-outline" onClick={onRefresh}>
                Refresh status
              </button>
            ) : !needsAuthentication ? (
              <button
                type="button"
                className="btn btn-primary min-w-32 text-white"
                disabled={submitting}
                onClick={() => onConfirm(intent)}
              >
                {submitting
                  ? <span className="loading loading-spinner loading-sm" />
                  : <RotateCcw size={16} />}
                Retry run
              </button>
            ) : null}
          </ModalActions>
        </div>
      )}
    </Modal>
  );
}

function EvidenceFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold text-base-content/45">{label}</dt>
      <dd className={`mt-1 text-base-content/80 ${mono ? "font-mono" : "font-medium"}`}>
        {value}
      </dd>
    </div>
  );
}

function shortReference(value: string): string {
  return value.slice(0, 8).toUpperCase();
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
