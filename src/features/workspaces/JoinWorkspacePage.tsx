import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, CheckCircle2, Link2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import type {
  OrganizationEnrollmentPreview,
  OrganizationInvitationPreview,
} from "../../api/types";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { StaffProfileFields } from "./StaffProfileFields";
import {
  clearInviteStaffDraft,
  completeCurrentStaffProfile,
  readInviteStaffDraft,
} from "./staffOnboarding";
import { waitForWorkspaceAccess } from "./workspaceAccess";

type JoinSecret = { kind: "invitation" | "enrollment"; token: string };

export function JoinWorkspacePage() {
  const navigate = useNavigate();
  const { request, selectWorkspace, session } = useSession();
  const {
    refetchWorkspaces,
    setSelectedWorkspaceId,
    workspaces,
  } = useWorkspace();
  const secret = readJoinSecret();
  const [staffProfile, setStaffProfile] = useState(() => readInviteStaffDraft(session?.username));
  const preview = useQuery<OrganizationInvitationPreview | OrganizationEnrollmentPreview>({
    queryKey: ["workspace-join-preview", secret?.kind, secret?.token],
    queryFn: () => {
      if (!secret) throw new Error("This invitation link is incomplete.");
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
      if (!secret) throw new Error("This invitation link is incomplete.");
      const path = secret.kind === "invitation"
        ? "/api/organization-invitations/accept"
        : "/api/organization-enrollment/claim";
      await request(path, {
        method: "POST",
        body: JSON.stringify({ token: secret.token }),
      });
      const workspaceId = preview.data?.organizationId;
      if (!workspaceId) throw new Error("The invitation does not identify a workspace.");

      selectWorkspace(workspaceId);
      await waitForWorkspaceAccess(request, workspaceId);
      await refetchWorkspaces();
      setSelectedWorkspaceId(workspaceId);
      await completeCurrentStaffProfile(request, staffProfile);
      clearInviteStaffDraft();
    },
    onSuccess: () => {
      window.history.replaceState(null, "", "/");
      navigate("/", { replace: true });
    },
  });

  const data = preview.data;
  const alreadyJoined = join.error instanceof ApiError &&
    join.error.code === "Organizations.MembershipConflict";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    join.mutate();
  }

  function openWorkspace() {
    const workspaceId = data?.organizationId;
    if (workspaceId && workspaces.some((item) => item.organization.organizationId === workspaceId)) {
      selectWorkspace(workspaceId);
      setSelectedWorkspaceId(workspaceId);
    }
    navigate("/", { replace: true });
  }

  return (
    <main className="min-h-screen bg-base-200 p-4 sm:p-8">
      <section className="mx-auto w-full max-w-2xl border border-base-300 bg-base-100 p-7 shadow-sm sm:p-10">
        <button className="btn btn-circle btn-ghost btn-sm" onClick={() => navigate("/", { replace: true })} aria-label="Back to BunkFy">
          <ArrowLeft size={19} />
        </button>
        <div className="mt-6 flex items-center gap-3 text-primary">
          {data ? <Building2 size={26} /> : <Link2 size={26} />}
          <p className="text-xs font-bold uppercase">Workspace invitation</p>
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold">
          {data ? `Join ${data.organizationName}` : "Open an invitation"}
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
          <form className="mt-6" onSubmit={submit}>
            <div className="border-y border-base-300 py-5">
              <p className="font-semibold">{data.organizationName}</p>
              <p className="mt-1 text-sm text-base-content/50">{data.organizationSlug}</p>
              <p className="mt-3 text-xs text-base-content/45">
                Invitation expires {new Date(data.expiresAtUtc).toLocaleString()}
              </p>
            </div>
            <div className="py-6">
              <h2 className="font-display text-xl font-semibold">Your staff profile</h2>
              <p className="mb-5 mt-1 text-sm leading-6 text-base-content/50">
                Review the contact details your team will see after you join.
              </p>
              <StaffProfileFields value={staffProfile} onChange={setStaffProfile} />
            </div>
            {join.error && (
              <div className="alert alert-error text-sm">
                {alreadyJoined
                  ? "You already belong to this workspace."
                  : join.error.message}
              </div>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/", { replace: true })}>
                Back to BunkFy
              </button>
              {alreadyJoined ? (
                <button type="button" className="btn btn-primary" onClick={openWorkspace}>
                  Open workspace
                </button>
              ) : (
                <button className="btn btn-primary" disabled={join.isPending || !staffProfile.displayName.trim()}>
                  {join.isPending ? <span className="loading loading-spinner loading-sm" /> : <CheckCircle2 size={18} />}
                  Join workspace
                </button>
              )}
            </div>
          </form>
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
