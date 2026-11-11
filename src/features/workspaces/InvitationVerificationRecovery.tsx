import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import type { AuthenticationMethods } from "../../api/types";
import { useProductCapabilities } from "../../app/productCapabilities";
import { useSession } from "../../app/session";
import { workspaceJoinVerificationCopy } from "./workspaceJoin";

type VerificationAction =
  | { kind: "send"; emailId: string }
  | { kind: "confirm"; code: string };

export function InvitationVerificationRecovery({
  request,
  recipientBound,
  onVerified,
}: {
  request: ReturnType<typeof useSession>["request"];
  recipientBound: boolean;
  onVerified: () => void;
}) {
  const { emailVerificationEnabled } = useProductCapabilities();
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const methods = useQuery({
    queryKey: ["auth", "methods", "workspace-invitation"],
    queryFn: () => request<AuthenticationMethods>("/api/auth/methods"),
    enabled: emailVerificationEnabled,
    retry: false,
  });
  const activeEmail = methods.data?.emails.find(
    (email) => email.isActive && !email.isVerified,
  );
  const copy = workspaceJoinVerificationCopy(recipientBound);
  const verification = useMutation({
    mutationFn: (action: VerificationAction) =>
      action.kind === "send"
        ? request<void>("/api/auth/email-verification", {
            method: "POST",
            body: JSON.stringify({ emailId: action.emailId }),
          })
        : request<void>("/api/auth/email-verification/confirm", {
            method: "POST",
            body: JSON.stringify({ code: action.code }),
          }),
    onSuccess: async (_result, action) => {
      if (action.kind === "send") {
        setCodeSent(true);
        return;
      }
      await methods.refetch();
      onVerified();
    },
  });

  if (!emailVerificationEnabled) {
    return (
      <div className="alert border border-warning/30 bg-warning/8 text-sm text-base-content">
        <MailCheck className="text-warning" size={19} />
        <span>
          This workspace requires a verified email, but email delivery is
          disabled in this deployment. Sign in with an identity provider that
          supplies a verified email, or ask the administrator to enable email
          delivery.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-5">
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 shrink-0 text-warning" size={19} />
        <div>
          <h2 className="font-display text-lg font-semibold">
            {copy.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-base-content/60">
            {copy.description}
          </p>
        </div>
      </div>

      {methods.isLoading && (
        <span className="loading loading-spinner loading-sm mt-4 text-primary" />
      )}
      {methods.error && (
        <div className="alert alert-error mt-4 text-sm">
          {methods.error.message}
        </div>
      )}
      {!methods.isLoading && !activeEmail && (
        <p className="mt-4 text-sm leading-6 text-base-content/60">
          This account has no active unverified email. Sign out and use the
          invited account, or ask the owner to issue another link.
        </p>
      )}
      {activeEmail && !codeSent && (
        <button
          type="button"
          className="btn btn-outline btn-sm mt-4 h-auto min-h-8 w-full justify-start whitespace-normal py-2 text-left leading-5 [overflow-wrap:anywhere] sm:w-auto sm:justify-center sm:text-center"
          disabled={verification.isPending}
          onClick={() =>
            verification.mutate({ kind: "send", emailId: activeEmail.id })
          }
        >
          {verification.isPending && (
            <span className="loading loading-spinner loading-xs" />
          )}
          Send code to {activeEmail.email}
        </button>
      )}
      {activeEmail && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="input input-bordered flex-1 bg-base-100"
            aria-label="Verification code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Verification code"
            autoComplete="one-time-code"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={verification.isPending || !code.trim()}
            onClick={() =>
              verification.mutate({ kind: "confirm", code: code.trim() })
            }
          >
            {verification.isPending && (
              <span className="loading loading-spinner loading-xs" />
            )}
            Verify and continue
          </button>
        </div>
      )}
      {verification.error && (
        <div className="alert alert-error mt-4 text-sm">
          {verification.error.message}
        </div>
      )}
    </div>
  );
}
