import { AlertTriangle, Route, Search, ShieldCheck, UserCheck } from "lucide-react";
import type { DataRightsDecisionReason } from "../../api/types";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  dataRightsDecisionReasonLabel,
  type DataRightsAction,
} from "./dataRightsWorkflow";

export type PrivacyRequestConfirmation =
  | "reject-verification"
  | "approve"
  | "deny"
  | "execute"
  | "cancel";

export function PrivacyRequestActions({
  actions,
  confirmation,
  denialReason,
  destructiveConfirmation,
  pending,
  onConfirmationChange,
  onDenialReasonChange,
  onDestructiveConfirmationChange,
  onPerform,
  onExecute,
}: {
  actions: DataRightsAction[];
  confirmation: PrivacyRequestConfirmation | null;
  denialReason: string;
  destructiveConfirmation: string;
  pending: boolean;
  onConfirmationChange: (value: PrivacyRequestConfirmation | null) => void;
  onDenialReasonChange: (value: string) => void;
  onDestructiveConfirmationChange: (value: string) => void;
  onPerform: (suffix: string, body?: Record<string, unknown>) => void;
  onExecute: () => void;
}) {
  if (actions.length === 0) {
    return (
      <section className="border-t border-base-300 pt-5">
        <p className="text-sm text-base-content/55">
          No further action is available for this request with your current access.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-base-300 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Next action</h3>
          <p className="mt-1 text-sm text-base-content/55">
            BunkFy accepts only actions valid for the latest server version.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {actions.includes("verify-requester") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onPerform("/requester-verification", { verified: true })}
            >
              <UserCheck size={15} />
              Identity verified
            </button>
          )}
          {actions.includes("reject-verification") && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={pending}
              onClick={() => onConfirmationChange("reject-verification")}
            >
              Unable to verify
            </button>
          )}
          {actions.includes("route-request") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onPerform("/controller-routing")}
            >
              <Route size={15} />
              Record controller routing
            </button>
          )}
          {actions.includes("begin-discovery") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onPerform("/discovery")}
            >
              <Search size={15} />
              Match records
            </button>
          )}
          {actions.includes("review") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onPerform("/review")}
            >
              <ShieldCheck size={15} />
              Submit for review
            </button>
          )}
          {actions.includes("begin-decision") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onPerform("/decision")}
            >
              Begin decision
            </button>
          )}
          {actions.includes("approve") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onConfirmationChange("approve")}
            >
              Approve removal
            </button>
          )}
          {actions.includes("deny") && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={pending}
              onClick={() => onConfirmationChange("deny")}
            >
              Deny request
            </button>
          )}
          {actions.includes("execute") && (
            <button
              type="button"
              className="btn btn-sm btn-error text-white"
              disabled={pending}
              onClick={() => onConfirmationChange("execute")}
            >
              Remove personal data
            </button>
          )}
          {actions.includes("cancel") && (
            <button
              type="button"
              className="btn btn-sm btn-ghost text-error"
              disabled={pending}
              onClick={() => onConfirmationChange("cancel")}
            >
              Cancel request
            </button>
          )}
        </div>
      </div>

      {confirmation && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-4">
          <ConfirmationPanel
            confirmation={confirmation}
            denialReason={denialReason}
            destructiveConfirmation={destructiveConfirmation}
            pending={pending}
            onDenialReasonChange={onDenialReasonChange}
            onDestructiveConfirmationChange={onDestructiveConfirmationChange}
            onCancel={() => onConfirmationChange(null)}
            onConfirm={() => {
              if (confirmation === "reject-verification") {
                onPerform("/requester-verification", { verified: false });
              } else if (confirmation === "approve") {
                onPerform("/decision/outcome", { decision: 1, reason: 1 });
              } else if (confirmation === "deny") {
                onPerform("/decision/outcome", {
                  decision: 2,
                  reason: Number(denialReason) as DataRightsDecisionReason,
                });
              } else if (confirmation === "cancel") {
                onPerform("/cancel");
              } else {
                onExecute();
              }
            }}
          />
        </div>
      )}
    </section>
  );
}

function ConfirmationPanel({
  confirmation,
  denialReason,
  destructiveConfirmation,
  pending,
  onDenialReasonChange,
  onDestructiveConfirmationChange,
  onCancel,
  onConfirm,
}: {
  confirmation: PrivacyRequestConfirmation;
  denialReason: string;
  destructiveConfirmation: string;
  pending: boolean;
  onDenialReasonChange: (value: string) => void;
  onDestructiveConfirmationChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const destructive = confirmation === "execute";
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-content" />
        <div>
          <p className="text-sm font-semibold">{confirmationTitle(confirmation)}</p>
          <p className="mt-1 text-xs leading-5 text-base-content/55">
            {confirmationDescription(confirmation)}
          </p>
        </div>
      </div>
      {confirmation === "deny" && (
        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">Denial reason</span>
          <SelectPicker
            className="w-full"
            value={denialReason}
            onValueChange={onDenialReasonChange}
            ariaLabel="Privacy request denial reason"
            options={[2, 3, 4, 5, 6].map((reason) => ({
              value: String(reason),
              label: dataRightsDecisionReasonLabel(reason as DataRightsDecisionReason),
            }))}
          />
        </label>
      )}
      {destructive && (
        <label className="form-control block">
          <span className="label-text mb-1.5 block text-sm font-semibold">
            Type REMOVE to confirm
          </span>
          <input
            className="input input-bordered w-full"
            value={destructiveConfirmation}
            onChange={(event) => onDestructiveConfirmationChange(event.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={onCancel}>
          Go back
        </button>
        <button
          type="button"
          className={`btn btn-sm ${destructive ? "btn-error text-white" : "btn-primary"}`}
          disabled={pending || (destructive && destructiveConfirmation !== "REMOVE")}
          onClick={onConfirm}
        >
          {pending && <span className="loading loading-spinner loading-sm" />}
          Confirm
        </button>
      </div>
    </div>
  );
}

function confirmationTitle(confirmation: PrivacyRequestConfirmation): string {
  if (confirmation === "reject-verification") return "Record failed identity verification?";
  if (confirmation === "approve") return "Approve permanent data removal?";
  if (confirmation === "deny") return "Deny this privacy request?";
  if (confirmation === "cancel") return "Cancel this privacy request?";
  return "Permanently remove the selected personal data?";
}

function confirmationDescription(confirmation: PrivacyRequestConfirmation): string {
  if (confirmation === "reject-verification") {
    return "The request cannot continue after verification is recorded as failed.";
  }
  if (confirmation === "approve") {
    return "Policy eligibility is checked by the server. A different authorized staff member must execute the approved request.";
  }
  if (confirmation === "deny") {
    return "The reason becomes part of the durable privacy case record.";
  }
  if (confirmation === "cancel") {
    return "The case remains in the audit history but no further processing can occur.";
  }
  return "This is irreversible on ordinary product surfaces. Recent authentication and a different executor are enforced by the server.";
}
