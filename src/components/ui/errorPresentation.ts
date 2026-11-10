import {
  ApiError,
} from "../../api/client";
import {
  NetworkRequestError,
  OfflineRequestError,
} from "../../api/requestConnectivity";

export type ErrorPresentationKind =
  | "access"
  | "conflict"
  | "default"
  | "missing"
  | "network"
  | "rate-limit"
  | "session"
  | "temporary";

export type ErrorPresentation = {
  kind: ErrorPresentationKind;
  title: string;
  message: string;
  referenceId?: string;
  retryAfterMs?: number;
};

const domainMessages: Readonly<Record<string, string>> = {
  "Organizations.MembershipConflict": "You already belong to this workspace.",
  "Organizations.MembershipRequired": "You don't have access to this workspace. Ask its owner to invite you.",
  "Organizations.OwnerRequired": "Only a workspace owner can do this. Ask an owner for help.",
  "Organizations.SubjectVerificationRequired": "Verify your email in Account & security, then try creating your workspace again.",
  "Organizations.RecipientVerificationRequired": "Verify the email address this invitation was sent to, then open the invitation again.",
  "Organizations.SelfServiceCreationDisabled": "New workspaces can't be created here right now. Ask the administrator for an invitation.",
  "Organizations.CreationRejected": "This account can't create a workspace. Contact support or join an existing workspace with an invitation.",
  "Organizations.CreationAdmissionUnavailable": "Workspace setup is temporarily unavailable. Try again in a few minutes.",
  "Organizations.SlugConflict": "That short name is already in use. Choose another one.",
  "Organizations.CreationOperationConflict": "This setup attempt can no longer be continued. Contact support before starting another workspace.",
  "Workspaces.VerifiedIdentityRequired": "Verify your email in Account & security, then continue workspace setup.",
  "Properties.ConfirmationRequired": "Confirm the change before continuing.",
  "Properties.PropertyProcessingNotEnabled": "Data processing is not enabled for this property.",
  "Properties.CountryPolicy.PolicyExpired": "This country policy has expired. Choose another configured policy.",
  "Properties.CountryPolicy.RequiredAcknowledgementMissing": "Accept every acknowledgement required by the selected policy.",
  "Properties.CountryPolicy.TimeZoneNotPermitted": "This time zone is not allowed by the property's active country policy.",
  "Properties.TimeZoneRuntimeUnavailable": "This time zone is not available on the current deployment.",
  "Inventory.BlockGroupSelectionMismatch": "Inventory changed after the preview. Preview the current selection before confirming.",
  "Inventory.VersionConflict": "This inventory record changed. Refresh it before making another change.",
  "Inventory.BlockGroupTargetTooLarge": "This scope now exceeds the 500-unit atomic limit. Narrow it and preview again.",
  "Inventory.ManagementOperationConflict": "This operation identity was already used for a different inventory change. Start a new attempt.",
  "DataRights.DecisionActorCannotExecute": "A different authorized staff member must execute this approved request.",
  "DataRights.VersionConflict": "This privacy request changed. Review the latest state and try again.",
  "Retention.ScheduleRetryEvidenceChanged": "This retention schedule changed. Refresh its latest evidence before retrying.",
  "Retention.RetryConfirmationRequired": "Review and confirm the exact failed retention run before retrying.",
  "Retention.WorkspaceProcessingRestricted": "This workspace is not accepting operational changes.",
  "Retention.WorkspaceProcessingAdmissionUnavailable": "Workspace processing checks are temporarily unavailable. Try again shortly.",
  "Security.InsufficientAuthentication": "Confirm your identity with a recent sign-in, then retry.",
};

export function presentError(
  error: unknown,
  titleOverride?: string,
): ErrorPresentation {
  if (error instanceof OfflineRequestError) {
    return {
      kind: "network",
      title: titleOverride ?? "You're offline",
      message: "Reconnect to continue. This request was not sent or queued.",
    };
  }

  if (error instanceof NetworkRequestError || isFetchNetworkError(error)) {
    return {
      kind: "network",
      title: titleOverride ?? "Connection interrupted",
      message: "BunkFy could not reach the service. Check the connection and try again.",
    };
  }

  if (error instanceof ApiError) {
    const common = {
      referenceId: error.referenceId,
      retryAfterMs: error.retryAfterMs,
    };
    const domainMessage = error.code ? domainMessages[error.code] : undefined;
    if (error.code?.startsWith("Properties.CountryPolicy.")) {
      return {
        kind: "conflict",
        title: titleOverride ?? "Review the latest policy",
        message: domainMessage ?? "These policy coordinates are no longer accepted. Refresh and choose a configured policy.",
        ...common,
      };
    }
    if (error.status === 401) {
      return {
        kind: "session",
        title: titleOverride ?? "Session needs attention",
        message: domainMessage ?? "BunkFy could not confirm this browser session. Reconnect or sign in again.",
        ...common,
      };
    }
    if (error.status === 403) {
      return {
        kind: "access",
        title: titleOverride ?? "Access denied",
        message: domainMessage ?? "You don't have permission to do this. Ask a workspace owner or contact support.",
        ...common,
      };
    }
    if (error.status === 404) {
      return {
        kind: "missing",
        title: titleOverride ?? "No longer available",
        message: "This item may have moved, been retired, or no longer be visible to you.",
        ...common,
      };
    }
    if (error.status === 429) {
      return {
        kind: "rate-limit",
        title: titleOverride ?? "Please wait before trying again",
        message: retryMessage(error.retryAfterMs),
        ...common,
      };
    }
    if (error.status >= 500) {
      return {
        kind: "temporary",
        title: titleOverride ?? "Service temporarily unavailable",
        message: domainMessage ?? "BunkFy couldn't complete this request. Try again shortly. If you were saving changes, check whether they were saved before retrying.",
        ...common,
      };
    }
    if (error.status === 409) {
      return {
        kind: "conflict",
        title: titleOverride ?? "Review the latest information",
        message: domainMessage ?? friendlyMessage(error.message, "This record changed. Refresh it before trying again."),
        ...common,
      };
    }

    return {
      kind: "default",
      title: titleOverride ?? "Request could not be completed",
      message: domainMessage ?? friendlyMessage(error.message, "Review the information and try again."),
      ...common,
    };
  }

  return {
    kind: "default",
    title: titleOverride ?? "Request could not be completed",
    message: friendlyMessage(
      error instanceof Error ? error.message : "",
      "Review the information and try again.",
    ),
  };
}

function retryMessage(retryAfterMs: number | undefined): string {
  if (!retryAfterMs) return "BunkFy is receiving too many requests. Wait a moment, then try again.";
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1_000));
  return `BunkFy is receiving too many requests. Try again in about ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

function friendlyMessage(message: string, fallback: string): string {
  const trimmed = message.trim();
  if (!trimmed || /^request failed with http \d+$/i.test(trimmed)) return fallback;
  return trimmed
    .replace(/\bthe subject\b/gi, "this account")
    .replace(/\bsubject\b/gi, "account");
}

function isFetchNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}
