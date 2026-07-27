import { AlertTriangle, Route, Search, ShieldCheck, UserCheck } from "lucide-react";
import type { DataRightsDecisionReason } from "../../api/types";
import { SelectPicker } from "../../components/ui/SelectPicker";
import {
  dataRightsDecisionReasonLabel,
  type DataRightsAction,
  type DataRightsOperationKind,
} from "./dataRightsWorkflow";

export type PrivacyRequestConfirmation =
  | "reject-verification"
  | "approve"
  | "deny"
  | "execute-restriction"
  | "execute-removal"
  | "cancel";

export function PrivacyRequestActions({
  actions,
  operationKind,
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
  operationKind: DataRightsOperationKind;
  confirmation: PrivacyRequestConfirmation | null;
  denialReason: string;
  destructiveConfirmation: string;
  pending: boolean;
  onConfirmationChange: (value: PrivacyRequestConfirmation | null) => void;
  onDenialReasonChange: (value: string) => void;
  onDestructiveConfirmationChange: (value: string) => void;
  onPerform: (suffix: string, body?: Record<string, unknown>) => void;
  onExecute: (operationKind: DataRightsOperationKind) => void;
}) {
  if (actions.length === 0) return null;

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
              {approvalLabel(operationKind)}
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
          {actions.includes("execute-restriction") && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending}
              onClick={() => onConfirmationChange("execute-restriction")}
            >
              <ShieldCheck size={15} />
              {operationKind === "restriction-release"
                ? "Release processing limit"
                : "Apply processing limit"}
            </button>
          )}
          {actions.includes("execute-removal") && (
            <button
              type="button"
              className="btn btn-sm btn-error text-white"
              disabled={pending}
              onClick={() => onConfirmationChange("execute-removal")}
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
        <div className={`mt-4 rounded-lg border p-4 ${
          confirmation === "execute-restriction"
            ? "border-primary/30 bg-primary/8"
            : "border-warning/30 bg-warning/8"
        }`}>
          <ConfirmationPanel
            confirmation={confirmation}
            operationKind={operationKind}
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
                onExecute(operationKind);
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
  operationKind,
  denialReason,
  destructiveConfirmation,
  pending,
  onDenialReasonChange,
  onDestructiveConfirmationChange,
  onCancel,
  onConfirm,
}: {
  confirmation: PrivacyRequestConfirmation;
  operationKind: DataRightsOperationKind;
  denialReason: string;
  destructiveConfirmation: string;
  pending: boolean;
  onDenialReasonChange: (value: string) => void;
  onDestructiveConfirmationChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const destructive = confirmation === "execute-removal";
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-content" />
        <div>
          <p className="text-sm font-semibold">
            {confirmationTitle(confirmation, operationKind)}
          </p>
          <p className="mt-1 text-xs leading-5 text-base-content/55">
            {confirmationDescription(confirmation, operationKind)}
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

function confirmationTitle(
  confirmation: PrivacyRequestConfirmation,
  operationKind: DataRightsOperationKind,
): string {
  if (confirmation === "reject-verification") return "Record failed identity verification?";
  if (confirmation === "approve") {
    if (operationKind === "export") return "Approve this protected data export?";
    if (operationKind === "restriction-apply") return "Approve a processing limit?";
    if (operationKind === "restriction-release") return "Approve releasing the processing limit?";
    return "Approve permanent data removal?";
  }
  if (confirmation === "deny") return "Deny this privacy request?";
  if (confirmation === "cancel") return "Cancel this privacy request?";
  if (confirmation === "execute-restriction") {
    return operationKind === "restriction-release"
      ? "Release the active processing limit?"
      : "Apply a processing limit to this guest?";
  }
  return "Permanently remove the selected personal data?";
}

function confirmationDescription(
  confirmation: PrivacyRequestConfirmation,
  operationKind: DataRightsOperationKind,
): string {
  if (confirmation === "reject-verification") {
    return "The request cannot continue after verification is recorded as failed.";
  }
  if (confirmation === "approve") {
    if (operationKind === "export") {
      return "Generation stays limited to the selected records. A separate permission and recent authentication are required before the export can be created.";
    }
    if (operationKind === "restriction-apply") {
      return "The approval is pinned to one Guest Record and one record revision. Existing processing limits remain independently effective.";
    }
    if (operationKind === "restriction-release") {
      return "The approval is pinned to one Guest Record. Execution fails closed unless exactly one active processing limit can be released.";
    }
    return "Policy eligibility is checked by the server. A different authorized staff member must execute the approved request.";
  }
  if (confirmation === "deny") {
    return "The reason becomes part of the durable privacy case record.";
  }
  if (confirmation === "cancel") {
    return "The case remains in the audit history but no further processing can occur.";
  }
  if (confirmation === "execute-restriction") {
    return operationKind === "restriction-release"
      ? "BunkFy releases only one unambiguous active obligation and records a durable owner receipt."
      : "BunkFy adds a reversible obligation in the Guests module and records a durable owner receipt.";
  }
  return "This is irreversible on ordinary product surfaces. Recent authentication and a different executor are enforced by the server.";
}

function approvalLabel(operationKind: DataRightsOperationKind): string {
  if (operationKind === "export") return "Approve export";
  if (operationKind === "restriction-apply") return "Approve processing limit";
  if (operationKind === "restriction-release") return "Approve release";
  return "Approve removal";
}
