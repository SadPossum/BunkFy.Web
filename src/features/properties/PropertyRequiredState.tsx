import { Building2, Plus } from "lucide-react";
import { Link } from "react-router";
import { permissions, tenantAccessScope, usePermissions } from "../../app/permissions";
import { useSession } from "../../app/session";
import { useWorkspace } from "../../app/workspace";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/primitives";

/** Shared entry into property setup, using the same permission as property creation. */
export function PropertyRequiredState() {
  const { session } = useSession();
  const workspace = useWorkspace();
  const scope = session?.tenantId === workspace.selectedWorkspaceId && session?.tenantId
    ? tenantAccessScope(session.tenantId) : "";
  const access = usePermissions(scope && workspace.propertiesLoaded && !workspace.properties.length
    ? [{ permission: permissions.propertiesManage, scope }] : []);

  if (workspace.propertiesError) return <ErrorState error={workspace.propertiesError}
    retry={() => void workspace.refetchProperties()} title="Properties could not be loaded" />;
  if (!workspace.propertiesLoaded || workspace.propertiesLoading || (workspace.propertiesFetching && !workspace.properties.length)) {
    return <LoadingState label="Checking your properties" />;
  }
  if (workspace.properties.length) return <EmptyState icon={<Building2 />}
    title="Choose a property first" description="Select a property from the application menu to continue." />;
  if (access.error) return <ErrorState error={access.error} retry={() => void access.refetch()}
    title="Property setup access could not be checked" />;
  if (!scope || !access.hasData) return <LoadingState label="Checking property setup access" />;

  const canCreate = access.allows(permissions.propertiesManage, scope);
  return <EmptyState icon={<Building2 />} title="No properties yet"
    description={canCreate
      ? "Add your hostel property to start setting up rooms, beds and reservations."
      : "Ask a workspace owner to add a property and give you access to it."}
    action={canCreate ? <Link className="btn btn-primary" to="/properties"><Plus size={17} />Add property</Link> : undefined} />;
}
