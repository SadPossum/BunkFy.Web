import { AlertTriangle, LogOut, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { BrandMark } from "../../components/ui/BrandMark";
import { JoinWorkspacePage } from "./JoinWorkspacePage";
import { useWorkspaceCatalogueSource } from "./WorkspaceCatalogueNotice";
import { WorkspaceOnboardingPage } from "./WorkspaceOnboardingPage";
import { resolveWorkspaceGateMode } from "./workspaceCatalogue";

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { logout } = useSession();
  const {
    workspaces,
    workspacesFetching,
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
  if (mode === "create") return <WorkspaceOnboardingPage />;

  if (mode === "loading") {
    return (
      <main className="grid min-h-screen place-items-center" aria-busy="true">
        <span className="loading loading-spinner loading-lg text-primary" />
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
          <AlertTriangle className="mt-8 text-warning" size={28} />
          <h1 className="mt-4 font-display text-2xl font-semibold">Workspace list unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            BunkFy could not refresh the workspaces available to this account.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={workspacesFetching}
              onClick={() => void refetchWorkspaces()}
            >
              <RotateCcw className={workspacesFetching ? "animate-spin" : ""} size={16} />
              Try again
            </button>
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
