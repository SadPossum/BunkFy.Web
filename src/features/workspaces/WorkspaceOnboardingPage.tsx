import { useMutation } from "@tanstack/react-query";
import { Building2, Link2, LogOut } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { OrganizationMembershipSummary } from "../../api/types";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { BrandMark } from "../../components/ui/BrandMark";
import { StaffProfileFields } from "./StaffProfileFields";
import { defaultStaffProfile } from "./staffOnboarding";
import {
  clearWorkspaceCreationAttempt,
  readWorkspaceCreationAttempt,
  resolveWorkspaceCreationAttempt,
  type WorkspaceCreationAttempt,
} from "./workspaceCreationAttempt";
import {
  continueWorkspaceOnboarding,
  recoverCreatedWorkspace,
} from "./workspaceOnboardingFlow";

export function WorkspaceOnboardingPage() {
  const navigate = useNavigate();
  const { logout, request, selectWorkspace, session } = useSession();
  const { refetchWorkspaces, setSelectedWorkspaceId } = useWorkspace();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [staffProfile, setStaffProfile] = useState(() => defaultStaffProfile(session?.username));
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const [recoveryState, setRecoveryState] = useState<
    "restoring" | "ready" | "created" | "pending"
  >("restoring");
  const [recoveryError, setRecoveryError] = useState<unknown>(null);
  const creationAttempt = useRef<WorkspaceCreationAttempt | null>(null);

  useEffect(() => {
    let active = true;
    const accountId = session?.subjectId;
    creationAttempt.current = null;
    setCreatedWorkspaceId(null);
    setRecoveryError(null);
    setRecoveryState("restoring");

    if (!accountId) {
      setRecoveryState("ready");
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const attempt = await readWorkspaceCreationAttempt(accountId);
        if (!active) return;
        creationAttempt.current = attempt;
        if (!attempt) {
          setRecoveryState("ready");
          return;
        }

        const workspace = await recoverCreatedWorkspace(request, attempt);
        if (!active) return;
        if (!workspace) {
          setRecoveryState("pending");
          return;
        }

        setCreatedWorkspaceId(workspace.organization.organizationId);
        setName(workspace.organization.name);
        setSlug(workspace.organization.slug);
        setSlugEdited(true);
        setRecoveryState("created");
      } catch (error) {
        if (!active) return;
        setRecoveryError(error);
        setRecoveryState("ready");
      }
    })();

    return () => {
      active = false;
    };
  }, [request, session?.subjectId]);

  const create = useMutation({
    mutationFn: async () => {
      const accountId = session?.subjectId;
      if (!accountId) throw new Error("You are signed out.");
      let workspace: OrganizationMembershipSummary | null = null;
      if (!createdWorkspaceId) {
        const payload = { name: name.trim(), slug: slug.trim() };
        creationAttempt.current = await resolveWorkspaceCreationAttempt(
          creationAttempt.current,
          accountId,
          payload,
        );
        workspace = await recoverCreatedWorkspace(request, creationAttempt.current);
        workspace ??= await request<OrganizationMembershipSummary>(
          "/api/organizations",
          {
            method: "POST",
            body: JSON.stringify({
              operationId: creationAttempt.current.operationId,
              ...payload,
            }),
          },
        );
      }
      const workspaceId = createdWorkspaceId ?? workspace!.organization.organizationId;
      setCreatedWorkspaceId(workspaceId);
      await continueWorkspaceOnboarding({
        request,
        workspaceId,
        staffProfile,
        selectWorkspace,
        refetchWorkspaces,
        setSelectedWorkspaceId,
        clearCreationAttempt: () => clearWorkspaceCreationAttempt(accountId),
      });
      creationAttempt.current = null;
      return workspaceId;
    },
    onSuccess: () => {
      navigate("/properties", { replace: true });
    },
  });

  function updateName(value: string) {
    setName(value);
    if (!slugEdited) setSlug(toSlug(value));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <main className="min-h-screen bg-base-200 px-4 py-8 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark variant="simple-white-bold" height={48} framed />
            <span className="font-display text-2xl font-semibold">BunkFy</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void logout()}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_30rem] lg:items-start">
          <section>
            <p className="text-xs font-bold uppercase text-primary">Workspace setup</p>
            <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">
              Where does your team work?
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-base-content/60">
              A workspace owns the properties, staff access, reservations, and integrations for one operating team.
            </p>
            <button
              className="btn btn-ghost mt-8 px-0 text-primary"
              onClick={() => navigate("/join")}
            >
              <Link2 size={18} />
              Join with an invite link
            </button>
          </section>

          <form className="rounded-lg border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6" onSubmit={submit}>
            <div className="flex items-center gap-3">
              <Building2 className="text-primary" size={22} />
              <h2 className="font-display text-xl font-semibold">Create a workspace</h2>
            </div>
            <label className="mt-6 block">
              <span className="mb-1.5 block text-sm font-semibold">Workspace name</span>
              <input
                className="input input-bordered w-full"
                value={name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="Harbor House"
                autoFocus
                required
                maxLength={160}
                disabled={create.isPending || createdWorkspaceId !== null}
              />
            </label>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm font-semibold">Workspace handle</span>
              <input
                className="input input-bordered w-full"
                value={slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setSlug(toSlug(event.target.value));
                }}
                placeholder="harbor-house"
                required
                maxLength={80}
                disabled={create.isPending || createdWorkspaceId !== null}
              />
            </label>
            <div className="my-6 h-px bg-base-300" />
            {recoveryState === "restoring" && (
              <div className="alert alert-info mb-5 py-3 text-sm">
                Checking for an interrupted workspace setup…
              </div>
            )}
            {recoveryState === "created" && (
              <div className="alert alert-info mb-5 py-3 text-sm">
                This workspace was already created. Finish your staff profile to complete setup.
              </div>
            )}
            {recoveryState === "pending" && (
              <div className="alert alert-warning mb-5 py-3 text-sm">
                An interrupted create attempt is ready to retry. Re-enter the same workspace details to reuse it safely.
              </div>
            )}
            {Boolean(recoveryError) && (
              <div className="alert alert-error mb-5 py-3 text-sm">
                {recoveryError instanceof Error
                  ? recoveryError.message
                  : "The interrupted workspace setup could not be checked."}
              </div>
            )}
            <div className="mb-4">
              <h3 className="font-display text-lg font-semibold">Your staff profile</h3>
              <p className="mt-1 text-sm leading-6 text-base-content/50">
                This creates your owner profile in the Staff directory.
              </p>
              <p className="mt-1 text-xs leading-5 text-base-content/45">
                Interrupted setup recovery lasts for reloads in this browser tab, not after the tab or browser session is closed.
              </p>
            </div>
            <StaffProfileFields value={staffProfile} onChange={setStaffProfile} />
            {create.error && (
              <div className="alert alert-error mt-5 py-3 text-sm">
                {create.error instanceof Error ? create.error.message : "Workspace creation failed."}
              </div>
            )}
            <button
              className="btn btn-primary mt-6 w-full"
              disabled={create.isPending || recoveryState === "restoring"}
            >
              {create.isPending && <span className="loading loading-spinner loading-sm" />}
              {createdWorkspaceId ? "Save staff profile" : "Create workspace"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
