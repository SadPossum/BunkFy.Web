import {
  compositeSourceNeedsRetry,
  createCompositeSource,
} from "../../app/compositeSourceState";
import { useWorkspace } from "../../app/workspace";
import { CompositeSourceNotice } from "../../components/ui/CompositeSourceNotice";

export function useWorkspaceCatalogueSource() {
  const {
    workspacesLoaded,
    workspacesLoading,
    workspacesFetching,
    workspacesError,
    refetchWorkspaces,
  } = useWorkspace();

  return createCompositeSource({
    label: "Workspace list",
    hasData: workspacesLoaded,
    isLoading: workspacesLoading,
    error: workspacesError,
    isFetching: workspacesFetching,
    refetch: refetchWorkspaces,
  });
}

export function WorkspaceCatalogueNotice({
  className = "",
  title = "Workspace updates are delayed",
}: {
  className?: string;
  title?: string;
}) {
  const source = useWorkspaceCatalogueSource();
  if (!compositeSourceNeedsRetry(source.state)) return null;

  return (
    <div className={className}>
      <CompositeSourceNotice sources={[source]} title={title} />
    </div>
  );
}
