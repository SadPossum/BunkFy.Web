import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { BrandMark } from "../../components/ui/BrandMark";
import { ErrorState, LoadingState } from "../../components/ui/primitives";
import { JoinWorkspacePage } from "./JoinWorkspacePage";
import { useWorkspaceCatalogueSource } from "./WorkspaceCatalogueNotice";
import { WorkspaceOnboardingPage } from "./WorkspaceOnboardingPage";
import { resolveWorkspaceGateMode } from "./workspaceCatalogue";

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { logout } = useSession();
  const {
    workspaces,
    workspacesError,
    refetchWorkspaces,
    selectedWorkspace,
    selectedWorkspaceId,
  } = useWorkspace();
  const catalogueSource = useWorkspaceCatalogueSource();
  const mode = resolveWorkspaceGateMode(
    location.pathname,
    catalogueSource.state,
    workspaces.length,
    selectedWorkspace !== null,
    Boolean(selectedWorkspaceId),
  );

  if (mode === "join") return <JoinWorkspacePage />;
  if (mode === "create") {
    return location.pathname === "/workspace/new"
      ? <WorkspaceOnboardingPage />
      : <Navigate to="/workspace/new" replace />;
  }

  if (mode === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-base-200 p-6" aria-busy="true">
        <section className="w-full max-w-lg rounded-lg border border-base-300 bg-base-100 p-7 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <BrandMark variant="simple-white-bold" height={44} framed />
            <span className="font-display text-xl font-semibold">BunkFy</span>
          </div>
          <LoadingState label="Loading your workspaces" />
        </section>
      </main>
    );
  }

  if (mode === "unavailable") {
    return (
      <main className="grid min-h-screen place-items-center bg-base-200 p-6">
        <section className="w-full max-w-lg rounded-lg border border-base-300 bg-base-100 p-7 shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <BrandMark variant="simple-white-bold" height={44} framed />
            <span className="font-display text-xl font-semibold">BunkFy</span>
          </div>
          <div className="mt-8">
            <ErrorState
              error={workspacesError}
              retry={() => void refetchWorkspaces()}
              title="Workspace list unavailable"
            />
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => void logout()}>
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return children;
}
