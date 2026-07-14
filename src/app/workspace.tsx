import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  OrganizationListResponse,
  OrganizationMembershipSummary,
  Property,
  PropertyListResponse,
} from "../api/types";
import { useSession } from "./session";

const WORKSPACE_STORAGE_KEY = "bunkfy.workspace.current.v1";

type WorkspaceValue = {
  workspaces: OrganizationMembershipSummary[];
  workspacesLoading: boolean;
  workspacesError: unknown;
  selectedWorkspace: OrganizationMembershipSummary | null;
  selectedWorkspaceId: string;
  setSelectedWorkspaceId: (id: string) => void;
  refetchWorkspaces: () => Promise<void>;
  properties: Property[];
  propertiesLoading: boolean;
  propertiesError: unknown;
  selectedProperty: Property | null;
  selectedPropertyId: string;
  setSelectedPropertyId: (id: string) => void;
  refetchProperties: () => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { request, selectWorkspace, session } = useSession();
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState(() => {
    if (session?.tenantId && session.tenantId !== "global") return session.tenantId;
    return localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? "";
  });
  const workspacesQuery = useQuery({
    queryKey: ["organizations", "mine"],
    queryFn: () => request<OrganizationListResponse>("/api/organizations?page=1&pageSize=100"),
  });
  const workspaces = workspacesQuery.data?.items ?? [];

  useEffect(() => {
    if (workspacesQuery.isLoading) return;
    const selectedExists = workspaces.some(
      (item) => item.organization.organizationId === selectedWorkspaceId,
    );
    const nextId = selectedExists
      ? selectedWorkspaceId
      : workspaces[0]?.organization.organizationId ?? "";
    if (nextId !== selectedWorkspaceId) setSelectedWorkspaceIdState(nextId);
    selectWorkspace(nextId);
    if (nextId) localStorage.setItem(WORKSPACE_STORAGE_KEY, nextId);
    else localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }, [selectWorkspace, selectedWorkspaceId, workspaces, workspacesQuery.isLoading]);

  const setSelectedWorkspaceId = useCallback(
    (id: string) => {
      setSelectedWorkspaceIdState(id);
      selectWorkspace(id);
      if (id) localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    },
    [selectWorkspace],
  );

  const propertyStorageKey = `bunkfy.property.${selectedWorkspaceId || "none"}`;
  const [selectedPropertyId, setSelectedPropertyIdState] = useState("");
  const workspaceScopeReady = Boolean(
    selectedWorkspaceId && session?.tenantId === selectedWorkspaceId,
  );
  const propertiesQuery = useQuery({
    queryKey: ["properties", selectedWorkspaceId],
    queryFn: () => request<PropertyListResponse>("/api/properties?page=1&pageSize=100"),
    enabled: workspaceScopeReady,
  });
  const properties = propertiesQuery.data?.properties ?? [];

  useEffect(() => {
    setSelectedPropertyIdState(localStorage.getItem(propertyStorageKey) ?? "");
  }, [propertyStorageKey]);

  useEffect(() => {
    if (!selectedPropertyId && properties[0]) setSelectedPropertyIdState(properties[0].propertyId);
    if (
      selectedPropertyId &&
      properties.length &&
      !properties.some((property) => property.propertyId === selectedPropertyId)
    ) {
      setSelectedPropertyIdState(properties[0]?.propertyId ?? "");
    }
  }, [properties, selectedPropertyId]);

  useEffect(() => {
    if (selectedPropertyId) localStorage.setItem(propertyStorageKey, selectedPropertyId);
  }, [propertyStorageKey, selectedPropertyId]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      workspaces,
      workspacesLoading: workspacesQuery.isLoading,
      workspacesError: workspacesQuery.error,
      selectedWorkspace:
        workspaces.find(
          (item) => item.organization.organizationId === selectedWorkspaceId,
        ) ?? null,
      selectedWorkspaceId,
      setSelectedWorkspaceId,
      refetchWorkspaces: async () => {
        await workspacesQuery.refetch();
      },
      properties,
      propertiesLoading: propertiesQuery.isLoading,
      propertiesError: propertiesQuery.error,
      selectedProperty:
        properties.find((property) => property.propertyId === selectedPropertyId) ?? null,
      selectedPropertyId,
      setSelectedPropertyId: setSelectedPropertyIdState,
      refetchProperties: () => {
        void propertiesQuery.refetch();
      },
    }),
    [
      properties,
      propertiesQuery.error,
      propertiesQuery.isLoading,
      propertiesQuery.refetch,
      selectedPropertyId,
      selectedWorkspaceId,
      setSelectedWorkspaceId,
      workspaces,
      workspacesQuery.error,
      workspacesQuery.isLoading,
      workspacesQuery.refetch,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}
