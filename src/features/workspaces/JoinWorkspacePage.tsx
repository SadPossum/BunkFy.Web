import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, CheckCircle2, Link2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type {
  OrganizationEnrollmentPreview,
  OrganizationInvitationPreview,
} from "../../api/types";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { waitForWorkspaceAccess } from "./workspaceAccess";

type JoinSecret = { kind: "invitation" | "enrollment"; token: string };

export function JoinWorkspacePage() {
  const navigate = useNavigate();
  const { request, selectWorkspace } = useSession();
  const { refetchWorkspaces, setSelectedWorkspaceId } = useWorkspace();
  const autoJoinAttempted = useRef(false);
  const secret = readJoinSecret();
  const preview = useQuery<
    OrganizationInvitationPreview | OrganizationEnrollmentPreview
  >({
    queryKey: ["workspace-join-preview", secret?.kind, secret?.token],
    queryFn: () => {
      if (!secret) throw new Error("This invite link is incomplete.");
      return secret.kind === "invitation"
        ? request<OrganizationInvitationPreview>("/api/organization-invitations/preview", {
            method: "POST",
            body: JSON.stringify({ token: secret.token }),
          })
        : request<OrganizationEnrollmentPreview>("/api/organization-enrollment/preview", {
            method: "POST",
            body: JSON.stringify({ token: secret.token }),
          });
    },
    enabled: Boolean(secret),
    retry: false,
  });
  const join = useMutation({
    mutationFn: async () => {
      if (!secret) throw new Error("This invite link is incomplete.");
      const path = secret.kind === "invitation"
        ? "/api/organization-invitations/accept"
        : "/api/organization-enrollment/claim";
      await request(path, {
        method: "POST",
        body: JSON.stringify({ token: secret.token }),
      });
      const organizationId = preview.data?.organizationId;
      if (organizationId) {
        selectWorkspace(organizationId);
        await waitForWorkspaceAccess(request, organizationId);
        await refetchWorkspaces();
        setSelectedWorkspaceId(organizationId);
      }
    },
    onSuccess: () => {
      window.history.replaceState(null, "", "/properties");
      navigate("/properties", { replace: true });
    },
  });

  const data = preview.data;
  useEffect(() => {
    if (!data || autoJoinAttempted.current) return;
    autoJoinAttempted.current = true;
    join.mutate();
  }, [data, join]);

  return (
    <main className="grid min-h-screen place-items-center bg-base-200 p-4">
      <section className="w-full max-w-xl border border-base-300 bg-base-100 p-7 shadow-sm sm:p-10">
        <button className="btn btn-circle btn-ghost btn-sm" onClick={() => navigate(-1)} aria-label="Go back">
          <ArrowLeft size={19} />
        </button>
        <div className="mt-6 flex items-center gap-3 text-primary">
          {data ? <Building2 size={26} /> : <Link2 size={26} />}
          <p className="text-xs font-bold uppercase">Workspace invitation</p>
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold">
          {data ? `Join ${data.organizationName}` : "Open an invite link"}
        </h1>

        {!secret && (
          <p className="mt-4 text-sm leading-6 text-base-content/60">
            Open the complete link or scan the QR code provided by your workspace owner.
          </p>
        )}
        {preview.isLoading && (
          <div className="mt-8 flex items-center gap-3 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            Checking the invitation
          </div>
        )}
        {preview.error && (
          <div className="alert alert-error mt-6 text-sm">
            {preview.error instanceof Error ? preview.error.message : "The invitation is unavailable."}
          </div>
        )}
        {data && (
          <div className="mt-6 border-y border-base-300 py-5">
            <p className="font-semibold">{data.organizationName}</p>
            <p className="mt-1 text-sm text-base-content/50">{data.organizationSlug}</p>
            <p className="mt-3 text-xs text-base-content/45">
              Expires {new Date(data.expiresAtUtc).toLocaleString()}
            </p>
          </div>
        )}
        {join.error && (
          <div className="alert alert-error mt-5 text-sm">
            {join.error instanceof Error ? join.error.message : "Workspace joining failed."}
          </div>
        )}
        {data && !join.error && (
          <div className="mt-6 flex items-center justify-center gap-3 text-sm font-semibold text-base-content/60" aria-live="polite">
            {join.isPending ? <span className="loading loading-spinner loading-sm" /> : <CheckCircle2 size={18} />}
            Joining workspace
          </div>
        )}
        {join.error && (
          <button className="btn btn-primary mt-6 w-full" onClick={() => join.mutate()}>
            <CheckCircle2 size={18} />
            Try again
          </button>
        )}
      </section>
    </main>
  );
}

function readJoinSecret(): JoinSecret | null {
  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const invitation = parameters.get("invitation")?.trim();
  if (invitation) return { kind: "invitation", token: invitation };
  const enrollment = parameters.get("enrollment")?.trim();
  return enrollment ? { kind: "enrollment", token: enrollment } : null;
}
