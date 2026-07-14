import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useWorkspace } from "../../app/workspace";
import { JoinWorkspacePage } from "./JoinWorkspacePage";
import { WorkspaceOnboardingPage } from "./WorkspaceOnboardingPage";

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const {
    workspaces,
    workspacesError,
    workspacesLoading,
    refetchWorkspaces,
  } = useWorkspace();

  if (workspacesLoading) {
    return (
      <main className="grid min-h-screen place-items-center" aria-busy="true">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (workspacesError) {
    return (
      <main className="grid min-h-screen place-items-center bg-base-200 p-6">
        <section className="w-full max-w-lg border border-error/25 bg-base-100 p-8">
          <h1 className="font-display text-2xl font-semibold">Workspaces could not load</h1>
          <p className="mt-2 text-sm text-base-content/60">
            {workspacesError instanceof Error
              ? workspacesError.message
              : "The workspace catalog is unavailable."}
          </p>
          <button className="btn btn-primary mt-6" onClick={() => void refetchWorkspaces()}>
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (location.pathname === "/join") return <JoinWorkspacePage />;
  if (location.pathname === "/workspace/new") return <WorkspaceOnboardingPage />;
  if (!workspaces.length) return <WorkspaceOnboardingPage />;
  return children;
}
